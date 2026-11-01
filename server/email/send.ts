import type { AppEnv } from "../env";
import type { OutgoingEmail } from "./templates";

/**
 * Sends through Resend's HTTP API (no SDK: one fetch, works on Workers).
 *
 * development: without RESEND_API_KEY the email is printed to the console instead.
 * test: always captured in `outbox`, never sent.
 * staging/production: RESEND_API_KEY is required; a failed send throws so the caller
 * can fall back (the Team page shows the copyable link).
 */
export const outbox: OutgoingEmail[] = [];

export class EmailError extends Error {
	constructor(public status: number) {
		super(`email_send_failed_${status}`);
	}
}

export async function sendEmail(env: AppEnv, email: OutgoingEmail): Promise<void> {
	if (env.APP_ENV === "test") {
		outbox.push(email);
		return;
	}
	if (!env.RESEND_API_KEY) {
		if (env.APP_ENV === "development") {
			console.info(`[email] to=${email.to} subject="${email.subject}"\n${email.text}`);
			return;
		}
		throw new EmailError(0);
	}
	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
		body: JSON.stringify({
			from: `${email.fromName.replace(/["<>]/g, "")} <${env.EMAIL_FROM_ADDRESS}>`,
			to: [email.to],
			subject: email.subject,
			html: email.html,
			text: email.text,
		}),
	});
	// Recipient and status only; never the body, which may hold a reset code.
	if (!res.ok) {
		console.error(`[email] resend rejected status=${res.status}`);
		throw new EmailError(res.status);
	}
}
