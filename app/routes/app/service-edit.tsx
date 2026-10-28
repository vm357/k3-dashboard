import { Form, redirect, useNavigation, useRouteLoaderData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/service-edit";
import type { loader as layoutLoader } from "./business-layout";
import { Sheet } from "../../components/sheet";
import { Button, Field } from "../../components/ui";
import { requireTenant, services } from "../../../server/auth/session";
import { createService, getService, listServices, serviceInput, updateService } from "../../../server/domain/services/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Service · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const { categories } = await listServices(db, ctx);
	if (params.serviceId === "new") return { categories, service: null };
	const service = await getService(db, ctx, params.serviceId!);
	if (!service) throw new Response("Not found", { status: 404 });
	return { categories, service };
}

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const { ctx } = await requireTenant(db, auth, request, params.business!);
	const form = await request.formData();
	const raw = {
		name: form.get("name"),
		description: form.get("description") ?? "",
		categoryId: form.get("categoryId") ?? "",
		durationMinutes: form.get("durationMinutes"),
		bufferAfterMinutes: form.get("bufferAfterMinutes") || 0,
		priceCents: Math.round(Number(form.get("price") || 0) * 100),
		depositType: form.get("depositType") ?? "none",
		depositAmount: form.get("depositType") === "fixed" ? Math.round(Number(form.get("depositAmount") || 0) * 100) : Number(form.get("depositAmount") || 0),
		bookableOnline: form.get("bookableOnline") === "on",
	};
	const parsed = serviceInput.safeParse(raw);
	if (!parsed.success) {
		const e = z.flattenError(parsed.error).fieldErrors as Record<string, string[] | undefined>;
		return { errors: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v?.[0]])) as Record<string, string | undefined> };
	}
	try {
		if (params.serviceId === "new") await createService(db, ctx, parsed.data);
		else await updateService(db, ctx, params.serviceId!, parsed.data);
	} catch (err) {
		if ((err as { status?: number }).status === 403) throw new Response("Forbidden", { status: 403 });
		return { errors: { name: "Could not save. Try again." } };
	}
	throw redirect(`/app/${params.business}/services`);
}

export default function ServiceEdit({ loaderData, actionData }: Route.ComponentProps) {
	const data = useRouteLoaderData<typeof layoutLoader>("routes/app/business-layout")!;
	const closeTo = `/app/${data.ctx.businessSlug}/services`;
	const s = loaderData.service;
	const nav = useNavigation();
	const busy = nav.state !== "idle";
	const errors = actionData?.errors ?? {};
	const formId = "service-form";

	return (
		<Sheet
			title={s ? s.name : "New service"}
			closeTo={closeTo}
			footer={
				<Button type="submit" form={formId} size="lg" disabled={busy} className="w-full">
					{busy ? "Saving" : s ? "Save changes" : "Add service"}
				</Button>
			}
		>
			<Form id={formId} method="post" className="flex flex-col gap-4" noValidate>
				<Field label="Name" name="name" defaultValue={s?.name ?? ""} required error={errors.name} />
				<div className="grid grid-cols-2 gap-3">
					<Field label="Minutes" name="durationMinutes" type="number" inputMode="numeric" min={5} step={5} defaultValue={s?.durationMinutes ?? 60} required error={errors.durationMinutes} />
					<Field label="Price ($)" name="price" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={s ? (s.priceCents / 100).toFixed(2) : ""} required error={errors.priceCents} />
				</div>
				<Field
					label="Buffer after (minutes)"
					name="bufferAfterMinutes"
					type="number"
					inputMode="numeric"
					min={0}
					step={5}
					defaultValue={s?.bufferAfterMinutes ?? 0}
					hint="Cleanup time before the next client can start"
					error={errors.bufferAfterMinutes}
				/>
				{loaderData.categories.length > 0 ? (
					<div className="flex flex-col gap-1.5">
						<label htmlFor="categoryId" className="text-sm font-semibold">Category</label>
						<select id="categoryId" name="categoryId" defaultValue={s?.categoryId ?? ""} className="min-h-12 rounded-input border border-input-border bg-card px-3 text-base">
							<option value="">None</option>
							{loaderData.categories.map((c) => (
								<option key={c.id} value={c.id}>{c.name}</option>
							))}
						</select>
					</div>
				) : null}
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-1 text-sm font-semibold">Deposit</legend>
					<div className="grid grid-cols-3 gap-2">
						{(["none", "percent", "fixed"] as const).map((t) => (
							<label key={t} className="flex min-h-11 items-center justify-center rounded-pill border border-input-border bg-card text-sm font-semibold has-checked:border-cta has-checked:bg-mint has-checked:text-heading">
								<input type="radio" name="depositType" value={t} defaultChecked={(s?.depositType ?? "none") === t} className="sr-only" />
								{t === "none" ? "None" : t === "percent" ? "Percent" : "Fixed $"}
							</label>
						))}
					</div>
					<Field
						label="Deposit amount"
						name="depositAmount"
						type="number"
						inputMode="decimal"
						min={0}
						step="0.01"
						defaultValue={s ? (s.depositType === "fixed" ? (s.depositAmount / 100).toFixed(2) : s.depositAmount) : ""}
						hint="Percent of the price, or dollars for a fixed deposit"
						error={errors.depositAmount}
					/>
				</fieldset>
				<label className="flex min-h-11 items-center gap-3 text-sm">
					<input type="checkbox" name="bookableOnline" defaultChecked={s?.bookableOnline ?? true} className="h-5 w-5 accent-[#00754a]" />
					Clients can book this online (when online booking is on)
				</label>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="description" className="text-sm font-semibold">Description (optional)</label>
					<textarea id="description" name="description" rows={3} defaultValue={s?.description ?? ""} className="rounded-input border border-input-border bg-card px-3.5 py-2.5 text-base" />
				</div>
			</Form>
		</Sheet>
	);
}
