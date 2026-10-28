import type { ComponentProps, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

/**
 * K3 primitives, Direction A (ADR 004). Small on purpose: the dashboard should feel like
 * one product, so every screen composes these rather than inventing its own.
 */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "filled" | "outlined" | "inverted" | "outlinedOnDark" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const variantClass: Record<Variant, string> = {
  filled: "bg-cta text-on-dark border border-cta",
  outlined: "bg-card text-heading border border-heading",
  inverted: "bg-card text-heading border border-card",
  outlinedOnDark: "bg-transparent text-on-dark border border-on-dark",
  quiet: "bg-transparent text-ink-soft border border-transparent",
  danger: "bg-card text-danger border border-danger",
};

const sizeClass: Record<Size, string> = {
  sm: "px-4 py-2 text-sm min-h-10",
  md: "px-5 py-3 text-base min-h-12",
  lg: "px-8 py-3.5 text-base min-h-13",
};

const buttonBase =
  "press inline-flex items-center justify-center gap-2 rounded-pill font-semibold leading-tight whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none";

export function Button({
  variant = "filled",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={cx(buttonBase, variantClass[variant], sizeClass[size], className)} {...props} />;
}

export function ButtonLink({
  variant = "filled",
  size = "md",
  className,
  ...props
}: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={cx(buttonBase, variantClass[variant], sizeClass[size], className)} {...props} />;
}

export function Card({
  tone = "default",
  className,
  ...props
}: ComponentProps<"section"> & { tone?: "default" | "feature" | "quiet" }) {
  const tones = {
    default: "bg-card text-ink shadow-card",
    feature: "bg-feature text-on-dark",
    quiet: "bg-quiet text-ink",
  };
  return <section className={cx("rounded-card p-4", tones[tone], className)} {...props} />;
}

export function Badge({
  variant = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { variant?: "neutral" | "green" | "onDark" | "danger" }) {
  const variants = {
    neutral: "border border-input-border text-ink-soft bg-card",
    green: "bg-mint text-heading",
    onDark: "border border-on-dark-soft text-on-dark",
    danger: "bg-card text-danger border border-danger",
  };
  return (
    <span
      className={cx("inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-semibold", variants[variant], className)}
      {...props}
    />
  );
}

/** Labelled input in the system's floating-label spirit, simplified to a stacked label for reliability on phones. */
export function Field({
  label,
  name,
  error,
  hint,
  className,
  ...input
}: ComponentProps<"input"> & { label: string; name: string; error?: string; hint?: string }) {
  const id = input.id ?? name;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          "min-h-12 rounded-input border bg-card px-3.5 text-base text-ink placeholder:text-ink-soft/70",
          error ? "border-danger" : "border-input-border focus:border-cta",
        )}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PageTitle({ eyebrow, title, aside }: { eyebrow?: ReactNode; title: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-col gap-0.5">
      {eyebrow ? <span className="text-sm text-ink-soft">{eyebrow}</span> : null}
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[28px] font-bold leading-tight text-heading">{title}</h1>
        {aside ? <span className="text-sm text-ink-soft">{aside}</span> : null}
      </div>
    </header>
  );
}

export function Avatar({ name, size = 40, onDark = false }: { name: string; size?: number; onDark?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        onDark ? "bg-card text-heading" : "bg-mint text-heading",
      )}
    >
      {initials}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-input-border px-6 py-10 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-xs text-sm text-ink-soft">{body}</p>
      {action}
    </div>
  );
}
