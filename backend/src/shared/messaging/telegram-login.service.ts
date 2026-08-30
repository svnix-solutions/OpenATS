import { TelegramClient, Api, errors } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { computeCheck } from "teleproto/Password";
import { currentOrganizationId } from "../../db";
import logger from "../../utils/logger";

/**
 * Signing an agency's Telegram account in, across two HTTP requests.
 *
 * MTProto does not let this be stateless. `sendCode` returns a
 * `phoneCodeHash` that is bound to the connection that asked for it, and the
 * sign-in that follows must use the same one — so a half-authenticated client
 * is held in this process between the request that asks for the code and the
 * request that supplies it.
 *
 * That is process-local mutable state in a multi-tenant application, which is
 * the shape of bug this codebase has had before: a Map keyed on the literal
 * string "all" served one organization's departments to every other one. So
 * the key here is the organization, taken from the request context and never
 * from anything a caller sends.
 *
 * It also means Telegram login works on one API replica only. A second replica
 * would not have the pending client and would answer "start again" — annoying,
 * and better than the alternative of pretending the state is shared.
 */

type PendingLogin = {
  client: TelegramClient;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  phoneCodeHash: string;
  expiresAt: number;
};

const pending = new Map<number, PendingLogin>();

/**
 * Short. A login left half-finished holds an open connection to Telegram, and
 * the code itself expires on their side anyway.
 */
const PENDING_TTL_MS = 10 * 60 * 1000;

export class NoPendingLoginError extends Error {
  constructor() {
    super("There is no Telegram login in progress. Start again.");
    this.name = "NoPendingLoginError";
  }
}

function organization(): number {
  const orgId = currentOrganizationId();
  if (orgId === null) {
    // Refusing rather than falling back to a shared key. Without a tenant this
    // could only be stored somewhere every tenant can reach.
    throw new Error("Telegram login attempted outside an organization");
  }
  return orgId;
}

/** Drops anything expired, disconnecting it rather than leaking the socket. */
async function sweep(): Promise<void> {
  const now = Date.now();
  for (const [orgId, entry] of pending) {
    if (entry.expiresAt > now) continue;
    pending.delete(orgId);
    await entry.client.disconnect().catch(() => undefined);
  }
}

async function forget(orgId: number): Promise<void> {
  const existing = pending.get(orgId);
  if (!existing) return;
  pending.delete(orgId);
  await existing.client.disconnect().catch(() => undefined);
}

/**
 * Asks Telegram to send a login code to the phone.
 *
 * The code arrives in the Telegram app on that account, not by SMS, whenever
 * the account is already signed in somewhere — which is worth saying on the
 * screen, because people wait for a text that never comes.
 */
export async function startLogin(
  apiId: number,
  apiHash: string,
  phoneNumber: string,
): Promise<void> {
  await sweep();
  const orgId = organization();
  // Starting again replaces whatever was in flight, and closes it.
  await forget(orgId);

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 3,
    // The library logs to console at info by default, which would put MTProto
    // frame noise into the application's own log stream.
    baseLogger: undefined,
  });

  await client.connect();

  try {
    const { phoneCodeHash } = await client.sendCode(
      { apiId, apiHash },
      phoneNumber,
    );

    pending.set(orgId, {
      client,
      apiId,
      apiHash,
      phoneNumber,
      phoneCodeHash,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
  } catch (error) {
    await client.disconnect().catch(() => undefined);
    throw error;
  }
}

export type VerifyResult =
  | { status: "needs_password" }
  | { status: "signed_in"; session: string; accountLabel: string };

/**
 * Completes the sign-in with the code, and the 2FA password if there is one.
 *
 * "Needs password" is a normal outcome rather than an error: Telegram only
 * says so after the code has been accepted, so it cannot be asked for in
 * advance. The pending client is kept, because the password goes over the same
 * connection.
 */
export async function completeLogin(
  code: string,
  password?: string,
): Promise<VerifyResult> {
  await sweep();
  const orgId = organization();
  const entry = pending.get(orgId);
  if (!entry) throw new NoPendingLoginError();

  const { client } = entry;

  try {
    if (!password) {
      try {
        await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: entry.phoneNumber,
            phoneCodeHash: entry.phoneCodeHash,
            phoneCode: code,
          }),
        );
      } catch (error) {
        if (error instanceof errors.SessionPasswordNeededError) {
          return { status: "needs_password" };
        }
        throw error;
      }
    } else {
      const passwordInfo = await client.invoke(new Api.account.GetPassword());
      await client.invoke(
        new Api.auth.CheckPassword({
          password: await computeCheck(passwordInfo, password),
        }),
      );
    }

    const me = await client.getMe();
    const label =
      "username" in me && me.username
        ? `@${me.username}`
        : entry.phoneNumber;

    // The session string is the account: unscoped, non-expiring, and enough
    // for anyone holding it to be this user. It goes straight into the
    // encrypted store and is never logged or returned to a browser.
    const session = client.session.save() as unknown as string;

    await forget(orgId);
    return { status: "signed_in", session, accountLabel: label };
  } catch (error) {
    logger.error(
      `Telegram sign-in failed for organization ${orgId}: ${
        error instanceof Error ? error.name : "unknown"
      }`,
    );
    await forget(orgId);
    throw error;
  }
}

/** Whether a login is waiting for this organization. For the screen's state. */
export function hasPendingLogin(): boolean {
  const entry = pending.get(organization());
  return Boolean(entry && entry.expiresAt > Date.now());
}
