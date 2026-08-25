import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  const { jwks } = await import("../helpers/jwks-holder");
  return { ...actual, createRemoteJWKSet: () => async () => jwks.publicKey };
});

import http from "node:http";
import { type AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { sql } from "drizzle-orm";
import app from "../../src/app";
import { socketService } from "../../src/shared/services/socket.service";
import { db, runInOrganization } from "../../src/db";
import { organizationMembers } from "../../src/db/schema/organizations";
import { users } from "../../src/db/schema/users";
import { initTestKeys, signToken } from "../helpers/jwt";
import { createScenario, destroyScenario, type Scenario } from "../helpers/scenario";

let s: Scenario;
let server: http.Server;
let url: string;
let adminToken: string;
let interviewerToken: string;
let clientToken: string;
let contactUserId: number;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolves once connected, or with the refusal — never hangs the suite. */
function connect(token?: string): Promise<{ socket: Socket; connected: boolean }> {
  return new Promise((resolve) => {
    const socket = io(url, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
    });
    socket.on("connect", () => resolve({ socket, connected: true }));
    socket.on("connect_error", (e) => {
      if (process.env.SOCKET_DEBUG) console.error("connect_error:", e.message);
      resolve({ socket, connected: false });
    });
  });
}

async function bare(token: string): Promise<Socket> {
  const { socket } = await connect(token);
  return socket;
}

beforeAll(async () => {
  await initTestKeys();
  s = await createScenario("sock");

  await runInOrganization(s.organizationId, async () => {
    const [contact] = await db
      .insert(users)
      .values({
        asgardeoUserId: `${s.suffix}-contact`,
        firstName: "Client",
        lastName: "Contact",
        email: `contact.${s.suffix}@example.test`,
      })
      .returning({ id: users.id });
    contactUserId = contact!.id;
    await db.execute(
      sql`INSERT INTO organization_members (organization_id, user_id, role, client_company_id)
          VALUES (${s.organizationId}, ${contact!.id}, 'client_admin'::org_role, ${s.clientCompanyId})`,
    );
  });

  // The raw token, not "Bearer <token>": the handshake reads
  // handshake.auth.token directly, unlike the HTTP header.
  const mint = (sub: string, email: string, role: string) =>
    signToken({
      sub,
      email,
      given_name: "Test",
      family_name: "User",
      roles: [role],
    });

  adminToken = await mint(
    s.admin.asgardeoUserId,
    s.admin.email,
    "super_admin",
  );
  interviewerToken = await mint(
    s.interviewer.asgardeoUserId,
    s.interviewer.email,
    "interviewer",
  );
  clientToken = await mint(
    `${s.suffix}-contact`,
    `contact.${s.suffix}@example.test`,
    "client_admin",
  );

  server = http.createServer(app);
  socketService.initialize(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await runInOrganization(s.organizationId, () => db.delete(organizationMembers));
  await destroyScenario(s);
});

describe("socket authentication", () => {
  it("refuses a connection with no token", async () => {
    const { socket, connected } = await connect();
    socket.close();
    expect(connected).toBe(false);
  });

  it("refuses a connection with a token it cannot verify", async () => {
    const { socket, connected } = await connect("not-a-jwt");
    socket.close();
    expect(connected).toBe(false);
  });

  it("accepts a valid token", async () => {
    const { socket, connected } = await connect(adminToken);
    socket.close();
    expect(connected).toBe(true);
  });
});

describe("joining a job room", () => {
  it("refuses an interviewer who is not on the hiring team", async () => {
    // jobB exists precisely so the interviewer is off one team.
    const socket = await bare(interviewerToken);
    const denied: unknown[] = [];
    socket.on("room_denied", (d) => denied.push(d));

    socket.emit("join_job", s.jobB.id);
    await wait(400);
    socket.close();

    expect(denied).toEqual([{ room: "job", id: s.jobB.id }]);
  });

  it("refuses a client contact even when on the hiring team", async () => {
    // On the team on purpose. Without it the hiring-team check denies them
    // anyway, so the test would pass with the client rule deleted — it would
    // be asserting an outcome two rules produce rather than the rule that
    // exists. Chat is the team's working conversation about a candidate, and
    // a contact at the client is not in it whatever their team membership.
    await runInOrganization(s.organizationId, () =>
      db.execute(
        sql`INSERT INTO job_hiring_team (job_id, user_id)
            VALUES (${s.jobA.id}, ${contactUserId})
            ON CONFLICT DO NOTHING`,
      ),
    );

    const socket = await bare(clientToken);
    const denied: unknown[] = [];
    socket.on("room_denied", (d) => denied.push(d));

    socket.emit("join_job", s.jobA.id);
    await wait(400);
    socket.close();

    expect(denied).toEqual([{ room: "job", id: s.jobA.id }]);
  });
});

describe("job chat", () => {
  it("refuses a write from a socket that never joined the room", async () => {
    // Otherwise a client could skip join_job and post into any job it can
    // name, which is the whole reason the write handlers check the room.
    const writer = await bare(interviewerToken);
    const listener = await bare(adminToken);
    const heard: unknown[] = [];
    listener.on("new_job_message", (m) => heard.push(m));
    listener.emit("join_job", s.jobA.id);
    await wait(300);

    writer.emit("send_job_message", { jobId: s.jobA.id, message: "unjoined" });
    await wait(600);
    writer.close();
    listener.close();

    expect(heard).toHaveLength(0);
  });

  it("broadcasts a message to the room once joined", async () => {
    const sender = await bare(adminToken);
    const heard: { message: string; senderName: string | null }[] = [];
    sender.on("new_job_message", (m) => heard.push(m));

    sender.emit("join_job", s.jobA.id);
    await wait(300);
    sender.emit("send_job_message", { jobId: s.jobA.id, message: "hello" });
    await wait(700);
    sender.close();

    expect(heard.map((m) => m.message)).toContain("hello");
    // Taken from the authenticated socket, never from the payload.
    expect(heard[0]!.senderName).toBeTruthy();
  });

  it("stores nothing for a payload that is not a usable message", async () => {
    const sender = await bare(adminToken);
    const heard: unknown[] = [];
    sender.on("new_job_message", (m) => heard.push(m));

    sender.emit("join_job", s.jobA.id);
    await wait(300);
    sender.emit("send_job_message", { jobId: s.jobA.id, message: 12345 });
    sender.emit("send_job_message", { jobId: s.jobA.id, message: "   " });
    sender.emit("send_job_message", {
      jobId: s.jobA.id,
      message: "x".repeat(5000),
    });
    await wait(800);
    sender.close();

    expect(heard).toHaveLength(0);
  });
});
