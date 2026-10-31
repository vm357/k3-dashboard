import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { IconCalendar, IconClients, IconReports, IconSettings, IconToday } from "./icons";

/**
 * The business shell: bottom bar on phones, left sidebar from 1024px up (ADR 004).
 * Four destinations on the phone bar; the sidebar adds Reports (phones reach it from Settings).
 */
const items = [
  { to: "", label: "Today", Icon: IconToday, end: true, phone: true },
  { to: "/calendar", label: "Calendar", Icon: IconCalendar, end: false, phone: true },
  { to: "/clients", label: "Clients", Icon: IconClients, end: false, phone: true },
  { to: "/reports", label: "Reports", Icon: IconReports, end: false, phone: false },
  { to: "/settings", label: "Settings", Icon: IconSettings, end: false, phone: true },
];

export function AppShell({
  base,
  businessName,
  userName,
  children,
  action,
}: {
  base: string;
  businessName: string;
  userName: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:gap-1 lg:bg-card lg:px-4 lg:py-7 lg:shadow-nav">
        <div className="mb-6 flex items-center gap-2.5 px-2.5">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-heading text-xs font-extrabold text-on-dark">
            K3
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-bold">{businessName}</span>
            <span className="truncate text-xs text-ink-soft">{userName}</span>
          </div>
        </div>
        {items.map(({ to, label, Icon, end }) => (
          <NavLink
            key={label}
            to={`${base}${to}`}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-pill px-3 py-2.5 text-sm font-semibold ${
                isActive ? "bg-mint text-heading" : "text-ink hover:bg-quiet"
              }`
            }
          >
            <Icon width={20} height={20} />
            {label}
          </NavLink>
        ))}
        <div className="flex-1" />
        {action}
        <form method="post" action="/sign-out" className="mt-2">
          <button type="submit" className="press w-full rounded-pill px-3 py-2 text-left text-sm text-ink-soft hover:bg-quiet">
            Sign out
          </button>
        </form>
      </aside>

      <main className="min-w-0 flex-1 pb-24 lg:pb-10">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid h-20 grid-cols-4 bg-card px-3 pt-2 pb-5 shadow-nav lg:hidden"
      >
        {items.filter((i) => i.phone).map(({ to, label, Icon, end }) => (
          <NavLink
            key={label}
            to={`${base}${to}`}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 text-[11px] ${isActive ? "font-bold text-heading" : "font-semibold text-ink-soft"}`
            }
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Page padding that matches the canvas: 20px on phones, 40px on desktop. */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto flex max-w-5xl flex-col gap-4 px-5 pt-12 lg:px-10 lg:pt-9 ${className}`}>{children}</div>;
}
