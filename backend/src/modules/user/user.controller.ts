import { Request, Response } from "express";
import { z } from "zod";
import {
  ClientCompanyRequiredError,
  MembershipNotFoundError,
  UnknownClientCompanyError,
  membershipService,
  placeNewMember,
  userService,
} from "./user.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  avatarUrl: z
    .string()
    .url("Invalid avatar URL")
    .max(1000)
    .optional()
    .nullable(),
  isActive: z.boolean().optional(),
});

const createUserSchema = z.object({
  providerUserId: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255),
  // What this person may do here. Required: an account with no membership is
  // a member of nothing, cannot be given a role afterwards without one, and
  // does not appear in a directory that lists members.
  role: z.enum([
    "super_admin",
    "hiring_manager",
    "interviewer",
    "client_admin",
    "client_reviewer",
  ]),
  clientCompanyId: z.number().int().positive().nullable().optional(),
});

export const getCurrentUser = async (req: Request, res: Response) => {
  res.status(200).json({ data: req.user });
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const result = await userService.getAll();
    res.status(200).json({ data: result });
  } catch (error) {
    logger.error(`Failed to fetch users: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const id = parseInt((req.params.id ?? "").toString());
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const result = await userService.getById(id);
    if (!result) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({ data: result });
  } catch (error) {
    logger.error(`Failed to fetch user: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const id = parseInt((req.params.id ?? "").toString());
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const isSelf = req.user.id === id;
    const isSuperAdmin = req.user.role === "super_admin";

    if (!isSelf && !isSuperAdmin) {
      res.status(403).json({ error: "Only a super admin can edit other users" });
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    if (parsed.data.isActive !== undefined && !isSuperAdmin) {
      res
        .status(403)
        .json({ error: "Only a super admin can change account status" });
      return;
    }

    const result = await userService.update(id, parsed.data);

    if (!result) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({ data: result });
  } catch (error) {
    logger.error(`[updateUser] error:`, error);
    res.status(500).json({ error: "Failed to update user" });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    if (req.user.role !== "super_admin") {
      res.status(403).json({ error: "Only a super admin can create users" });
      return;
    }

    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const { role, clientCompanyId, ...account } = parsed.data;
    const result = await userService.create(account);
    if (!result) {
      res.status(500).json({ error: "Failed to create user" });
      return;
    }

    // The account and its membership together: an account without one is a
    // member of nothing, and nothing else can give it a role afterwards.
    await placeNewMember(result.id, role, clientCompanyId ?? null);

    res.status(201).json({ data: result });
  } catch (error) {
    logger.error(`Failed to create user: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to create user" });
  }
};

export const deactivateUser = async (req: Request, res: Response) => {
  try {
    if (req.user.role !== "super_admin") {
      res.status(403).json({ error: "Only a super admin can remove users" });
      return;
    }

    const id = parseInt((req.params.id ?? "").toString());
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    if (req.user.id === id) {
      res.status(400).json({ error: "You cannot remove your own account" });
      return;
    }

    const result = await userService.deactivate(id);
    if (!result) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({ data: result });
  } catch (error) {
    logger.error(`[deactivateUser] error:`, error);
    res.status(500).json({ error: "Failed to remove user" });
  }
};


const membershipSchema = z
  .object({
    role: z.enum([
      "super_admin",
      "hiring_manager",
      "interviewer",
      "client_admin",
      "client_reviewer",
    ]),
    clientCompanyId: z.number().int().positive().nullable().optional(),
  })
  .partial({ role: true });

/**
 * Sets what a user may do in this organization, and which client company they
 * belong to if they are a contact rather than staff.
 *
 * Role lives here, not in the identity provider: the token seeds this column
 * at first sign-in and is ignored afterwards, so changing a role in the provider
 * alone has no effect on what the person can actually do.
 */
export const updateMembership = async (req: Request, res: Response) => {
  const id = parseInt((req.params.id ?? "").toString());
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const parsed = membershipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  try {
    const updated = await membershipService.update(id, parsed.data);
    res.status(200).json({ data: updated });
  } catch (error) {
    if (error instanceof MembershipNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (
      error instanceof ClientCompanyRequiredError ||
      error instanceof UnknownClientCompanyError
    ) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error(`Failed to update membership: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to update membership" });
  }
};
