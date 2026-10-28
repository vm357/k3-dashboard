import { Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/new-business";
import { Button, Card, Field, PageTitle } from "../../components/ui";
import { envContext } from "../../../server/context";
import { requireAdmin, services } from "../../../server/auth/session";
import { onboardBusiness, onboardSchema, slugAvailable } from "../../../server/domain/admin/onboarding";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Add a business · Kermit admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const { auth } = services(context);
	await requireAdmin(auth, request);
	return null;
}

export async function action({ request, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireAdmin(auth, request);
	const form = await request.formData();
	const parsed = onboardSchema.safeParse({
		name: form.get("name"),
		slug: form.get("slug"),
		timeZone: form.get("timeZone") || "America/New_York",
		ownerEmail: form.get("ownerEmail"),
	});
	if (!parsed.success) {
		const e = z.flattenError(parsed.error).fieldErrors;
		return { errors: { name: e.name?.[0], slug: e.slug?.[0], timeZone: e.timeZone?.[0], ownerEmail: e.ownerEmail?.[0] }, done: undefined };
	}
	if (!(await slugAvailable(db, parsed.data.slug))) {
		return { errors: { slug: "That web address is taken" }, done: undefined };
	}
	const { business, inviteToken } = await onboardBusiness(db, ctx, parsed.data);
	const origin = context.get(envContext).APP_ORIGIN;
	return {
		errors: {},
		done: {
			name: business.name,
			slug: business.slug,
			inviteLink: inviteToken ? `${origin}/invite/${inviteToken}` : null,
			ownerEmail: parsed.data.ownerEmail,
		},
	};
}

export default function NewBusiness({ actionData }: Route.ComponentProps) {
	const nav = useNavigation();
	const busy = nav.state !== "idle";

	if (actionData?.done) {
		const d = actionData.done;
		return (
			<>
				<PageTitle title={`${d.name} is set up`} />
				<Card className="flex flex-col gap-3">
					{d.inviteLink ? (
						<>
							<p className="text-sm">
								{d.ownerEmail} does not have an account yet. Send them this link; it makes them the owner and expires in 7 days.
							</p>
							<code className="break-all rounded-input bg-quiet px-3 py-2 text-xs">{d.inviteLink}</code>
						</>
					) : (
						<p className="text-sm">{d.ownerEmail} already had an account and is now the owner. They can sign in right away.</p>
					)}
					<div className="flex gap-2">
						<Link to="/admin" className="press rounded-pill border border-heading bg-card px-5 py-3 text-sm font-semibold text-heading">
							Back to businesses
						</Link>
						<Link to={`/app/${d.slug}`} className="press rounded-pill bg-cta px-5 py-3 text-sm font-semibold text-on-dark">
							Open {d.name}
						</Link>
					</div>
				</Card>
			</>
		);
	}

	return (
		<>
			<PageTitle title="Add a business" />
			<Card>
				<Form method="post" className="flex max-w-md flex-col gap-4" noValidate>
					<Field label="Business name" name="name" required error={actionData?.errors?.name} />
					<Field
						label="Web address"
						name="slug"
						required
						hint="Lowercase letters, numbers and hyphens. Becomes /app/<address>."
						error={actionData?.errors?.slug}
					/>
					<Field
						label="Time zone"
						name="timeZone"
						defaultValue="America/New_York"
						hint="IANA name"
						error={actionData?.errors?.timeZone}
					/>
					<Field label="Owner's email" name="ownerEmail" type="email" inputMode="email" required error={actionData?.errors?.ownerEmail} />
					<Button type="submit" disabled={busy} className="self-start">
						{busy ? "Creating" : "Create business"}
					</Button>
				</Form>
			</Card>
		</>
	);
}
