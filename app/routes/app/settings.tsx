import { Form, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/settings";
import type { loader as layoutLoader } from "./business-layout";
import { Page } from "../../components/shell";
import { Button, ButtonLink, Card, Field, PageTitle } from "../../components/ui";
import { hasPermission } from "../../../server/auth/permissions";
import { requireTenant, services } from "../../../server/auth/session";
import { updateBusinessSettings } from "../../../server/domain/businesses/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Settings · K3 Dashboard" }];
}

const schema = z.object({
	name: z.string().trim().min(2, "At least 2 characters").max(80),
	timeZone: z.string().min(1),
});

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const parsed = schema.safeParse({ name: form.get("name"), timeZone: form.get("timeZone") });
	if (!parsed.success) {
		const e = z.flattenError(parsed.error).fieldErrors;
		return { ok: false as const, errors: { name: e.name?.[0], timeZone: e.timeZone?.[0] } };
	}
	try {
		await updateBusinessSettings(db, ctx, parsed.data);
	} catch (err) {
		if ((err as { status?: number }).status === 403) throw new Response("Forbidden", { status: 403 });
		return { ok: false as const, errors: { timeZone: "Unknown time zone" } };
	}
	return { ok: true as const, errors: {} };
}

export default function Settings({ actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const editable = hasPermission(data.ctx.role, data.ctx.permissions, "settings.edit");
	const base = `/app/${data.ctx.businessSlug}`;

	return (
		<Page>
			<PageTitle title="Settings" />
			<Card className="flex flex-col gap-4">
				<h2 className="text-base font-bold">Business</h2>
				<Form method="post" className="flex flex-col gap-4">
					<Field label="Business name" name="name" defaultValue={data.business.name} disabled={!editable} error={actionData?.errors?.name} />
					<Field
						label="Time zone"
						name="timeZone"
						defaultValue={data.business.timeZone}
						disabled={!editable}
						hint="IANA name, for example America/New_York"
						error={actionData?.errors?.timeZone}
					/>
					{actionData?.ok ? <p role="status" className="text-sm font-semibold text-heading">Saved</p> : null}
					{editable ? (
						<Button type="submit" className="self-start">
							Save changes
						</Button>
					) : (
						<p className="text-sm text-ink-soft">Only the owner can change these.</p>
					)}
				</Form>
			</Card>
			<Card className="flex items-center justify-between gap-3">
				<div className="flex flex-col">
					<h2 className="text-base font-bold">Team</h2>
					<span className="text-sm text-ink-soft">Invite employees and set what they can see.</span>
				</div>
				<ButtonLink to={`${base}/team`} variant="outlined" size="sm">
					Manage
				</ButtonLink>
			</Card>
			<form method="post" action="/sign-out" className="lg:hidden">
				<Button type="submit" variant="quiet" className="w-full">
					Sign out
				</Button>
			</form>
		</Page>
	);
}
