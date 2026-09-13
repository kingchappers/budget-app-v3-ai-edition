import '@mantine/core/styles.css';

import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

import { ColorSchemeScript, MantineProvider, mantineHtmlProps, createTheme } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

const theme = createTheme({
  primaryColor: 'primary',
  // Mantine's autoContrast text-color decision for a color used without an
  // explicit shade (e.g. color="primary") always reads primaryShade.light's
  // luminance, even when the button is actually rendering in dark mode —
  // it does not re-check colorScheme. Shade 6 (luminance ~0.23-0.28 across
  // primary/danger/warning/success) sits under the default 0.3 threshold,
  // so autoContrast picks white text — but white-on-shade-6 only reaches
  // ~3.2-3.8:1 contrast, below WCAG AA's 4.5:1 for normal text. Shade 7
  // (luminance ~0.11-0.16) keeps white text correctly chosen by the same
  // scheme-blind check while actually passing contrast at ~5.0-6.5:1, and
  // leaves dark mode (which uses primaryShade.dark's own shade 8) untouched.
  primaryShade: { light: 7, dark: 8 },
  autoContrast: true,
  colors: {
    // Deepened/completed version of the app's existing teal — same hue,
    // now a real 10-shade ramp so hover/active/dark-mode states resolve
    // to different shades instead of one flat repeated hex.
    primary: [
      '#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf',
      '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a',
    ],
    danger: [
      '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171',
      '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
    ],
    warning: [
      '#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24',
      '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f',
    ],
    success: [
      '#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80',
      '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d',
    ],
    gray: [
      '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8',
      '#64748b', '#475569', '#334155', '#1e293b', '#0f172a',
    ],
  },
});

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ColorSchemeScript defaultColorScheme="auto" />
        <Meta />
        <Links />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <MantineProvider defaultColorScheme="auto" theme={theme}>{children}</MantineProvider>
        </QueryClientProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
