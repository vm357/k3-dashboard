import { createContext } from "react-router";
import type { AppEnv } from "./env";
import type { Auth } from "./auth/auth";
import type { Db } from "./db/client";

/**
 * Typed keys for React Router's request context. The Worker sets them once per
 * request; loaders and actions read them with context.get(...). Route modules may
 * import this file (it carries no database code), but nothing under app/ may import
 * server/db directly: pages call domain services, domain services take a ctx.
 */
export const envContext = createContext<AppEnv>();
export const executionContext = createContext<ExecutionContext>();
/** One database client and auth instance per request, shared by every loader in that request. */
export const servicesContext = createContext<{ db: Db; auth: Auth } | null>(null);
/** Per-request CSP nonce, carried to entry.server.tsx and the root route. */
export const nonceContext = createContext<string>("");
