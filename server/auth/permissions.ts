/**
 * Permission keys. A closed union: an unknown key does not compile, and a new
 * capability is a new key here plus a check at the service that enforces it.
 *
 * Owners hold every key implicitly. Employees hold only what the owner grants.
 * Platform admins hold no tenant keys at all; they act through withBypass and
 * the audited admin services instead.
 */
export const PERMISSION_KEYS = [
	"settings.view",
	"settings.edit",
	"team.view",
	"team.manage",
	"services.view",
	"services.manage",
	"calendar.view_own",
	"calendar.view_all",
	"appointments.manage_own",
	"appointments.manage_all",
	"customers.view",
	"customers.edit",
	"customers.view_contact",
	"payments.view",
	"payments.charge",
	"payments.refund",
	"reports.view",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
	return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** The default grant for a new employee: their own calendar and customer basics. */
export const DEFAULT_EMPLOYEE_PERMISSIONS: PermissionKey[] = [
	"calendar.view_own",
	"appointments.manage_own",
	"customers.view",
	"services.view",
];

/** Browser-safe check used by pages; the server-side `can(ctx, key)` in ctx.ts is the authority. */
export function hasPermission(role: "owner" | "employee", permissions: readonly string[], key: PermissionKey): boolean {
	if (role === "owner" || permissions.includes(key)) return true;
	const implied: Record<string, PermissionKey[]> = {
		"calendar.view_all": ["calendar.view_own"],
		"appointments.manage_all": ["appointments.manage_own", "calendar.view_all", "calendar.view_own"],
		"customers.edit": ["customers.view"],
		"services.manage": ["services.view"],
		"team.manage": ["team.view"],
		"settings.edit": ["settings.view"],
	};
	return permissions.some((held) => implied[held]?.includes(key));
}
