import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { currentOrganizationId, db, runInOrganization } from "../../db";
import { jobChatMessages, candidateChatMessages, users } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { verifyAccessToken } from "../auth/verify-token";
import type { AuthenticatedUser } from "../auth/verify-token";
import {
  canAccessCandidate,
  isClientScoped,
  canAccessJob,
  parseRoomId,
  parseChatMessage,
} from "../auth/job-access";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/error.utils";
import { envOr } from "../../utils/env.util";

/**
 * Dashboard events go to the staff of one organization, not to everyone.
 *
 * This used to be a single global room that every authenticated socket
 * joined, so every tenant received every other tenant's `candidate_applied`,
 * `offer_changed`, and the rest — job and candidate ids included. It read as a
 * safety measure next to a bare `io.emit()`, and was the same thing.
 */
function staffRoom(organizationId: number): string {
  return `staff:${organizationId}`;
}
const jobRoom = (jobId: number) => `job_${jobId}`;
// The room is one submission, not a person. Its number is an application id
// — the same id the dashboard links to and canAccessCandidate authorises.
const candidateRoom = (applicationId: number) => `candidate_${applicationId}`;

interface SocketData {
  user: AuthenticatedUser;
}

// Events sent to a single socket. Broadcasts go through `io`.
interface ServerToClientEvents {
  room_denied: (payload: { room: "job" | "candidate"; id: number }) => void;
  write_denied: (payload: { event: string }) => void;
}

