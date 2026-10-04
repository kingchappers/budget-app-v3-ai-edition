import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';

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
import { pageTitle } from "./lib/pageTitle";
import { ReduceMotion } from "./components/layout/ReduceMotion";
import { TextSize } from "./components/layout/TextSize";
import { TEXT_SIZE_SCRIPT } from "./lib/textSize";

import { Button, ColorSchemeScript, Group, MantineProvider, Stack, Text, Title, mantineHtmlProps, createTheme, useMantineTheme, type CSSVariablesResolver } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export const theme = createTheme({
  primaryColor: 'primary',
  respectReducedMotion: true,
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
    // Something worth a look (a category over its target, a pot below zero).
    // Deliberately not red: red is for real errors and destructive actions.
    attention: [
      '#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8',
      '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81',
    ],
    gray: [
      '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8',
      '#64748b', '#475569', '#334155', '#1e293b', '#0f172a',
    ],
  },
});

// This theme customizes gray/primary/danger/warning/success but leaves `dark`
// as Mantine's own default palette, whose dark.2 backs --mantine-color-dimmed
// in dark mode. That default (#828282) only reaches ~4.0:1 against this app's
// dark body background (dark.7, #242424) — under WCAG AA's 4.5:1 for normal
// text. Override just the CSS variable rather than redefining the whole dark
// palette, so borders/backgrounds/disabled colors keep Mantine's defaults.
// #9a9a9a also clears 4.5:1 on a card (#2e2e2e), where #909090 only reached 4.25:1.
// Mantine's default error red is 3.3:1 on white at 12px, under the 4.5:1 that small text needs,
// and the one message a stressed person must read is the one that is smallest. The error text is
// darker in light mode, lighter in dark mode, and 14px.
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-error': '#b91c1c',
  },
  dark: {
    '--mantine-color-dimmed': '#9a9a9a',
    '--mantine-color-error': '#fca5a5',
  },
});

function ResponsiveNotifications() {
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);
  return <Notifications position={isDesktop ? 'bottom-left' : 'bottom-center'} />;
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle() }];

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#0f766e" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#134e4a" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Budget" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <ColorSchemeScript defaultColorScheme="auto" />
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <MantineProvider defaultColorScheme="auto" theme={theme} cssVariablesResolver={cssVariablesResolver}>
            <ReduceMotion />
            <TextSize />
            <ResponsiveNotifications />
            <DatesProvider settings={{ locale: 'en-gb' }}>{children}</DatesProvider>
          </MantineProvider>
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
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined;

  return (
    <main className="pt-16 p-4 container mx-auto">
      <Stack maw={560}>
        <Title order={1} size="h2">
          {notFound ? "We couldn't find that page" : "Something didn't load. Your data is safe."}
        </Title>
        <Text>
          {notFound
            ? 'The link may be out of date. You can go back to Home.'
            : 'Reload the page to try again. If it keeps happening, go back to Home.'}
        </Text>
        <Group>
          {!notFound && <Button onClick={() => window.location.reload()}>Reload</Button>}
          <Button component="a" href="/" variant={notFound ? 'filled' : 'default'}>Go to Home</Button>
        </Group>
        {stack && (
          <pre className="w-full p-4 overflow-x-auto">
            <code>{stack}</code>
          </pre>
        )}
      </Stack>
    </main>
  );
}
