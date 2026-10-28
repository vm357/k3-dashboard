import { Form, redirect, useNavigation, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/client-new";
import type { loader as layoutLoader } from "./business-layout";
import { Sheet } from "../../components/sheet";
import { Button, Field } from "../../components/ui";
import { requireTenant, services } from "../../../server/auth/session";
import { createCustomer, customerInput } from "../../../server/domain/customers/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "New client · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	await requireTenant(db, auth, request, params.business!);
	return null;
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const parsed = customerInput.safeParse({
		firstName: form.get("firstName"),
		lastName: form.get("lastName") ?? "",
		email: form.get("email") ?? "",
		phone: form.get("phone") ?? "",
		pinnedNote: form.get("pinnedNote") ?? "",
		marketingConsent: form.get("marketingConsent") === "on",
	});
	if (!parsed.success) {
		const e = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
		return { errors: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v?.[0]])) as Record<string, string | undefined> };
	}
	try {
		const c = await createCustomer(db, ctx, parsed.data);
		throw redirect(`/app/${params.business}/clients/${c.id}`);
	} catch (err) {
		if (err instanceof Response) throw err;
		const e = err as { status?: number; code?: string };
		if (e.status === 403) throw new Response("Forbidden", { status: 403 });
		if (e.code === "customer_email_exists") return { errors: { email: "A client with this email already exists" } };
		return { errors: { firstName: "Could not save. Try again." } };
	}
}

export default function ClientNew({ actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const closeTo = `/app/${data.ctx.businessSlug}/clients`;
	const nav = useNavigation();
	const busy = nav.state !== "idle";
	const errors = actionData?.errors ?? {};
	return (
		<Sheet
			title="New client"
			closeTo={closeTo}
			footer={
				<Button type="submit" form="client-form" size="lg" disabled={busy} className="w-full">
					{busy ? "Saving" : "Add client"}
				</Button>
			}
		>
			<Form id="client-form" method="post" className="flex flex-col gap-4" noValidate>
				<div className="grid grid-cols-2 gap-3">
					<Field label="First name" name="firstName" autoComplete="off" required error={errors.firstName} />
					<Field label="Last name" name="lastName" autoComplete="off" error={errors.lastName} />
				</div>
				<Field label="Phone" name="phone" type="tel" inputMode="tel" autoComplete="off" error={errors.phone} />
				<Field label="Email" name="email" type="email" inputMode="email" autoComplete="off" error={errors.email} />
				<div className="flex flex-col gap-1.5">
					<label htmlFor="pinnedNote" className="text-sm font-semibold">Always (pinned note)</label>
					<textarea id="pinnedNote" name="pinnedNote" rows={3} placeholder="Shape, length, sensitivities, how they like to be texted" className="rounded-input border border-input-border bg-card px-3.5 py-2.5 text-base" />
				</div>
				<label className="flex min-h-11 items-center gap-3 text-sm">
					<input type="checkbox" name="marketingConsent" className="h-5 w-5 accent-[#00754a]" />
					They agreed to receive promotions
				</label>
			</Form>
		</Sheet>
	);
}
