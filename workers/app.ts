import { createRequestHandler, RouterContextProvider } from "react-router";
import { apiApp } from "../server/api/app";
import { envContext, executionContext, nonceContext } from "../server/context";
import { readEnv } from "../server/env";
import { newNonce, withSecurityHeaders } from "../server/http/security";

/**
 * Worker entry. One deployment, three handlers:
 *  - fetch:  /api/* and /webhooks/* go to Hono; everything else to React Router.
 *  - queue:  consumers arrive in phase 6.
 *  - scheduled: cron handlers arrive in phase 3 (hold expiry) and 5 (reconciliation).
 *
 * Nothing here holds state between requests. Secrets are read through readEnv and
 * never reach the browser bundle.
 */
const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

export default {
	async fetch(request, rawEnv, ctx) {
		const env = readEnv(rawEnv);
		const nonce = newNonce();
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/api/") || pathname.startsWith("/webhooks/")) {
			return withSecurityHeaders(await apiApp.fetch(request, env, ctx), env, nonce);
		}
		const context = new RouterContextProvider();
		context.set(envContext, env);
		context.set(executionContext, ctx);
		context.set(nonceContext, nonce);
		return withSecurityHeaders(await requestHandler(request, context), env, nonce);
	},
} satisfies ExportedHandler<Env>;
