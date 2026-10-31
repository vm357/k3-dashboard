import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { nonceContext } from "../server/context";
import "./app.css";

export function loader({ context }: Route.LoaderArgs) {
  return { nonce: context.get(nonceContext) };
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // Undefined while rendering a root-level error, in which case no nonce is attached
  // and the (rare) error page's inline scripts are blocked; the page still reads.
  const nonce = useRouteLoaderData<typeof loader>("root")?.nonce;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#1e3932" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // Stack traces are shown in development only; production shows nothing that
  // could expose internals (plan, security section).
  let title = "Something went wrong";
  let details = "Try again in a moment. If it keeps happening, contact Kermit Webcraft.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page not found";
      details = "That page does not exist, or you do not have access to it.";
    } else if (error.status === 403) {
      title = "Not allowed";
      details = "Your role does not include this action. Ask the business owner.";
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-bold text-heading">{title}</h1>
      <p className="max-w-sm text-ink-soft">{details}</p>
      <a href="/" className="press mt-2 rounded-pill bg-cta px-5 py-3 font-semibold text-on-dark">
        Back to start
      </a>
      {stack && (
        <pre className="mt-6 w-full max-w-2xl overflow-x-auto rounded-card bg-card p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
