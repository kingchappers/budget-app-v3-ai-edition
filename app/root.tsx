import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import '@fontsource-variable/lora/wght.css';

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
import { APP_NAME, APP_DESCRIPTION, SITE_URL, pageTitle } from "./lib/pageTitle";
import { BRAND, dark, ember, gold, hoard } from "./lib/brand";
import { ReduceMotion } from "./components/layout/ReduceMotion";
import { TextSize } from "./components/layout/TextSize";
import { TEXT_SIZE_SCRIPT } from "./lib/textSize";
import { isDemo } from "./demo/flag";

import { Button, ColorSchemeScript, Progress, Tabs, Group, MantineProvider, Stack, Text, Title, mantineHtmlProps, createTheme, useMantineTheme, type CSSVariablesResolver } from '@mantine/core';
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
  primaryColor: 'hoard',
  respectReducedMotion: true,
  // Mantine's autoContrast text-color decision for a color used without an explicit shade (e.g.
  // color="hoard") reads primaryShade.light's luminance even when the button renders in dark mode.
  // Using shade 6 in both modes keeps that scheme-blind check right: white on hoard.6 is 7.4:1.
  // Dark-mode text and links do not use shade 6; see the -text overrides in cssVariablesResolver.
  primaryShade: { light: 6, dark: 6 },
  autoContrast: true,
  black: BRAND.pine,
  fontFamily: '"Lora Variable", Georgia, "Times New Roman", serif',
  headings: { fontFamily: '"Lora Variable", Georgia, serif', fontWeight: '600' },
  defaultRadius: 'md',
  // Bars and the active-tab line are non-text parts that need 3:1; the -text shade is the one that is
  // lighter in dark mode, where the button fill (shade 6) would be 2.3:1 on the page.
  components: {
    Progress: Progress.extend({ defaultProps: { color: 'var(--mantine-color-hoard-text)' } }),
    Tabs: Tabs.extend({ defaultProps: { color: 'var(--mantine-color-hoard-text)' } }),
  },
  colors: {
    hoard,
    gold,
    // Something worth a look (a category over its target, a pot below zero, a pending save).
    // Deliberately not red: red is for real errors and destructive actions.
    ember,
    dark,
    danger: [
      '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171',
      '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
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

// Page and text colours come from the brand: Mist behind cards in light mode, and the Pine-tinted `dark`
// palette in dark mode. Mantine's default error red is 3.3:1 on white at 12px, under the 4.5:1 that small
// text needs, so the error text is darker in light mode, lighter in dark mode, and 14px.
// Dark mode points the -text variables at the brand's lighter shades: the default shade 4 of hoard is only
// 4.1:1 on a card, and Mantine reads shade 6 (the button fill) for nothing else in that mode.
export const cssVariablesResolver: CSSVariablesResolver = (theme) => ({
  variables: {},
  light: {
    '--mantine-color-body': BRAND.mist,
    '--mantine-color-dimmed': BRAND.muted,
    '--mantine-color-error': theme.colors.danger[7],
  },
  dark: {
    '--mantine-color-dimmed': theme.colors.dark[2],
    '--mantine-color-error': theme.colors.danger[3],
    '--mantine-color-hoard-text': BRAND.darkHoardText,
    '--mantine-color-anchor': BRAND.darkHoardText,
    '--mantine-color-ember-text': BRAND.darkEmberText,
    '--mantine-color-ember-filled': BRAND.darkEmberText,
    '--mantine-color-gold-text': BRAND.darkGoldText,
  },
});

function ResponsiveNotifications() {
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);
  return <Notifications position={isDesktop ? 'bottom-left' : 'bottom-center'} />;
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle() }];

// Portrait iOS launch images: the file's pixel size, then the device's CSS size and pixel ratio.
const APPLE_SPLASH_SCREENS = [
  { file: '1290x2796', width: 430, height: 932, ratio: 3 },
  { file: '1179x2556', width: 393, height: 852, ratio: 3 },
  { file: '1170x2532', width: 390, height: 844, ratio: 3 },
  { file: '750x1334', width: 375, height: 667, ratio: 2 },
  { file: '2048x2732', width: 1024, height: 1366, ratio: 2 },
];

export const links: Route.LinksFunction = () => [
  ...(isDemo ? [] : [{ rel: "manifest", href: "/manifest.webmanifest" }]),
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  ...APPLE_SPLASH_SCREENS.map(({ file, width, height, ratio }) => ({
    rel: "apple-touch-startup-image",
    href: `/splash/apple-splash-${file}.png`,
    media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio})`,
  })),
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={BRAND.pine} />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={BRAND.surface} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="application-name" content={APP_NAME} />
        <meta name="description" content={APP_DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={APP_NAME} />
        <meta property="og:description" content={APP_DESCRIPTION} />
        <meta property="og:url" content={`${SITE_URL}/`} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="The Hoardwise logo: a gold dragon curled around a coin" />
        <meta name="twitter:card" content="summary_large_image" />
        {isDemo && <meta name="robots" content="noindex" />}
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
