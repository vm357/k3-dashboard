import { z } from "zod";

export const slugSchema = z
	.string()
	.min(3)
	.max(40)
	.regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "lowercase letters, numbers and hyphens only");

export const createBusinessSchema = z.object({
	name: z.string().trim().min(2).max(80),
	slug: slugSchema,
	timeZone: z.string().refine(isValidTimeZone, "unknown time zone").default("America/New_York"),
});
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;

export const updateBusinessSettingsSchema = z
	.object({
		name: z.string().trim().min(2).max(80),
		timeZone: z.string().refine(isValidTimeZone, "unknown time zone"),
		branding: z.record(z.string(), z.unknown()),
		bookingPolicy: z.record(z.string(), z.unknown()),
	})
	.partial();
export type UpdateBusinessSettingsInput = z.infer<typeof updateBusinessSettingsSchema>;

function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}
