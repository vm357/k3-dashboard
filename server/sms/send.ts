import type { AppEnv } from "../env";

export interface OutgoingSms {
	to: string;
	body: string;
}

/** Test mode captures texts here instead of sending them. */
export const smsOutbox: OutgoingSms[] = [];

export class SmsNotConfigured extends Error {
	readonly code = "sms_not_configured";
}
export class SmsError extends Error {
	readonly code = "sms_failed";
	constructor(public readonly status: number) {
		super(`SMS provider returned ${status}`);
	}
}

/** True when texts can go out automatically. Otherwise the panel offers "Open Messages" instead. */
export function smsConfigured(env: AppEnv | undefined): boolean {
	if (!env) return false;
	return env.APP_ENV === "test" || !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
}

/** Twilio's Messages API over fetch (no SDK; works on Workers). Never logs the body or number. */
export async function sendSms(env: AppEnv, sms: OutgoingSms): Promise<void> {
	if (env.APP_ENV === "test") {
		smsOutbox.push(sms);
		return;
	}
	if (!smsConfigured(env)) throw new SmsNotConfigured("Texting is not set up yet");
	const sid = env.TWILIO_ACCOUNT_SID!;
	const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
		method: "POST",
		headers: { authorization: `Basic ${btoa(`${sid}:${env.TWILIO_AUTH_TOKEN}`)}`, "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ To: sms.to, From: env.TWILIO_FROM_NUMBER!, Body: sms.body }),
	});
	if (!res.ok) {
		console.error(`[sms] twilio rejected status=${res.status}`);
		throw new SmsError(res.status);
	}
}
