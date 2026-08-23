import { Request, Response } from "express";
import { db } from "../../db";
import { jobChatMessages, candidateChatMessages, users } from "../../db/schema";
import { eq, desc, and } from "drizzle-orm";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";
import { isClientScoped } from "../../shared/auth/job-access";

export const getJobChatHistory = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const messages = await db
      .select({
        id: jobChatMessages.id,
        message: jobChatMessages.message,
        senderId: jobChatMessages.senderId,
        sentAt: jobChatMessages.sentAt,
        isSystemMessage: jobChatMessages.isSystemMessage,
        senderName: users.firstName,
        senderLastName: users.lastName,
        senderAvatar: users.avatarUrl,
      })
      .from(jobChatMessages)
      .leftJoin(users, eq(jobChatMessages.senderId, users.id))
      .where(
        and(
          eq(jobChatMessages.jobId, Number(jobId)),
          eq(jobChatMessages.isDeleted, false),
          // A client contact sees only what was deliberately shared.
          ...(isClientScoped(req.user)
            ? [eq(jobChatMessages.visibility, "shared")]
            : []),
        )
      )
      .orderBy(desc(jobChatMessages.sentAt));

    res.status(200).json({
      data: messages.map((m) => ({
        ...m,
        senderName: m.senderName
          ? `${m.senderName} ${m.senderLastName ?? ""}`.trim()
          : null,
      })),
    });
  } catch (error) {
    logger.error(`Error fetching job chat history: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to fetch job chat history" });
  }
};

export const getCandidateChatHistory = async (req: Request, res: Response) => {
  try {
    // A submission id: chat threads belong to one, not to a person.
    const { candidateId: applicationId } = req.params;

    const messages = await db
      .select({
        id: candidateChatMessages.id,
        message: candidateChatMessages.message,
        senderId: candidateChatMessages.senderId,
        sentAt: candidateChatMessages.sentAt,
        isSystemMessage: candidateChatMessages.isSystemMessage,
        senderName: users.firstName,
        senderLastName: users.lastName,
        senderAvatar: users.avatarUrl,
      })
      .from(candidateChatMessages)
      .leftJoin(users, eq(candidateChatMessages.senderId, users.id))
      .where(
        and(
          eq(candidateChatMessages.applicationId, Number(applicationId)),
          eq(candidateChatMessages.isDeleted, false),
          ...(isClientScoped(req.user)
            ? [eq(candidateChatMessages.visibility, "shared")]
            : []),
        )
      )
      .orderBy(desc(candidateChatMessages.sentAt));

    res.status(200).json({
      data: messages.map((m) => ({
        ...m,
        senderName: m.senderName
          ? `${m.senderName} ${m.senderLastName ?? ""}`.trim()
          : null,
      })),
    });
  } catch (error) {
    logger.error(`Error fetching candidate chat history: ${getErrorMessage(error)}`);
    res.status(500).json({ error: "Failed to fetch candidate chat history" });
  }
};
