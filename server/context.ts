import { createContext } from "react-router";
import type { AppEnv } from "./env";

/**
 * Typed keys for React Router's request context. The Worker sets them once per
 * request; loaders and actions read them with context.get(...). Route modules may
 * import this file (it carries no database code), but nothing under app/ may import
 * server/db directly: pages call domain services, domain services take a ctx.
 */
export const envContext = createContext<AppEnv>();
export const executionContext = createContext<ExecutionContext>();
