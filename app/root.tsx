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

import { ColorSchemeScript, MantineProvider, mantineHtmlProps, createTheme, virtualColor } from '@mantine/core';

const theme = createTheme({
  colors: {
    'teal-900': [
      "#134e4a",
      "#134e4a",
      "#134e4a",
      "#134e4a",
      "#134e4a",
      "#134e4a",
      "#134e4a",
      "#134e4a",
      "#134e4a",
      "#134e4a"
    ],
    'teal-200': [
      "#99f6e4",
      "#99f6e4",
      "#99f6e4",
      "#99f6e4",
      "#99f6e4",
      "#99f6e4",
      "#99f6e4",
      "#99f6e4",
      "#99f6e4",
      "#99f6e4"
    ],
    'slate-950': [
      "#020617",
      "#020617",
      "#020617",
      "#020617",
      "#020617",
      "#020617",
      "#020617",
      "#020617",
      "#020617",
      "#020617"
    ],
    'slate-100': [
      "#f1f5f9",
      "#f1f5f9",
      "#f1f5f9",
      "#f1f5f9",
      "#f1f5f9",
      "#f1f5f9",
      "#f1f5f9",
      "#f1f5f9",
      "#f1f5f9",
      "#f1f5f9"
    ],
    menu: virtualColor({
      name: 'menu',
      dark: 'teal-900',
      light: 'teal-200',
    }),
    text: virtualColor({
      name: 'text',
      dark: 'slate-100',
      light: 'slate-950',
    }),
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
        <MantineProvider defaultColorScheme="auto" theme={theme}>{children}</MantineProvider>
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
