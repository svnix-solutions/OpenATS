import { NextResponse } from "next/server";
import { serverFetch } from "@/lib/auth-action";
import { requireRole } from "@/lib/require-role";
import { createUser, listUsers } from "@/lib/auth/directory";
import type { User } from "@/types";

export const dynamic = "force-dynamic";

/**
 * The user list is a join across two systems.
 *
 * The application owns membership — which organization someone belongs to,
 * their role, and their client company — and the identity provider owns the
 * account. Neither alone is the answer: the provider does not know about
 * organizations, and the application does not know about accounts that have
 * never signed in.
 */
type DbUser = Omit<User, "role"> & {
  providerUserId: string;
  role?: User["role"] | null;
};

export async function GET() {
  try {
    await requireRole("super_admin");

    const [dbData, directory] = await Promise.all([
      serverFetch<{ data: DbUser[] }>("/users"),
      // A provider that is down should not blank the screen: membership is
      // what governs access, and it is the half worth showing.
      listUsers().catch(() => []),
    ]);

    const byProviderId = new Map(directory.map((u) => [u.id, u]));

    const users: User[] = dbData.data.map(({ providerUserId, ...u }) => ({
      ...u,
      // The database role governs; the provider's is the fallback for an
      // account provisioned there but not yet attached here.
      role:
        u.role ??
        (byProviderId.get(providerUserId)?.roles[0] as User["role"]) ??
        "interviewer",
    }));

    return NextResponse.json(users);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/users] GET failed:", msg);
    return NextResponse.json(
      { error: msg },
      { status: msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireRole("super_admin");
    const body = await req.json();

    const created = await createUser({
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      role: body.role ?? "interviewer",
      password: body.password,
    });

    // Mirror the account into this organization. Without it the person exists
    // in the provider and is a member of nothing — they cannot be given a
    // role, and they do not appear in the directory, which lists members.
    await serverFetch<{ data: { id: number } }>("/users", {
      method: "POST",
      body: JSON.stringify({
        providerUserId: created.id,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        // The role travels with the account: the backend creates both
        // together, because an account with no membership is a member of
        // nothing and cannot be given a role afterwards.
        role: body.role ?? "interviewer",
        ...(body.clientCompanyId !== undefined && {
          clientCompanyId: body.clientCompanyId,
        }),
      }),
    });

    return NextResponse.json({ id: created.id, email: created.email });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: msg },
      { status: msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500 },
    );
  }
}
