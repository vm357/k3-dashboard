import type { AppEnv } from "../env";

/**
 * Security headers for every response the Worker sends (plan, security section).
 *
 * The Content Security Policy allows scripts only from this origin and inline scripts
 * carrying the per-request nonce; React Router's hydration script and React's streaming
 * scripts both carry it (entry.server.tsx, root.tsx). Styles allow inline because
 * Tailwind utilities and the few `style=` attributes (chart bars) need it; that is the
 * usual trade-off and it does not weaken script-src. Fonts come from Google Fonts.
 *
 * Development is exempt from CSP and HSTS: Vite's dev client injects its own inline
 * scripts and connects over a websocket, and HSTS on localhost would be a trap.
 */
export function newNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes));
}

export function securityHeaders(env: AppEnv, nonce: string): Record<string, string> {
	const headers: Record<string, string> = {
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"Referrer-Policy": "strict-origin-when-cross-origin",
		"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
		"Cross-Origin-Opener-Policy": "same-origin",
	};
	if (env.APP_ENV === "development") return headers;
	headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
	headers["Content-Security-Policy"] = [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}'`,
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"font-src 'self' https://fonts.gstatic.com",
		"img-src 'self' data: blob:",
		"connect-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"object-src 'none'",
	].join("; ");
	return headers;
}

export function withSecurityHeaders(response: Response, env: AppEnv, nonce: string): Response {
	const out = new Response(response.body, response);
	for (const [k, v] of Object.entries(securityHeaders(env, nonce))) out.headers.set(k, v);
	return out;
}
