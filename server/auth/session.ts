import { redirect, type RouterContextProvider } from "react-router";
import { envContext } from "../context";
import { createDb, type Db } from "../db/client";
import { createAuth, type Auth } from "./auth";
import { listMemberships, resolveTenantCtx, type AdminCtx, type TenantCtx } from "./ctx";

/**
 * Per-request services for route loaders and actions. Built once per request from
 * the router context; never cached across requests.
 */
export function services(context: Pick<RouterContextProvider, "get">): { db: Db; auth: Auth } {
  const env = context.get(envContext);
  const db = createDb(env);
  return { db, auth: createAuth(db, env) };
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
}

export async function getUser(auth: Auth, request: Request): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const u = session.user as { id: string; name: string; email: string; isPlatformAdmin?: boolean };
  return { id: u.id, name: u.name, email: u.email, isPlatformAdmin: u.isPlatformAdmin === true };
}

/** Throws a redirect to sign-in (with return path) when there is no session. */
export async function requireUser(auth: Auth, request: Request): Promise<SessionUser> {
  const user = await getUser(auth, request);
  if (user) return user;
  const url = new URL(request.url);
  const next = encodeURIComponent(url.pathname + url.search);
  throw redirect(`/sign-in?next=${next}`);
}

/**
 * Requires a signed-in member of the business at `slug`. A non-member gets 404, not 403,
 * so the slug's existence is not confirmed (plan, auth section).
 */
export async function requireTenant(
  db: Db,
  auth: Auth,
  request: Request,
  slug: string,
): Promise<{ user: SessionUser; ctx: TenantCtx }> {
  const user = await requireUser(auth, request);
  const ctx = await resolveTenantCtx(db, user.id, slug);
  if (!ctx) throw new Response("Not found", { status: 404 });
  return { user, ctx };
}

export async function requireAdmin(auth: Auth, request: Request): Promise<{ user: SessionUser; ctx: AdminCtx }> {
  const user = await requireUser(auth, request);
  if (!user.isPlatformAdmin) throw new Response("Not found", { status: 404 });
  return { user, ctx: { userId: user.id, isPlatformAdmin: true } };
}

/** Where a signed-in user lands: their only business, a chooser, or the admin area. */
export async function homeFor(db: Db, user: SessionUser): Promise<string> {
  const memberships = await listMemberships(db, user.id);
  if (memberships.length === 1) return `/app/${memberships[0].slug}`;
  if (memberships.length > 1) return "/app";
  if (user.isPlatformAdmin) return "/admin";
  return "/no-business";
}

/** Only same-origin relative paths are honoured as a post-login destination. */
export function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
