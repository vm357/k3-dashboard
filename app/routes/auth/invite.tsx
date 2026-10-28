import { Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/invite";
import { Button, Field } from "../../components/ui";
import { getUser, services } from "../../../server/auth/session";
import { acceptInvitation, previewInvitation } from "../../../server/domain/invitations/service";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Join · K3 Dashboard" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const preview = await previewInvitation(db, params.token!);
	if (!preview) return { state: "invalid" as const };
	const user = await getUser(auth, request);
	if (user) {
		if (user.email.toLowerCase() !== preview.email) return { state: "wrong-account" as const, preview, signedInAs: user.email };
		const { businessSlug } = await acceptInvitation(db, params.token!, user.id);
		throw redirect(`/app/${businessSlug}`);
	}
	return { state: "new" as const, preview };
}

const schema = z.object({
	name: z.string().trim().min(2, "Enter your name").max(80),
	password: z.string().min(12, "Use at least 12 characters"),
});

export async function action({ request, params, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const preview = await previewInvitation(db, params.token!);
	if (!preview) return { errors: {}, message: "This invitation is no longer valid." };
	const form = await request.formData();
	const parsed = schema.safeParse({ name: form.get("name"), password: form.get("password") });
	if (!parsed.success) {
		const e = z.flattenError(parsed.error).fieldErrors;
		return { errors: { name: e.name?.[0], password: e.password?.[0] }, message: undefined };
	}

	// Create the login through Better Auth with the invitation's email, then bind the membership.
	let response: Response;
	try {
		response = await auth.api.signUpEmail({
			body: { email: preview.email, password: parsed.data.password, name: parsed.data.name },
			headers: request.headers,
			asResponse: true,
		});
	} catch {
		return { errors: {}, message: "An account with this email already exists. Sign in, then open this link again." };
	}
	if (!response.ok) {
		return { errors: {}, message: "An account with this email already exists. Sign in, then open this link again." };
	}
	const setCookie = response.headers.get("set-cookie") ?? "";
	const probe = new Request(request.url, { headers: { cookie: setCookie.split(";")[0] } });
	const user = await getUser(auth, probe);
	if (!user) return { errors: {}, message: "Could not sign you in. Try again." };
	const { businessSlug } = await acceptInvitation(db, params.token!, user.id);
	const headers = new Headers();
	for (const [k, v] of response.headers) if (k.toLowerCase() === "set-cookie") headers.append("set-cookie", v);
	throw redirect(`/app/${businessSlug}`, { headers });
}

export default function Invite({ loaderData, actionData }: Route.ComponentProps) {
	const nav = useNavigation();
	const busy = nav.state !== "idle";

	if (loaderData.state === "invalid") {
		return (
			<main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
				<h1 className="text-2xl font-bold text-heading">This invitation has expired</h1>
				<p className="max-w-sm text-ink-soft">Ask the business owner to send a new one.</p>
			</main>
		);
	}
	if (loaderData.state === "wrong-account") {
		return (
			<main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
				<h1 className="text-2xl font-bold text-heading">This invitation is for a different email</h1>
				<p className="max-w-sm text-ink-soft">
					You are signed in as {loaderData.signedInAs}. Sign out, then open the link again.
				</p>
				<form method="post" action="/sign-out">
					<Button type="submit" variant="outlined">Sign out</Button>
				</form>
			</main>
		);
	}

	const { preview } = loaderData;
	return (
		<main className="flex min-h-dvh flex-col justify-end bg-feature lg:items-center lg:justify-center">
			<section className="w-full rounded-t-[20px] bg-canvas px-5 pt-7 pb-10 shadow-nav lg:max-w-md lg:rounded-card lg:p-8">
				<div className="mb-6 flex flex-col gap-1">
					<span className="text-sm text-ink-soft">You are invited to</span>
					<h1 className="text-[28px] font-bold leading-tight text-heading">{preview.businessName}</h1>
					<span className="text-sm text-ink-soft">
						as {preview.role === "owner" ? "an owner" : "an employee"} · {preview.email}
					</span>
				</div>
				<Form method="post" className="flex flex-col gap-4" noValidate>
					<Field label="Your name" name="name" autoComplete="name" required error={actionData?.errors?.name} />
					<Field
						label="Choose a password"
						name="password"
						type="password"
						autoComplete="new-password"
						required
						hint="At least 12 characters"
						error={actionData?.errors?.password}
					/>
					{actionData?.message ? (
						<p role="alert" className="rounded-card bg-card px-3.5 py-3 text-sm text-danger shadow-card">{actionData.message}</p>
					) : null}
					<Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
						{busy ? "Joining" : `Join ${preview.businessName}`}
					</Button>
				</Form>
			</section>
		</main>
	);
}
