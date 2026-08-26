import { NextResponse, type NextRequest } from "next/server";
import { serverFetch } from "@/lib/auth-action";
import { requireRole } from "@/lib/require-role";
import { deleteUser, updateUser } from "@/lib/auth/directory";
import type { User } from "@/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const status = (msg: string) =>
  msg === "Unauthorized" || msg === "Forbidden" ? 401 : 500;

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requireRole("super_admin");
    const { id } = await context.params;
    const data = await serverFetch<{ data: User }>(`/users/${id}`);
    return NextResponse.json(data.data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: status(msg) });
  }
}

/**
 * Changes a user's profile, role, and client company.
 *
 * The role is written to **both** the provider and the membership, and only
 * the membership takes effect. The provider's copy seeds a membership at first
 * sign-in and is ignored afterwards, so writing only there — which the previous
 * integration did — changed what the screen showed and nothing about what the
 * person could do.
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    await requireRole("super_admin");
    const { id } = await context.params;
    const body = await req.json();

    const existing = await serverFetch<{ data: User & { asgardeoUserId?: string } }>(
      `/users/${id}`,
    );
    const providerId = existing.data.asgardeoUserId;

    if (
      providerId &&
      (body.firstName !== undefined ||
        body.lastName !== undefined ||
        body.email !== undefined ||
        body.role !== undefined)
    ) {
      // Best-effort: the membership below is what governs access, and a
      // provider outage should not block an administrator from changing it.
      await updateUser(providerId, {
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
      }).catch(() => {});
    }

    if (body.role !== undefined || body.clientCompanyId !== undefined) {
      await serverFetch<{ data: unknown }>(`/users/${id}/membership`, {
        method: "PUT",
        body: JSON.stringify({
          ...(body.role !== undefined && { role: body.role }),
          ...(body.clientCompanyId !== undefined && {
            clientCompanyId: body.clientCompanyId,
          }),
        }),
      });
    }

    const updated = await serverFetch<{ data: User }>(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...(body.firstName !== undefined && { firstName: body.firstName }),
        ...(body.lastName !== undefined && { lastName: body.lastName }),
      }),
    });

    return NextResponse.json(updated.data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: status(msg) });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    await requireRole("super_admin");
    const { id } = await context.params;

    const existing = await serverFetch<{ data: User & { asgardeoUserId?: string } }>(
      `/users/${id}`,
    );

    // The application first: it deactivates rather than deletes, so the
    // organization keeps its record of who did what. Removing the account from
    // the provider only stops them signing in again.
    await serverFetch<{ data: unknown }>(`/users/${id}`, { method: "DELETE" });

    if (existing.data.asgardeoUserId) {
      await deleteUser(existing.data.asgardeoUserId).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: status(msg) });
  }
}
