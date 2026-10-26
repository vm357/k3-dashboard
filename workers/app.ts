import { createRequestHandler, RouterContextProvider } from "react-router";
import { apiApp } from "../server/api/app";
import { envContext, executionContext } from "../server/context";
import { readEnv } from "../server/env";

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
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/api/") || pathname.startsWith("/webhooks/")) {
			return apiApp.fetch(request, env, ctx);
		}
		const context = new RouterContextProvider();
		context.set(envContext, env);
		context.set(executionContext, ctx);
		return requestHandler(request, context);
	},
} satisfies ExportedHandler<Env>;
