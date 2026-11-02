import { useEffect, useRef, useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/forgot";
import { Badge, Button, Field } from "../../components/ui";
import { getUser, homeFor, services } from "../../../server/auth/session";
import { clientIp, hit } from "../../../server/http/throttle";

/**
 * Password reset by six-digit email code (Phase 6, design 1b). One route, three steps
 * carried in action data: email → code → new password. Better Auth's email OTP plugin
 * holds the code (10 minutes, 3 attempts); this route adds IP and email throttling
 * because server-side auth.api calls skip Better Auth's own rate limiter.
 */

export function meta(): Route.MetaDescriptors {
	return [{ title: "Reset password · K3 Dashboard" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const { db, auth } = services(context);
	const user = await getUser(auth, request);
	if (user) throw redirect(await homeFor(db, user));
	return null;
}

const RESEND_SECONDS = 45;
const email = z.email("Enter the email you sign in with").transform((e) => e.toLowerCase());
const otp = z.string().regex(/^\d{6}$/, "Enter all six digits");

type Step = "email" | "code" | "password";
type Data = { step: Step; email?: string; otp?: string; error?: string; resendIn?: number };

export async function action({ request, context }: Route.ActionArgs): Promise<Data> {
	const { db, auth } = services(context);
	const form = await request.formData();
	const intent = String(form.get("intent"));
	const ip = clientIp(request);

	if (intent === "send") {
		const parsed = email.safeParse(form.get("email"));
		if (!parsed.success) return { step: "email", error: parsed.error.issues[0].message };
		const addr = parsed.data;
		const allowed = (await hit(db, `forgot-ip:${ip}`, 600, 10)) && (await hit(db, `forgot-email:${addr}`, 600, 3));
		if (!allowed) return { step: "code", email: addr, error: "Too many codes requested. Wait a few minutes, then send a new one.", resendIn: RESEND_SECONDS };
		// Same answer whether or not the address has a login; the plugin sends nothing for unknown emails.
		try {
			await auth.api.requestPasswordResetEmailOTP({ body: { email: addr } });
		} catch (err) {
			console.error("[forgot] send failed", (err as Error).message);
		}
		return { step: "code", email: addr, resendIn: RESEND_SECONDS };
	}

	const addr = email.safeParse(form.get("email"));
	if (!addr.success) return { step: "email", error: "Start again with your email." };

	if (intent === "check") {
		const code = otp.safeParse(form.get("otp"));
		if (!code.success) return { step: "code", email: addr.data, error: code.error.issues[0].message };
		if (!(await hit(db, `forgot-check:${ip}`, 600, 20))) return { step: "code", email: addr.data, error: "Too many tries. Wait a few minutes." };
		try {
			await auth.api.checkVerificationOTP({ body: { email: addr.data, type: "forget-password", otp: code.data } });
		} catch (err) {
			return { step: "code", email: addr.data, error: otpMessage(err) };
		}
		return { step: "password", email: addr.data, otp: code.data };
	}

	if (intent === "reset") {
		const code = otp.safeParse(form.get("otp"));
		const password = String(form.get("password") ?? "");
		if (!code.success) return { step: "code", email: addr.data, error: "Enter the code again." };
		if (password.length < 12) return { step: "password", email: addr.data, otp: code.data, error: "Use at least 12 characters" };
		try {
			await auth.api.resetPasswordEmailOTP({ body: { email: addr.data, otp: code.data, password } });
		} catch (err) {
			return { step: "code", email: addr.data, error: otpMessage(err) };
		}
		// Signed out everywhere by the reset; sign in here and land where Sign in would.
		const response = await auth.api.signInEmail({ body: { email: addr.data, password }, headers: request.headers, asResponse: true });
		if (!response.ok) throw redirect("/sign-in");
		const headers = new Headers();
		for (const [k, v] of response.headers) if (k.toLowerCase() === "set-cookie") headers.append("set-cookie", v);
		const probe = new Request(request.url, { headers: { cookie: (response.headers.get("set-cookie") ?? "").split(";")[0] } });
		const user = await getUser(auth, probe);
		throw redirect(user ? await homeFor(db, user) : "/", { headers });
	}

	return { step: "email" };
}

function otpMessage(err: unknown): string {
	const code = (err as { body?: { code?: string } }).body?.code ?? "";
	if (code.includes("TOO_MANY")) return "Too many tries. Send yourself a new code.";
	if (code.includes("EXPIRED")) return "That code has expired. Send yourself a new one.";
	return "That code doesn't match. Check the latest email and try again.";
}

export default function Forgot({ actionData }: Route.ComponentProps) {
	const nav = useNavigation();
	const busy = nav.state !== "idle";
	const step: Step = actionData?.step ?? "email";

	return (
		<main className="flex min-h-dvh flex-col justify-end bg-feature lg:items-center lg:justify-center">
			<div className="flex flex-1 items-end px-6 pb-8 lg:flex-none lg:pb-6">
				<span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-base font-extrabold text-heading">K3</span>
			</div>
			<section className="w-full rounded-t-[20px] bg-canvas px-5 pt-7 pb-10 shadow-nav lg:max-w-md lg:rounded-card lg:p-8">
				{step === "email" ? <EmailStep busy={busy} error={actionData?.error} /> : null}
				{step === "code" ? <CodeStep key={actionData?.email} busy={busy} email={actionData!.email!} error={actionData?.error} resendIn={actionData?.resendIn} /> : null}
				{step === "password" ? <PasswordStep busy={busy} email={actionData!.email!} otp={actionData!.otp!} error={actionData?.error} /> : null}
			</section>
		</main>
	);
}

function Heading({ title, body }: { title: string; body?: string }) {
	return (
		<div className="mb-6 flex flex-col gap-1.5">
			<h1 className="text-[28px] font-bold leading-tight text-heading">{title}</h1>
			{body ? <p className="text-[15px] leading-snug text-ink-soft">{body}</p> : null}
		</div>
	);
}

function EmailStep({ busy, error }: { busy: boolean; error?: string }) {
	return (
		<>
			<Heading title="Reset your password" body="We'll email you a six-digit code. Keep this screen open." />
			<Form method="post" className="flex flex-col gap-4" noValidate>
				<input type="hidden" name="intent" value="send" />
				<Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" required error={error} />
				<Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">{busy ? "Sending" : "Email me a code"}</Button>
				<Link to="/sign-in" className="flex min-h-11 items-center justify-center text-[15px] font-semibold text-ink-soft">Back to sign in</Link>
			</Form>
		</>
	);
}

function CodeStep({ busy, email, error, resendIn = 0 }: { busy: boolean; email: string; error?: string; resendIn?: number }) {
	const [code, setCode] = useState("");
	const [hydrated, setHydrated] = useState(false);
	const [wait, setWait] = useState(resendIn);
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => setHydrated(true), []);
	useEffect(() => {
		if (wait <= 0) return;
		const t = setTimeout(() => setWait((w) => w - 1), 1000);
		return () => clearTimeout(t);
	}, [wait]);
	useEffect(() => {
		if (error) setCode("");
		input.current?.focus();
	}, [error]);

	return (
		<>
			<Heading title="Enter the code" body={`Sent to ${email}. It expires in 10 minutes.`} />
			<Form method="post" className="flex flex-col gap-4" noValidate>
				<input type="hidden" name="intent" value="check" />
				<input type="hidden" name="email" value={email} />
				<label className="relative block">
					<span className="sr-only">Six-digit code</span>
					{/* One real input carries the value and one-time-code autofill; the boxes are drawn behind it once hydrated. */}
					<input
						ref={input}
						name="otp"
						value={code}
						onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
						inputMode="numeric"
						autoComplete="one-time-code"
						pattern="\d{6}"
						maxLength={6}
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? "otp-error" : "otp-hint"}
						className={
							hydrated
								? "absolute inset-0 h-full w-full opacity-0"
								: "min-h-14 w-full rounded-input border border-input-border bg-card px-3.5 text-center text-2xl font-bold tracking-[0.5em]"
						}
					/>
					{hydrated ? (
						<div aria-hidden="true" className="grid grid-cols-6 gap-2">
							{Array.from({ length: 6 }, (_, i) => (
								<div
									key={i}
									className={`flex h-14 items-center justify-center rounded-input bg-card text-2xl font-bold ${
										error ? "border border-danger" : i === Math.min(code.length, 5) ? "border-2 border-cta" : "border border-input-border"
									}`}
								>
									{code[i] ?? ""}
								</div>
							))}
						</div>
					) : null}
				</label>
				{error ? (
					<p id="otp-error" role="alert" className="text-sm text-danger">{error}</p>
				) : (
					<p id="otp-hint" className="text-sm text-ink-soft">Your keyboard offers the code from Mail when it arrives.</p>
				)}
				<Button type="submit" size="lg" disabled={busy || code.length < 6} className="mt-1 w-full">{busy ? "Checking" : error ? "Try again" : "Continue"}</Button>
			</Form>
			<Form method="post" className="mt-2 flex justify-center">
				<input type="hidden" name="intent" value="send" />
				<input type="hidden" name="email" value={email} />
				<Button type="submit" variant="quiet" disabled={busy || wait > 0} className={wait > 0 ? "" : "text-cta"}>
					{wait > 0 ? `Send a new code in 0:${String(wait).padStart(2, "0")}` : "Send a new code"}
				</Button>
			</Form>
		</>
	);
}

function PasswordStep({ busy, email, otp, error }: { busy: boolean; email: string; otp: string; error?: string }) {
	const [pw, setPw] = useState("");
	const [show, setShow] = useState(false);
	const long = pw.length >= 12;
	return (
		<>
			<div className="mb-2"><Badge variant="green">Code accepted</Badge></div>
			<Heading title="Choose a new password" body={`for ${email}`} />
			<Form method="post" className="flex flex-col gap-4" noValidate>
				<input type="hidden" name="intent" value="reset" />
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="otp" value={otp} />
				<Field
					label="New password"
					name="password"
					type={show ? "text" : "password"}
					autoComplete="new-password"
					required
					value={pw}
					onChange={(e) => setPw(e.target.value)}
					error={error}
					hint={long ? `${pw.length} characters · long enough` : `${pw.length} of 12 characters`}
				/>
				<button type="button" onClick={() => setShow((s) => !s)} className="-mt-2 flex min-h-11 items-center self-end text-sm font-semibold text-cta">
					{show ? "Hide password" : "Show password"}
				</button>
				<p className="text-sm text-ink-soft">You'll be signed out on every other device.</p>
				<Button type="submit" size="lg" disabled={busy || !long} className="w-full">{busy ? "Saving" : "Save and sign in"}</Button>
			</Form>
		</>
	);
}
