/**
 * Transactional emails, "plain letter" style (Phase 6 design, option 2b).
 * Every template returns both HTML and plain text. HTML is inline-styled tables-free
 * markup that survives Gmail and Apple Mail; nothing is loaded from the network.
 * Never put customer contact details in here: these go to staff only.
 */

export interface OutgoingEmail {
	to: string;
	/** Display name for the From header; the address is fixed in send.ts. */
	fromName: string;
	subject: string;
	html: string;
	text: string;
}

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const INK = "rgba(0,0,0,0.87)";
const SOFT = "rgba(0,0,0,0.58)";

function letter(body: string): string {
	return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f2f0eb;font-family:Manrope,'Helvetica Neue',Helvetica,Arial,sans-serif;color:${INK}">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:36px">
${body}
<p style="margin:28px 0 0;font-size:13px;color:${SOFT}">K3 Dashboard by Kermit Webcraft</p>
</div></body></html>`;
}

export function resetCodeEmail(input: { to: string; code: string }): OutgoingEmail {
	const spaced = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;
	return {
		to: input.to,
		fromName: "K3 Dashboard",
		// The code leads the subject so it shows in the phone's notification and keyboard autofill.
		subject: `${input.code} is your K3 reset code`,
		html: letter(`<p style="margin:0 0 18px;font-size:16px;line-height:1.6">Use this code to reset the password for ${esc(input.to)}:</p>
<p style="margin:0 0 18px"><span style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:8px;color:#006241;background:#d4e9e2;border-radius:12px;padding:12px 20px">${spaced}</span></p>
<p style="margin:0;font-size:14px;line-height:1.5;color:${SOFT}">It expires in 10 minutes. If you didn't ask for it, ignore this email; your password stays the same.</p>`),
		text: `Use this code to reset the password for ${input.to}:\n\n${spaced}\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email; your password stays the same.\n\nK3 Dashboard by Kermit Webcraft`,
	};
}

export function invitationEmail(input: {
	to: string;
	inviterName: string;
	businessName: string;
	role: "owner" | "employee";
	link: string;
	expiresAt: Date;
	timeZone?: string;
}): OutgoingEmail {
	const firstName = input.inviterName.split(/\s+/)[0] || input.inviterName;
	const expires = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: input.timeZone ?? "UTC" }).format(input.expiresAt);
	const roleText = input.role === "owner" ? "an owner" : "an employee";
	return {
		to: input.to,
		fromName: `${firstName} at ${input.businessName}`,
		subject: `Join ${input.businessName} on K3`,
		html: letter(`<p style="margin:0 0 18px;font-size:16px;line-height:1.6">Hi,</p>
<p style="margin:0 0 22px;font-size:16px;line-height:1.6">${esc(firstName)} added you to <strong>${esc(input.businessName)}</strong> on K3, the app the studio uses for appointments and client notes. You're joining as ${roleText}.</p>
<p style="margin:0 0 22px"><a href="${esc(input.link)}" style="display:inline-block;padding:12px 24px;border-radius:50px;border:1px solid #006241;color:#006241;font-weight:600;font-size:16px;text-decoration:none">Set your password</a></p>
<p style="margin:0;font-size:14px;line-height:1.5;color:${SOFT}">For ${esc(input.to)}. Works once, expires ${esc(expires)}.<br>Or paste this link: <a href="${esc(input.link)}" style="color:#00754a;word-break:break-all">${esc(input.link)}</a></p>`),
		text: `Hi,\n\n${firstName} added you to ${input.businessName} on K3, the app the studio uses for appointments and client notes. You're joining as ${roleText}.\n\nSet your password: ${input.link}\n\nFor ${input.to}. Works once, expires ${expires}.\n\nK3 Dashboard by Kermit Webcraft`,
	};
}
