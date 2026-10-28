import { Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/sign-in";
import { Button, Field } from "../../components/ui";
import { getUser, homeFor, safeNext, services } from "../../../server/auth/session";

export function meta(): Route.MetaDescriptors {
	return [{ title: "Sign in · K3 Dashboard" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const user = await getUser(auth, request);
	if (user) throw redirect(safeNext(new URL(request.url).searchParams.get("next")) ?? (await homeFor(db, user)));
	return null;
}

const schema = z.object({
	email: z.email("Enter the email address you were invited with"),
	password: z.string().min(1, "Enter your password"),
});

export async function action({ request, context }: Route.ActionArgs) {
	const { db, auth } = services(context);
	const form = await request.formData();
	const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
	if (!parsed.success) {
		const errors = z.flattenError(parsed.error).fieldErrors;
		return { errors: { email: errors.email?.[0], password: errors.password?.[0] }, message: undefined };
	}

	let response: Response;
	try {
		response = await auth.api.signInEmail({
			body: { email: parsed.data.email.toLowerCase(), password: parsed.data.password },
			headers: request.headers,
			asResponse: true,
		});
	} catch {
		return { errors: {}, message: "That email and password do not match." };
	}
	if (!response.ok) return { errors: {}, message: "That email and password do not match." };

	// Figure out where to land using the new session's cookie.
	const setCookie = response.headers.get("set-cookie") ?? "";
	const probe = new Request(request.url, { headers: { cookie: setCookie.split(";")[0] } });
	const user = await getUser(auth, probe);
	const next = safeNext(new URL(request.url).searchParams.get("next"));
	const to = next ?? (user ? await homeFor(db, user) : "/");
	const headers = new Headers();
	for (const [k, v] of response.headers) if (k.toLowerCase() === "set-cookie") headers.append("set-cookie", v);
	throw redirect(to, { headers });
}

export default function SignIn({ actionData }: Route.ComponentProps) {
	const nav = useNavigation();
	const busy = nav.state !== "idle";
	return (
		<main className="flex min-h-dvh flex-col justify-end bg-feature lg:items-center lg:justify-center">
			<div className="hidden px-6 pb-8 text-on-dark lg:block lg:pb-0 lg:pr-16">
				<p className="text-sm text-on-dark-soft">K3 Dashboard</p>
			</div>
			<section className="w-full rounded-t-[20px] bg-canvas px-5 pt-7 pb-10 shadow-nav lg:max-w-md lg:rounded-card lg:p-8">
				<div className="mb-6 flex flex-col gap-1">
					<span className="text-sm text-ink-soft">K3 Dashboard</span>
					<h1 className="text-[28px] font-bold leading-tight text-heading">Sign in</h1>
				</div>
				<Form method="post" className="flex flex-col gap-4" noValidate>
					<Field
						label="Email"
						name="email"
						type="email"
						autoComplete="email"
						inputMode="email"
						required
						error={actionData?.errors?.email}
					/>
					<Field
						label="Password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
						error={actionData?.errors?.password}
					/>
					{actionData?.message ? (
						<p role="alert" className="rounded-card bg-card px-3.5 py-3 text-sm text-danger shadow-card">
							{actionData.message}
						</p>
					) : null}
					<Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
						{busy ? "Signing in" : "Sign in"}
					</Button>
				</Form>
				<p className="mt-6 text-center text-sm text-ink-soft">
					No account yet? Your business owner can send you an invitation.
				</p>
			</section>
		</main>
	);
}
