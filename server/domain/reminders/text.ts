/** Pure reminder-text helpers; safe to import from page components (no database code). */

export const DEFAULT_REMINDER =
	"Hi {first_name}, this is {business} reminding you of your {service} appointment on {date} at {time} with {staff}. Reply Y to confirm or N if you can't make it.";
export const REMINDER_PLACEHOLDERS = ["first_name", "business", "service", "date", "time", "staff"] as const;

/** Unknown placeholders are left as typed so the owner sees the mistake in the preview. */
export function renderReminder(template: string, vars: Record<(typeof REMINDER_PLACEHOLDERS)[number], string>): string {
	return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k as keyof typeof vars] : m));
}

export function reminderVars(a: { firstName: string; business: string; services: string[]; startAt: Date; staff: string; timeZone: string }) {
	const date = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: a.timeZone }).format(a.startAt);
	const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: a.timeZone }).format(a.startAt).replace(":00", "").toLowerCase().replace(" ", "");
	return { first_name: a.firstName, business: a.business, service: a.services.join(" + ") || "nail", date, time, staff: a.staff };
}
