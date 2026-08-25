import { Request, Response } from "express";
import { z } from "zod";
import {
  ClientCompanyInUseError,
  DuplicateSlugError,
  clientCompanyService,
} from "./client-company.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";

/**
 * The slug addresses a public careers page at /careers/:slug, so it is
 * constrained to what is safe and readable in a URL rather than being
 * whatever the name happens to be.
 */
const slug = z
  .string()
  .trim()
  .min(1, "URL slug is required")
  .max(255)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens, e.g. acme-corp",
  );

const clientCompanySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(255),
  slug,
  website: z.string().url("Invalid URL").max(500).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  logoUrl: z.string().url("Invalid logo URL").max(1000).optional().nullable(),
});

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function getClientCompanies(_req: Request, res: Response) {
  try {
    res.status(200).json({ data: await clientCompanyService.getAll() });
  } catch (error) {
    logger.error(`Failed to list client companies: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to list client companies" });
  }
}

export async function getClientCompany(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid client company id" });
    return;
  }

  try {
    const row = await clientCompanyService.getById(id);
    if (!row) {
      res.status(404).json({ error: "Client company not found" });
      return;
    }
    res.status(200).json({ data: row });
  } catch (error) {
    logger.error(`Failed to fetch client company: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to fetch client company" });
  }
}

export async function createClientCompany(req: Request, res: Response) {
  const parsed = clientCompanySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  try {
    res.status(201).json({ data: await clientCompanyService.create(parsed.data) });
  } catch (error) {
    if (error instanceof DuplicateSlugError) {
      res.status(409).json({ error: error.message });
      return;
    }
    logger.error(`Failed to create client company: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to create client company" });
  }
}

export async function updateClientCompany(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid client company id" });
    return;
  }

  const parsed = clientCompanySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      details: z.flattenError(parsed.error).fieldErrors,
    });
    return;
  }

  try {
    const row = await clientCompanyService.update(id, parsed.data);
    if (!row) {
      res.status(404).json({ error: "Client company not found" });
      return;
    }
    res.status(200).json({ data: row });
  } catch (error) {
    if (error instanceof DuplicateSlugError) {
      res.status(409).json({ error: error.message });
      return;
    }
    logger.error(`Failed to update client company: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to update client company" });
  }
}

export async function deleteClientCompany(req: Request, res: Response) {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid client company id" });
    return;
  }

  try {
    const row = await clientCompanyService.remove(id);
    if (!row) {
      res.status(404).json({ error: "Client company not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (error instanceof ClientCompanyInUseError) {
      // 409 rather than 400: the request is well formed, the state refuses it.
      res.status(409).json({
        error: `This client company still has ${error.jobCount} job(s). Delete or move them first.`,
      });
      return;
    }
    logger.error(`Failed to delete client company: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to delete client company" });
  }
}