type AuthedSocket = Socket<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export class SocketService {
  private static instance: SocketService;
  private io: Server | null = null;

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public initialize(server: HttpServer) {
    this.io = new Server(server, {
      cors: {
        origin: envOr("FRONTEND_URL", "http://localhost:3000"),
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    this.io.use(async (socket, next) => {
      const token = socket.handshake.auth?.token;

      if (typeof token !== "string" || !token) {
        next(new Error("unauthorized"));
        return;
      }

      try {
        (socket as AuthedSocket).data.user = await verifyAccessToken(token);
        next();
      } catch (err) {
        logger.warn(
          `[socket] rejected connection: ${err instanceof Error ? err.message : String(err)}`,
        );
        next(new Error("unauthorized"));
      }
    });

    this.io.on("connection", (rawSocket: Socket) => {
      const socket = rawSocket as AuthedSocket;
      const user = socket.data.user;

      // Socket handlers never pass through Express, so nothing establishes
      // the organization for them. Without this every read returns nothing and
      // every write is refused — silently, since a socket handler has no
      // response to fail.
      const inOrg = <A extends unknown[]>(
        handler: (...args: A) => Promise<void>,
      ) => {
        return (...args: A) => {
          void runInOrganization(user.organizationId, () =>
            handler(...args),
          ).catch((err: unknown) => {
            logger.error(
              `[socket] handler failed for user ${user.id}: ${getErrorMessage(err)}`,
            );
          });
        };
      };

      socket.join(staffRoom(user.organizationId));
      logger.info(`Socket connected: ${socket.id} (user ${user.id})`);

      // job room — hiring team members only
      // Chat rooms are agency workspace. A client contact has no chat surface
      // in the portal yet, and the live feed carries internal messages that
      // the REST history now filters out — so they do not join at all rather
      // than joining and being filtered per message. Revisit when the portal
      // grows a client-visible thread.
      const chatRoomsAreForStaff = !isClientScoped(user);

      socket.on("join_job", inOrg(async (rawJobId: unknown) => {
        const jobId = parseRoomId(rawJobId);
        if (jobId === null) return;
        if (!chatRoomsAreForStaff) {
          socket.emit("room_denied", { room: "job", id: jobId });
          return;
        }

        if (!(await canAccessJob(user, jobId))) {
          logger.warn(
            `[socket] user ${user.id} denied join of job_${jobId} (not on hiring team)`,
          );
          socket.emit("room_denied", { room: "job", id: jobId });
          return;
        }

        socket.join(jobRoom(jobId));
        logger.info(`Socket ${socket.id} joined job room: job_${jobId}`);
      }));

      // candidate room — follows the candidate's job
      socket.on("join_candidate", inOrg(async (rawCandidateId: unknown) => {
        const candidateId = parseRoomId(rawCandidateId);
        if (candidateId === null) return;
        if (!chatRoomsAreForStaff) {
          socket.emit("room_denied", { room: "candidate", id: candidateId });
          return;
        }

        if (!(await canAccessCandidate(user, candidateId))) {
          logger.warn(
            `[socket] user ${user.id} denied join of candidate_${candidateId}`,
          );
          socket.emit("room_denied", { room: "candidate", id: candidateId });
          return;
        }

        socket.join(candidateRoom(candidateId));
        logger.info(
          `Socket ${socket.id} joined candidate room: candidate_${candidateId}`,
        );
      }));

      // Writes require the room, which the join already checked.
      const inJobRoom = (jobId: number) => socket.rooms.has(jobRoom(jobId));
      const inCandidateRoom = (applicationId: number) =>
        socket.rooms.has(candidateRoom(applicationId));

      const denyWrite = (event: string, id: number | null) => {
        logger.warn(
          `[socket] user ${user.id} denied ${event} for room id ${id} (not joined)`,
        );
        socket.emit("write_denied", { event });
      };

      socket.on(
        "send_job_message",
        inOrg(async (data: {
          jobId: number;
          message: string;
          replyToId?: number;
        }) => {
          const jobId = parseRoomId(data?.jobId);
          if (jobId === null || !inJobRoom(jobId)) {
            denyWrite("send_job_message", jobId);
            return;
          }

          const message = parseChatMessage(data?.message);
          if (message === null) return;

          const replyToId = parseRoomId(data?.replyToId) ?? undefined;

          try {
            const [newMessage] = await db
              .insert(jobChatMessages)
              .values({
                jobId,
                senderId: user.id,
                message,
                replyToId,
              })
              .returning();

            const [sender] = await db
              .select({
                firstName: users.firstName,
                lastName: users.lastName,
                avatarUrl: users.avatarUrl,
              })
              .from(users)
              .where(eq(users.id, user.id))
              .limit(1);

            this.io?.to(jobRoom(jobId)).emit("new_job_message", {
              ...newMessage,
              senderName: sender
                ? `${sender.firstName} ${sender.lastName}`
                : null,
              senderAvatar: sender?.avatarUrl ?? null,
            });
          } catch (error) {
            logger.error(`Error saving job message: ${getErrorMessage(error)}`);
          }
        }),
      );

      socket.on(
        "edit_job_message",
        inOrg(async (data: { jobId: number; messageId: number; message: string }) => {
          const jobId = parseRoomId(data?.jobId);
          if (jobId === null || !inJobRoom(jobId)) {
            denyWrite("edit_job_message", jobId);
            return;
          }

          const messageId = parseRoomId(data?.messageId);
          if (messageId === null) return;

          const message = parseChatMessage(data?.message);
          if (message === null) return;

          try {
            const [updated] = await db
              .update(jobChatMessages)
              .set({ message })
              .where(
                and(
                  eq(jobChatMessages.id, messageId),
                  eq(jobChatMessages.jobId, jobId),
                  eq(jobChatMessages.senderId, user.id),
                  eq(jobChatMessages.isDeleted, false),
                ),
              )
              .returning();

            if (!updated) return;

            const [sender] = await db
              .select({
                firstName: users.firstName,
                lastName: users.lastName,
                avatarUrl: users.avatarUrl,
              })
              .from(users)
              .where(eq(users.id, user.id))
              .limit(1);

            this.io?.to(jobRoom(jobId)).emit("job_message_updated", {
              ...updated,
              senderName: sender
                ? `${sender.firstName} ${sender.lastName}`
                : null,
              senderAvatar: sender?.avatarUrl ?? null,
            });
          } catch (error) {
            logger.error(`Error updating job message: ${getErrorMessage(error)}`);
          }
        }),
      );

      socket.on(
        "delete_job_message",
        inOrg(async (data: { jobId: number; messageId: number }) => {
          const jobId = parseRoomId(data?.jobId);
          if (jobId === null || !inJobRoom(jobId)) {
            denyWrite("delete_job_message", jobId);
            return;
          }

          const messageId = parseRoomId(data?.messageId);
          if (messageId === null) return;

          try {
            const [deleted] = await db
              .update(jobChatMessages)
              .set({ isDeleted: true })
              .where(
                and(
                  eq(jobChatMessages.id, messageId),
                  eq(jobChatMessages.jobId, jobId),
                  eq(jobChatMessages.senderId, user.id),
                  eq(jobChatMessages.isDeleted, false),
                ),
              )
              .returning({ id: jobChatMessages.id });

            if (!deleted) return;
            this.io
              ?.to(jobRoom(jobId))
              .emit("job_message_deleted", { id: deleted.id });
          } catch (error) {
            logger.error(`Error deleting job message: ${getErrorMessage(error)}`);
          }
        }),
      );

      socket.on(
        "send_candidate_message",
        inOrg(async (data: {
          candidateId: number;
          message: string;
          replyToId?: number;
        }) => {
          const candidateId = parseRoomId(data?.candidateId);
          if (candidateId === null || !inCandidateRoom(candidateId)) {
            denyWrite("send_candidate_message", candidateId);
            return;
          }

          const message = parseChatMessage(data?.message);
          if (message === null) return;

          const replyToId = parseRoomId(data?.replyToId) ?? undefined;

          try {
            const [newMessage] = await db
              .insert(candidateChatMessages)
              .values({
                // The room is a submission, so the thread is too: "should we
                // hire Ada for Dev" is not the same conversation as "for Ops".
                applicationId: candidateId,
                senderId: user.id,
                message,
                replyToId,
              })
              .returning();

            // broadcast to the candidate room
            this.io
              ?.to(candidateRoom(candidateId))
              .emit("new_candidate_message", newMessage);
          } catch (error) {
            logger.error(`Error saving candidate message: ${getErrorMessage(error)}`);
          }
        }),
      );

      socket.on("disconnect", () => {
        logger.info(`Socket disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Sends to the staff of whichever organization this call is running for.
   *
   * Every caller is inside `runInOrganization`, so the tenant is already
   * established. Outside one there is no room this could belong to, and
   * emitting to all of them is what the bug was — so it drops the event and
   * says so rather than falling back to a wider audience.
   */
  private broadcastToStaff(event: string, payload: unknown) {
    const organizationId = currentOrganizationId();
    if (organizationId === null) {
      logger.warn(
        `[socket] dropped "${event}" — no organization context to send it to`,
      );
      return;
    }
    this.io?.to(staffRoom(organizationId)).emit(event, payload);
  }

  public notifyCandidateApplied(jobId: number) {
    this.broadcastToStaff("candidate_applied", { jobId });
  }

  // Broadcast a candidate pipeline stage change to authenticated dashboard clients
  public notifyStageChanged(event: {
    candidateId: number;
    jobId: number;
    stageId: number;
  }) {
    this.broadcastToStaff("candidate_stage_changed", event);
  }

  // Broadcast an offer create/update/status change to authenticated dashboard clients
  public notifyOfferChanged(event: {
    offerId: number;
    candidateId: number;
    jobId: number;
  }) {
    this.broadcastToStaff("offer_changed", event);
  }

  // Broadcast an interview create/update/delete/feedback change
  public notifyInterviewChanged(event: {
    interviewId: number;
    candidateId: number;
  }) {
    this.broadcastToStaff("interview_changed", event);
  }

  // Broadcast assessment attempt progress (answer saved / attempt completed)
  public notifyAssessmentProgress(event: {
    candidateId: number;
    attemptId: number;
  }) {
    this.broadcastToStaff("assessment_progress_updated", event);
  }

  public async sendSystemMessageToJob(jobId: number, message: string) {
    try {
      const [newMessage] = await db
        .insert(jobChatMessages)
        .values({
          jobId,
          senderId: 1,
          message,
          isSystemMessage: true,
        })
        .returning();

      this.io?.to(jobRoom(jobId)).emit("new_job_message", newMessage);
    } catch (error) {
      logger.error(`Error sending system job message: ${getErrorMessage(error)}`);
    }
  }
  // Broadcast a CV analysis status change to authenticated dashboard clients
  public emitCvAnalysisUpdate(event: {
    candidateId: number;
    jobId: number;
    status: "done" | "failed";
  }) {
    this.broadcastToStaff("cv_analysis_updated", event);
  }
}

export const socketService = SocketService.getInstance();
