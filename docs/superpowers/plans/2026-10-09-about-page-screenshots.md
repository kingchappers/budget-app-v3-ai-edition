# About Page and Screenshot Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `/about` page that shows the product with screenshots to people who are not signed in, backed by a repeatable `yarn screenshots` script that produces those screenshots from invented data.

**Architecture:** `DefaultLayout` keeps its sign-in gate but lets an allowlist of paths (`PUBLIC_PATHS`) render without a session. The About page is static content that reads its image list from one dependency-free module (`app/lib/aboutShots.ts`), which the capture script also imports (Node 24 strips the TypeScript types). The capture script starts the dev server with dummy Auth0 values, seeds the Auth0 SDK's localStorage cache, answers `/api/**` from in-memory fixtures through Playwright route interception, and writes WebP files to `public/about/`.

**Tech Stack:** React 19, React Router v7 (file routes), Mantine 8, Vitest + Testing Library, Playwright (new devDependency), sharp (new devDependency, PNG to WebP), Node 24.

**Spec:** `docs/superpowers/specs/2026-10-08-about-page-screenshots-design.md`

## Global Constraints

- Static screenshots only; no live or interactive demo (spec: Decisions, Out of scope).
- All demo data is invented. No real names, transactions or amounts.
- Public allowlist is exactly `PUBLIC_PATHS = ['/about']`, exported from `app/components/layout/DefaultLayout.tsx`. `NAV_ITEMS` gains no About entry.
- Images are WebP at 390px (phone) and 1280px (desktop) wide, in light and dark. 7 shots x 4 variants = 28 files in `public/about/`.
- Page title is `About – Budget`, built with `pageTitle('About')`.
- Every image has alt text that says what it shows (not "screenshot"), explicit `width` and `height`, and `loading="lazy"` except the first.
- Entry points: `SignedOutPanel` link text "See what it looks like"; Settings link text "Help and about". No change to the avatar menu or navigation bar.
- The harness refuses to run against a real Auth0 tenant, fails on any page console error or unhandled `/api/` route, and is not part of `yarn build` or CI.
- Conventional commits, subject under 72 characters, each commit ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Working branch: `feat/about-page-screenshots` (already created from `main`).

## Review Focus

1. A signed-in or signed-out visitor loads `/about#some-section` or `/about/` (trailing slash): the route still matches the allowlist. Task 2 pins the trailing-slash case.
2. A path that merely starts with `/about` (for example `/about-me` or `/aboutx`) must stay gated. Task 2 pins it.
3. While Auth0 is still loading, `/about` renders its content immediately, with no spinner. Task 2 pins it.
4. A session that has ended on `/about` shows the page, not "Your session has ended". Task 2 pins it.
5. A renamed or missing shot: the list in `aboutShots.ts` and the files in `public/about/` must agree. Task 1 pins file naming; Task 7 pins that all 28 files exist.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/lib/aboutShots.ts` (create) | The shot list: ids, captions, alt text, variants, file names. No imports, so Node can load it directly. |
| `app/lib/__tests__/aboutShots.test.ts` (create) | File naming and list integrity. |
| `app/components/layout/DefaultLayout.tsx` (modify) | `PUBLIC_PATHS`, `isPublicPath`, and `MainContent` letting public paths through. |
| `app/components/layout/__tests__/DefaultLayout.test.tsx` (modify) | Public path behaviour. |
| `app/routes/about.tsx` (create) | The About page. |
| `app/routes/__tests__/about.test.tsx` (create) | Page content, headings, accessibility, image attributes. |
| `app/routes/__tests__/meta.test.ts` (modify) | About title. |
| `app/components/layout/SignedOutPanel.tsx` (modify) | "See what it looks like" link. |
| `app/routes/settings.tsx` (modify) | "Help and about" link. |
| `scripts/screenshots/fixtures.mjs` (create) | Invented household and the in-memory `/api` store. |
| `scripts/screenshots/auth.mjs` (create) | Auth0 localStorage seed and the dummy env values. |
| `scripts/screenshots/capture.mjs` (create) | Dev server lifecycle, Playwright run, WebP output. |
| `package.json` (modify) | `screenshots` script; `playwright` and `sharp` devDependencies. |
| `public/about/*.webp` (create, generated) | The 28 images. |

Spec note: the spec names the harness files `.ts`. This plan uses `.mjs` so Node runs them with no build step and `tsc` (which includes `**/*`) does not need Playwright types. This matches the existing `scripts/*.cjs` files. `aboutShots.ts` stays TypeScript because the page imports it.

---

### Task 1: Shot list module

**Files:**
- Create: `app/lib/aboutShots.ts`
- Test: `app/lib/__tests__/aboutShots.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - `type ShotId = 'home' | 'add' | 'transactions' | 'plan' | 'insights' | 'recurring' | 'settings'`
  - `type ShotSize = 'phone' | 'desktop'`
  - `type ShotScheme = 'light' | 'dark'`
  - `interface Shot { id: ShotId; route: string; heading: string; caption: string; howTo: string; alt: string }`
  - `const SHOTS: readonly Shot[]` (7 entries, this order)
  - `const SIZES: Record<ShotSize, { width: number; height: number }>` (phone 390x844, desktop 1280x800)
  - `const SCHEMES: readonly ShotScheme[]` (`['light', 'dark']`)
  - `function shotFileName(id: ShotId, size: ShotSize, scheme: ShotScheme): string` returns `${id}-${size}-${scheme}.webp`
  - `function shotUrl(id: ShotId, size: ShotSize, scheme: ShotScheme): string` returns `/about/${shotFileName(...)}`
  - `function allShotFileNames(): string[]` (28 names)

- [ ] **Step 1: Write the failing test**

Create `app/lib/__tests__/aboutShots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SHOTS, SIZES, SCHEMES, allShotFileNames, shotFileName, shotUrl } from '../aboutShots';

describe('aboutShots', () => {
  it('names a file from the id, size and scheme', () => {
    expect(shotFileName('home', 'phone', 'dark')).toBe('home-phone-dark.webp');
  });

  it('serves files from /about/', () => {
    expect(shotUrl('plan', 'desktop', 'light')).toBe('/about/plan-desktop-light.webp');
  });

  it('lists the 7 shots in page order, each with a unique id', () => {
    const ids = SHOTS.map(shot => shot.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['home', 'add', 'transactions', 'plan', 'insights', 'recurring', 'settings']);
  });

  it('has a 28 unique file names: every shot at both sizes and both schemes', () => {
    const names = allShotFileNames();
    expect(names).toHaveLength(SHOTS.length * Object.keys(SIZES).length * SCHEMES.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every shot words for the page, and alt text that is not just "screenshot"', () => {
    for (const shot of SHOTS) {
      expect(shot.heading, shot.id).not.toBe('');
      expect(shot.caption, shot.id).not.toBe('');
      expect(shot.howTo, shot.id).not.toBe('');
      expect(shot.alt.toLowerCase(), shot.id).not.toBe('screenshot');
      expect(shot.alt.length, shot.id).toBeGreaterThan(20);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run app/lib/__tests__/aboutShots.test.ts`
Expected: FAIL, cannot resolve `../aboutShots`.

- [ ] **Step 3: Write minimal implementation**

Create `app/lib/aboutShots.ts`. It must not import anything and must use only erasable TypeScript (no `enum`, no parameter properties), because `scripts/screenshots/capture.mjs` loads it with Node's type stripping.

```ts
// The screenshots on the About page. The page and scripts/screenshots/capture.mjs both read this list,
// so a renamed shot fails a test instead of leaving a broken image on a public page. Keep this file free
// of imports: Node loads it directly.

export type ShotId = 'home' | 'add' | 'transactions' | 'plan' | 'insights' | 'recurring' | 'settings';
export type ShotSize = 'phone' | 'desktop';
export type ShotScheme = 'light' | 'dark';

export interface Shot {
  id: ShotId;
  route: string;
  heading: string;
  caption: string;
  howTo: string;
  alt: string;
}

export const SHOTS: readonly Shot[] = [
  {
    id: 'home',
    route: '/',
    heading: 'Home',
    caption: 'How much you have left to spend this month, and what is coming up.',
    howTo: 'Open the app and the answer is the first thing you see.',
    alt: 'The Home page showing money left to spend this month and an upcoming bill',
  },
  {
    id: 'add',
    route: '/',
    heading: 'Add something you bought',
    caption: 'Type an amount, choose a category and save. Most days that is all you need.',
    howTo: 'Tap Add, or press N on a keyboard. You can undo straight away.',
    alt: 'The Add transaction sheet with an amount typed and a category chosen',
  },
  {
    id: 'transactions',
    route: '/transactions',
    heading: 'Transactions',
    caption: 'Everything you have added, newest first, with filters when you need to find something.',
    howTo: 'Tap any row to change it or delete it. Deleted items can be brought back.',
    alt: 'The Transactions page listing a month of purchases grouped by day',
  },
  {
    id: 'plan',
    route: '/plan',
    heading: 'Plan: budgets and pots',
    caption: 'A budget is the most you plan to spend on a category. A pot is money kept apart for something.',
    howTo: 'Both are optional. Find them under Plan.',
    alt: 'The Plan page showing category budgets with progress bars and two savings pots',
  },
  {
    id: 'insights',
    route: '/insights',
    heading: 'Insights',
    caption: 'Where your money went, how this month compares, and how your savings are growing.',
    howTo: 'Use the month arrows to look back, and open a section for the detail.',
    alt: 'The Insights page with a spending breakdown chart and a monthly trend',
  },
  {
    id: 'recurring',
    route: '/recurring',
    heading: 'Recurring bills',
    caption: 'Add a bill once and the app shows it on Home when it is due.',
    howTo: 'Nothing is added until you confirm it with one tap.',
    alt: 'The Recurring page listing rent and a subscription with their due days',
  },
  {
    id: 'settings',
    route: '/settings',
    heading: 'Settings',
    caption: 'Text size, appearance, reminders and the shortcut keys, kept on your own device.',
    howTo: 'Open the cog in the top bar.',
    alt: 'The Settings page with display options and links to categories and accounts',
  },
];

export const SIZES: Record<ShotSize, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

export const SCHEMES: readonly ShotScheme[] = ['light', 'dark'];

export function shotFileName(id: ShotId, size: ShotSize, scheme: ShotScheme): string {
  return `${id}-${size}-${scheme}.webp`;
}

export function shotUrl(id: ShotId, size: ShotSize, scheme: ShotScheme): string {
  return `/about/${shotFileName(id, size, scheme)}`;
}

export function allShotFileNames(): string[] {
  const sizes = Object.keys(SIZES) as ShotSize[];
  return SHOTS.flatMap(shot => sizes.flatMap(size => SCHEMES.map(scheme => shotFileName(shot.id, size, scheme))));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run app/lib/__tests__/aboutShots.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/aboutShots.ts app/lib/__tests__/aboutShots.test.ts
git commit -m "feat: add the About page screenshot list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Public path allowlist in the layout

**Files:**
- Modify: `app/components/layout/DefaultLayout.tsx` (`MainContent`, lines 133-143; add constants near line 32)
- Test: `app/components/layout/__tests__/DefaultLayout.test.tsx` (append a new `describe`; it already defines `auth`, `renderLayout(children, url)`, and `authError`)

**Interfaces:**
- Consumes: `useLocation` (already imported in `DefaultLayout.tsx`), `SessionState`.
- Produces: `export const PUBLIC_PATHS: readonly string[]` (`['/about']`) and `export function isPublicPath(pathname: string): boolean`. Match is exact after removing one trailing slash; `/about/` matches, `/aboutx` and `/about-me` do not.

- [ ] **Step 1: Write the failing tests**

Append to `app/components/layout/__tests__/DefaultLayout.test.tsx`:

```tsx
describe('DefaultLayout public pages', () => {
  it('shows /about to someone who is signed out, not the sign-in panel', () => {
    auth.isAuthenticated = false;
    renderLayout(<p>about content</p>, '/about');
    expect(screen.getByText('about content')).toBeInTheDocument();
    expect(screen.queryByText("You're signed out")).not.toBeInTheDocument();
  });

  it('still gates other pages when signed out', () => {
    auth.isAuthenticated = false;
    renderLayout(<p>private content</p>, '/transactions');
    expect(screen.queryByText('private content')).not.toBeInTheDocument();
    expect(screen.getByText("You're signed out")).toBeInTheDocument();
  });

  it('matches /about with a trailing slash', () => {
    auth.isAuthenticated = false;
    renderLayout(<p>about content</p>, '/about/');
    expect(screen.getByText('about content')).toBeInTheDocument();
  });

  it('does not treat a path that only starts with /about as public', () => {
    auth.isAuthenticated = false;
    renderLayout(<p>private content</p>, '/about-me');
    expect(screen.queryByText('private content')).not.toBeInTheDocument();
  });

  it('shows /about straight away while Auth0 is still loading, with no spinner', () => {
    auth.isAuthenticated = false;
    auth.isLoading = true;
    renderLayout(<p>about content</p>, '/about');
    expect(screen.getByText('about content')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Checking your session' })).not.toBeInTheDocument();
  });

  it('shows /about, not "Your session has ended", after a session has ended', () => {
    auth.isAuthenticated = false;
    auth.error = authError('login_required');
    renderLayout(<p>about content</p>, '/about');
    expect(screen.getByText('about content')).toBeInTheDocument();
    expect(screen.queryByText('Your session has ended')).not.toBeInTheDocument();
  });

  it('shows /about to a signed-in person too, and keeps the Add button for them', () => {
    renderLayout(<p>about content</p>, '/about');
    expect(screen.getByText('about content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument();
  });
});
```

Note: with `isAuthenticated = true` the existing tests find two "Add transaction" matches only if both the header button and tab bar button render; if `getByRole` reports multiple matches, change that last assertion to `getAllByRole(...).length` `toBeGreaterThan(0)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/layout/__tests__/DefaultLayout.test.tsx`
Expected: the signed-out `/about`, trailing-slash, loading and session-ended tests FAIL; the others pass.

- [ ] **Step 3: Write minimal implementation**

In `app/components/layout/DefaultLayout.tsx`, add below `isSettingsActive`:

```tsx
// Pages anyone can read without signing in. Keep this short: everything else waits for a session.
export const PUBLIC_PATHS: readonly string[] = ['/about'];

export function isPublicPath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return PUBLIC_PATHS.includes(path);
}
```

Replace `MainContent` with:

```tsx
function MainContent({ session, children }: { session: SessionState; children: React.ReactNode }) {
  const { pathname } = useLocation();
  if (isPublicPath(pathname)) return <>{children}</>;
  if (session === 'loading') {
    return (
      <Group justify="center" py="xl" role="status" aria-label="Checking your session">
        <Loader />
      </Group>
    );
  }
  if (session === 'signedIn') return <>{children}</>;
  return <SignedOutPanel sessionEnded={session === 'sessionEnded'} />;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run app/components/layout/__tests__/DefaultLayout.test.tsx`
Expected: PASS (all, including the existing tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/DefaultLayout.tsx app/components/layout/__tests__/DefaultLayout.test.tsx
git commit -m "feat: let /about render without a session

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The About page

**Files:**
- Create: `app/routes/about.tsx`
- Create: `app/routes/__tests__/about.test.tsx`
- Modify: `app/routes/__tests__/meta.test.ts`

**Interfaces:**
- Consumes: `SHOTS`, `shotUrl`, `SIZES`, `Shot` from `~/lib/aboutShots` (Task 1); `DefaultLayout` from `~/components/layout/DefaultLayout`; `pageTitle` from `~/lib/pageTitle`; `GLOSSARY` from `~/lib/glossary` (`GLOSSARY.pot.definition`, `GLOSSARY.target.definition`).
- Produces: default export `About` route component and `export const meta`. Sections carry ids `sec-<shot id>` so links like `/about#sec-plan` work. The sign-in buttons have the accessible name "Sign in".

Design notes for the implementer: the page is wrapped by `DefaultLayout` exactly as `app/routes/settings.tsx` does (see its `export default function Settings()` at the bottom). Use `useAuth0().loginWithRedirect` for the buttons, with the same try/catch logging as `SignedOutPanel`. Exactly one `h1`; each shot is an `h2`; the FAQ questions are `h3` under an `h2`. Each screenshot is a `<picture>` with a dark `<source media="(prefers-color-scheme: dark)">` for the matching size: the phone image under `(max-width: 767px)` and the desktop image above it, each in light and dark.

- [ ] **Step 1: Write the failing tests**

Create `app/routes/__tests__/about.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { SHOTS } from '~/lib/aboutShots';
import { expectNoViolations, expectSoundHeadings } from '~/test-utils/accessibility';

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false, error: undefined, loginWithRedirect: vi.fn() }));
vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => auth,
}));
vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import About from '../about';

function renderAbout() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/about']}>
        <About />
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  auth.loginWithRedirect.mockReset();
});

describe('About page', () => {
  it('has one h1 and no skipped heading levels', () => {
    const { container } = renderAbout();
    expectSoundHeadings(container);
  });

  it('has no labelling or heading violations', async () => {
    const { container } = renderAbout();
    await expectNoViolations(container);
  });

  it('has a section for every shot, headed by its heading', () => {
    renderAbout();
    for (const shot of SHOTS) {
      expect(screen.getByRole('heading', { level: 2, name: shot.heading })).toBeInTheDocument();
    }
  });

  it('shows each shot once, with its alt text, size, and lazy loading after the first', () => {
    const { container } = renderAbout();
    const images = [...container.querySelectorAll('picture img')] as HTMLImageElement[];
    expect(images).toHaveLength(SHOTS.length);
    images.forEach((img, index) => {
      expect(img.alt).toBe(SHOTS[index].alt);
      expect(img.getAttribute('width')).not.toBeNull();
      expect(img.getAttribute('height')).not.toBeNull();
      expect(img.getAttribute('loading')).toBe(index === 0 ? null : 'lazy');
    });
  });

  it('offers a dark image to people who prefer dark mode', () => {
    const { container } = renderAbout();
    const dark = container.querySelectorAll('picture source[media*="prefers-color-scheme: dark"]');
    expect(dark.length).toBeGreaterThanOrEqual(SHOTS.length);
    expect(dark[0].getAttribute('srcset')).toMatch(/-dark\.webp$/);
  });

  it('starts sign-in from the top button', async () => {
    renderAbout();
    const [topButton] = screen.getAllByRole('button', { name: 'Sign in' });
    await userEvent.setup().click(topButton);
    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('ends with a second sign-in button', () => {
    renderAbout();
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(2);
  });

  it('explains what a pot is in the same words as the in-app help', () => {
    renderAbout();
    const faq = screen.getByRole('heading', { level: 2, name: 'Common questions' }).parentElement as HTMLElement;
    expect(within(faq).getByText(/money kept apart/i)).toBeInTheDocument();
  });
});
```

Append to the `cases` array in `app/routes/__tests__/meta.test.ts`, and add `import * as about from '../about';` beside the other route imports:

```ts
  ['About', about, 'About – Budget'],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/routes/__tests__/about.test.tsx app/routes/__tests__/meta.test.ts`
Expected: FAIL, cannot resolve `../about`.

- [ ] **Step 3: Write minimal implementation**

Create `app/routes/about.tsx`:

```tsx
import { Button, Card, Stack, Text, Title } from '@mantine/core';
import { useAuth0 } from '@auth0/auth0-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { SHOTS, SIZES, shotUrl, type Shot } from '~/lib/aboutShots';
import { GLOSSARY } from '~/lib/glossary';
import { pageTitle } from '~/lib/pageTitle';
import { SESSION_LIFETIME_TEXT } from '~/lib/sessionLifetime';
import type { Route } from './+types/about';

const FAQ = [
  {
    question: 'What is a pot?',
    answer: `${GLOSSARY.pot.definition} ${GLOSSARY.pot.example}`,
  },
  {
    question: 'What is a budget?',
    answer: `${GLOSSARY.target.definition} ${GLOSSARY.target.example}`,
  },
  {
    question: 'How do recurring bills work?',
    answer: 'Add a bill once and the app shows it on Home when it is due. Nothing is added until you confirm it with one tap.',
  },
  {
    question: 'Can I put it on my phone?',
    answer: 'Yes. Open the app in your phone browser and use "Add to Home Screen". It then opens like any other app.',
  },
];

function SignInButton() {
  const { loginWithRedirect } = useAuth0();

  async function signIn(): Promise<void> {
    try {
      await loginWithRedirect();
    } catch (error) {
      console.error('About: could not start sign-in', error);
    }
  }

  return <Button size="lg" onClick={() => void signIn()}>Sign in</Button>;
}

function ShotImage({ shot, first }: { shot: Shot; first: boolean }) {
  const { phone, desktop } = SIZES;
  return (
    <picture>
      <source media="(max-width: 767px) and (prefers-color-scheme: dark)" srcSet={shotUrl(shot.id, 'phone', 'dark')} />
      <source media="(max-width: 767px)" srcSet={shotUrl(shot.id, 'phone', 'light')} />
      <source media="(prefers-color-scheme: dark)" srcSet={shotUrl(shot.id, 'desktop', 'dark')} />
      <img
        src={shotUrl(shot.id, 'desktop', 'light')}
        alt={shot.alt}
        width={desktop.width}
        height={desktop.height}
        loading={first ? undefined : 'lazy'}
        style={{ width: '100%', height: 'auto', maxWidth: phone.width * 2, borderRadius: 8, border: '1px solid var(--mantine-color-default-border)' }}
      />
    </picture>
  );
}

function AboutContent() {
  return (
    <Stack maw={820} mx="auto" gap="xl">
      <Stack gap="sm">
        <Title order={1} size="h2">A calm way to keep track of your money</Title>
        <Text>
          Budget is a small app for knowing what you have left to spend. Add what you buy, set a budget only if you want one,
          and keep money apart in pots for the things you are saving towards. It works on a phone and on a computer, and it
          can be hosted by you.
        </Text>
        <Text size="sm" c="dimmed">{SESSION_LIFETIME_TEXT}</Text>
        <div><SignInButton /></div>
      </Stack>

      {SHOTS.map((shot, index) => (
        <Stack key={shot.id} id={`sec-${shot.id}`} gap="xs" component="section">
          <Title order={2} size="h3">{shot.heading}</Title>
          <Text>{shot.caption}</Text>
          <Text size="sm" c="dimmed">{shot.howTo}</Text>
          <ShotImage shot={shot} first={index === 0} />
        </Stack>
      ))}

      <Stack gap="sm" component="section">
        <Title order={2} size="h3">Common questions</Title>
        {FAQ.map(({ question, answer }) => (
          <Card key={question} withBorder>
            <Title order={3} size="h5" mb={4}>{question}</Title>
            <Text size="sm">{answer}</Text>
          </Card>
        ))}
      </Stack>

      <Stack align="center" gap="sm" py="lg">
        <Text fw={600}>Ready to try it?</Text>
        <SignInButton />
      </Stack>
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('About') }];

export default function About() {
  return (
    <DefaultLayout>
      <AboutContent />
    </DefaultLayout>
  );
}
```

If the `Route` types import fails because `+types/about` has not been generated, run `yarn typecheck` once (it runs `react-router typegen`); the same pattern is used by `app/routes/settings.tsx`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run app/routes/__tests__/about.test.tsx app/routes/__tests__/meta.test.ts`
Expected: PASS. If the FAQ test fails because the glossary wording differs from `/money kept apart/i`, read `GLOSSARY.pot.definition` in `app/lib/glossary.ts` and change the test regex to a phrase actually in it; do not change the glossary.

- [ ] **Step 5: Run the typecheck**

Run: `yarn typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/routes/about.tsx app/routes/__tests__/about.test.tsx app/routes/__tests__/meta.test.ts
git commit -m "feat: add the public About page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Entry points (sign-in panel and Settings)

**Files:**
- Modify: `app/components/layout/SignedOutPanel.tsx`
- Modify: `app/routes/settings.tsx` (a new card after the "Signing in" card, around line 51)
- Test: `app/components/layout/__tests__/DefaultLayout.test.tsx` (signed-out link), `app/routes/__tests__/settings.test.tsx` (Settings link)

**Interfaces:**
- Consumes: `Link` from `react-router`; `PUBLIC_PATHS` route `/about` from Task 2.
- Produces: link "See what it looks like" (href `/about`) in the signed-out and session-ended panels; link "Help and about" (href `/about`) on Settings.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('DefaultLayout public pages', ...)` block in `DefaultLayout.test.tsx`:

```tsx
  it('links from the signed-out panel to /about', () => {
    auth.isAuthenticated = false;
    renderLayout(<p>private content</p>, '/');
    expect(screen.getByRole('link', { name: 'See what it looks like' })).toHaveAttribute('href', '/about');
  });

  it('links from the session-ended panel to /about as well', () => {
    auth.isAuthenticated = false;
    auth.error = authError('login_required');
    renderLayout(<p>private content</p>, '/');
    expect(screen.getByRole('link', { name: 'See what it looks like' })).toHaveAttribute('href', '/about');
  });
```

Open `app/routes/__tests__/settings.test.tsx`, find how it renders `Settings` (it already renders the route inside a router), and add a test in the same style:

```tsx
  it('links to the help and about page', () => {
    renderSettings();
    expect(screen.getByRole('link', { name: 'Help and about' })).toHaveAttribute('href', '/about');
  });
```

Replace `renderSettings()` with whatever render helper that file already defines (read the top of the file; use its exact name and arguments).

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run app/components/layout/__tests__/DefaultLayout.test.tsx app/routes/__tests__/settings.test.tsx`
Expected: the three new tests FAIL (no such link).

- [ ] **Step 3: Write minimal implementation**

In `app/components/layout/SignedOutPanel.tsx`, add `Anchor` to the Mantine import, import `Link` from `react-router`, and add under the lifetime text:

```tsx
      <Anchor component={Link} to="/about" size="sm">See what it looks like</Anchor>
```

In `app/routes/settings.tsx`, `Link` is already imported. Add after the "Signing in" `Card`:

```tsx
      <Card withBorder>
        <Title order={2} size="h4" mb="sm">Help</Title>
        <Text size="sm" mb="xs">A short tour of every page, with pictures.</Text>
        <Link to="/about">Help and about</Link>
      </Card>
```

If `settings.tsx` renders other links with Mantine's `Anchor` or `NavLink` styling (see the `MANAGE_LINKS.map` block at line 147), match that style rather than a bare `Link`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run app/components/layout/__tests__/DefaultLayout.test.tsx app/routes/__tests__/settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/layout/SignedOutPanel.tsx app/routes/settings.tsx app/components/layout/__tests__/DefaultLayout.test.tsx app/routes/__tests__/settings.test.tsx
git commit -m "feat: link to the About page from sign-in and Settings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fixtures and fake API

**Files:**
- Create: `scripts/screenshots/fixtures.mjs`

**Interfaces:**
- Consumes: nothing from the app at runtime. Shapes follow `app/lib/types.ts`; all money is in pence.
- Produces: `export function createStore(now = new Date())` returning `{ handle(method, pathname, searchParams, body) }`, where `handle` returns `{ status: number, json: unknown }`. Endpoints answered (all others return `404` with `{ error: 'No fixture for METHOD PATH' }`, which the capture script treats as a failure):
  - `GET /api/categories` → `{ categories }`
  - `GET /api/transactions?year=&month=` → `{ transactions }`
  - `GET /api/transactions/range?from=&to=` → `{ transactions }`
  - `GET /api/targets` → `{ targets }`
  - `GET /api/pots?asOf=` → `{ pots }`
  - `GET /api/recurring` → `{ recurring }`
  - `GET /api/accounts` → `{ accounts }`
  - `GET /api/trash` → `{ items: [] }`
  - `POST /api/transactions` → `201`, `{ transaction }` (the Add shot never saves, but this keeps a stray save from failing)

- [ ] **Step 1: Write the fixtures**

Create `scripts/screenshots/fixtures.mjs`:

```js
// An invented household for the About page screenshots. Nothing here is real. Dates are worked out from
// "now", so Home always looks current. Money is in pence, as in the app.

const DAY_MS = 86_400_000;

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function ym(date) {
  return iso(date).slice(0, 7);
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * DAY_MS);
}

function monthStart(now, delta) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 1));
}

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const category = (categoryId, name, type, icon, group) => ({
  categoryId, name, type, icon, ...(group ? { group } : {}), isDefault: true, createdAt: CREATED_AT,
});

const CATEGORIES = [
  category('cat-mortgage', 'Mortgage', 'EXPENSE', '🏠', 'BILLS'),
  category('cat-phone-internet', 'Phone and Internet', 'EXPENSE', '🛜', 'BILLS'),
  category('cat-subscriptions', 'Subscriptions', 'EXPENSE', '🗓️', 'BILLS'),
  category('cat-utilities', 'Utilities', 'EXPENSE', '⚡', 'BILLS'),
  category('cat-holidays', 'Holidays', 'POT', '✈️', 'SINKING_FUNDS'),
  category('cat-gifts', 'Gifts', 'POT', '🎁', 'SINKING_FUNDS'),
  category('cat-going-out', 'Going Out & Entertainment', 'EXPENSE', '🎡', 'EVERYDAY'),
  category('cat-groceries', 'Groceries', 'EXPENSE', '🛒', 'EVERYDAY'),
  category('cat-health', 'Health', 'EXPENSE', '🏥', 'EVERYDAY'),
  category('cat-transport', 'Transport', 'EXPENSE', '🛞', 'EVERYDAY'),
  category('cat-emergency-fund', 'Emergency fund', 'POT', '😌', 'SAVING_INVESTMENT'),
  category('cat-investment', 'Investment', 'POT', '📈', 'SAVING_INVESTMENT'),
  category('cat-salary', 'Salary', 'INCOME', 'briefcase'),
];

let nextId = 1;
const tx = (date, type, categoryId, amount, description, extra = {}) => ({
  transactionId: `demo-${String(nextId++).padStart(4, '0')}`,
  yearMonth: iso(date).slice(0, 7),
  amount, type, categoryId, description, date: iso(date), createdAt: `${iso(date)}T09:00:00.000Z`, ...extra,
});

function buildTransactions(now) {
  const rows = [];
  for (const delta of [-2, -1, 0]) {
    const start = monthStart(now, delta);
    const day = d => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), d));
    const lastDay = delta === 0 ? now.getUTCDate() : 28;
    const on = d => (d <= lastDay ? day(d) : null);
    const add = (d, ...args) => { const date = on(d); if (date) rows.push(tx(date, ...args)); };
    add(1, 'INCOME', 'cat-salary', 215000, 'Salary');
    add(1, 'EXPENSE', 'cat-mortgage', 78000, 'Mortgage');
    add(2, 'EXPENSE', 'cat-phone-internet', 3200, 'Phone and broadband');
    add(3, 'EXPENSE', 'cat-groceries', 6420, 'Weekly shop');
    add(5, 'EXPENSE', 'cat-subscriptions', 1599, 'Streaming');
    add(6, 'EXPENSE', 'cat-transport', 4500, 'Train season top-up');
    add(8, 'EXPENSE', 'cat-going-out', 2850, 'Dinner out');
    add(10, 'EXPENSE', 'cat-groceries', 5870, 'Weekly shop');
    add(12, 'EXPENSE', 'cat-utilities', 9400, 'Gas and electric');
    add(14, 'EXPENSE', 'cat-health', 1200, 'Pharmacy');
    add(15, 'SET_ASIDE', 'cat-holidays', 15000, 'Holiday pot');
    add(15, 'SET_ASIDE', 'cat-emergency-fund', 10000, 'Emergency fund');
    add(17, 'EXPENSE', 'cat-groceries', 6105, 'Weekly shop');
    add(19, 'EXPENSE', 'cat-going-out', 1850, 'Cinema');
    add(22, 'EXPENSE', 'cat-transport', 2300, 'Taxi home');
    add(24, 'EXPENSE', 'cat-groceries', 5990, 'Weekly shop');
    add(26, 'EXPENSE', 'cat-gifts', 3500, 'Birthday present');
  }
  // A few in the last days so Home and Transactions have something from "today".
  rows.push(tx(now, 'EXPENSE', 'cat-groceries', 1840, 'Corner shop'));
  rows.push(tx(daysAgo(now, 1), 'EXPENSE', 'cat-going-out', 1260, 'Coffee with a friend'));
  return rows;
}

function buildPots(now) {
  const month = ym(now);
  const pot = (categoryId, balance, monthlyAmount, goalAmount) => ({
    categoryId, monthlyAmount, goalAmount, autoAmountNow: 0, archivedAt: null, balance,
    thisMonth: { setAside: monthlyAmount ?? 0, autoAdded: 0, takeOut: 0, spent: 0 },
    months: [{ yearMonth: month, opening: balance - (monthlyAmount ?? 0), setAside: monthlyAmount ?? 0, autoAdded: 0, takeOut: 0, spent: 0, closing: balance }],
  });
  return [pot('cat-holidays', 84000, 15000, 150000), pot('cat-emergency-fund', 310000, 10000, 500000)];
}

function buildRecurring(now) {
  const soon = new Date(now.getTime() + 3 * DAY_MS);
  const base = { frequency: 'MONTHLY', anchorDate: null, leadDays: 5, handledPeriod: null, createdAt: CREATED_AT, updatedAt: CREATED_AT, type: 'EXPENSE' };
  return [
    { ...base, recurringId: 'rec-mortgage', categoryId: 'cat-mortgage', amount: 78000, description: 'Mortgage', dayOfMonth: 1 },
    { ...base, recurringId: 'rec-streaming', categoryId: 'cat-subscriptions', amount: 1599, description: 'Streaming', dayOfMonth: soon.getUTCDate() },
  ];
}

function buildAccounts(now) {
  const balances = pence => [{ date: iso(daysAgo(now, 2)), pence }];
  return [
    { accountId: 'acc-current', name: 'Current account', kind: 'ASSET', type: 'CASH', balances: balances(184250), createdAt: CREATED_AT },
    { accountId: 'acc-savings', name: 'Savings', kind: 'ASSET', type: 'SAVINGS', balances: balances(1250000), createdAt: CREATED_AT },
    { accountId: 'acc-card', name: 'Credit card', kind: 'LIABILITY', type: 'CREDIT_CARD', balances: balances(42000), createdAt: CREATED_AT },
  ];
}

function buildTargets(now) {
  const t = (categoryId, targetAmount) => ({ categoryId, targetAmount, period: 'MONTHLY', updatedAt: CREATED_AT });
  return [t('cat-groceries', 30000), t('cat-going-out', 10000), t('cat-transport', 8000), t('cat-health', 5000)];
}

export function createStore(now = new Date()) {
  const transactions = buildTransactions(now);
  const state = {
    categories: CATEGORIES,
    targets: buildTargets(now),
    pots: buildPots(now),
    recurring: buildRecurring(now),
    accounts: buildAccounts(now),
  };

  function handle(method, pathname, params, body) {
    const key = `${method} ${pathname}`;
    switch (key) {
      case 'GET /api/categories': return { status: 200, json: { categories: state.categories } };
      case 'GET /api/targets': return { status: 200, json: { targets: state.targets } };
      case 'GET /api/pots': return { status: 200, json: { pots: state.pots } };
      case 'GET /api/recurring': return { status: 200, json: { recurring: state.recurring } };
      case 'GET /api/accounts': return { status: 200, json: { accounts: state.accounts } };
      case 'GET /api/trash': return { status: 200, json: { items: [] } };
      case 'GET /api/transactions': {
        const wanted = `${params.get('year')}-${String(params.get('month')).padStart(2, '0')}`;
        return { status: 200, json: { transactions: transactions.filter(row => row.yearMonth === wanted) } };
      }
      case 'GET /api/transactions/range': {
        const from = params.get('from');
        const to = params.get('to');
        return { status: 200, json: { transactions: transactions.filter(row => row.yearMonth >= from && row.yearMonth <= to) } };
      }
      case 'POST /api/transactions': {
        const created = tx(now, body.type, body.categoryId, body.amount, body.description ?? '');
        transactions.push(created);
        return { status: 201, json: { transaction: created } };
      }
      default:
        return { status: 404, json: { error: `No fixture for ${key}` } };
    }
  }

  return { handle };
}
```

- [ ] **Step 2: Check it loads and answers**

Run:
```bash
node -e "import('./scripts/screenshots/fixtures.mjs').then(m => { const s = m.createStore(); const r = s.handle('GET', '/api/transactions/range', new URLSearchParams('from=2026-01&to=2099-12'), null); console.log(r.status, r.json.transactions.length); console.log(s.handle('GET', '/api/nope', new URLSearchParams(), null).status); })"
```
Expected: `200` and a count of roughly 50, then `404`.

- [ ] **Step 3: Commit**

```bash
git add scripts/screenshots/fixtures.mjs
git commit -m "feat: add invented household data for the screenshot harness

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Auth seed and capture script

**Files:**
- Create: `scripts/screenshots/auth.mjs`
- Create: `scripts/screenshots/capture.mjs`
- Modify: `package.json` (script and devDependencies)

**Interfaces:**
- Consumes: `createStore` (Task 5); `SHOTS`, `SIZES`, `SCHEMES`, `shotFileName` from `../../app/lib/aboutShots.ts` (Task 1; Node 24 strips the types).
- Produces: `export const DUMMY_ENV`, `export function authStorage(now)` in `auth.mjs`; `yarn screenshots` writes `public/about/<id>-<size>-<scheme>.webp`.

Shot setups the script performs (all after the page settles):
- `home`, `transactions`, `plan`, `insights`, `recurring`, `settings`: navigate and wait for network idle.
- `add`: navigate to `/`, then click the button named "Add transaction" (on desktop the header button; on phone the tab-bar button), wait for the dialog, type `4.20` into the amount field, choose the "Groceries" category chip, wait 800ms for the slide-in.

- [ ] **Step 1: Install dependencies**

Run: `yarn add --dev playwright sharp && yarn playwright install chromium`
Expected: both added to `devDependencies`; Chromium downloads. Then run `yarn audit` and confirm 0 high and 0 critical (CI fails on any).

- [ ] **Step 2: Write the auth seed**

Create `scripts/screenshots/auth.mjs`:

```js
// Dummy Auth0 values for the screenshot run. They point at nothing real; the harness sets them itself and
// refuses to run if the shell already has different ones, so it can never reach a real tenant.
export const DUMMY_ENV = {
  VITE_AUTH0_DOMAIN: 'screenshots.invalid',
  VITE_AUTH0_CLIENT_ID: 'dummy',
  VITE_AUTH0_AUDIENCE: 'https://screenshots.invalid/api',
};

const SCOPE = 'openid profile email offline_access';

// The Auth0 SPA SDK keeps a signed-in session in localStorage under keys it builds from the client id and
// audience. Seeding them makes the app believe someone is signed in, so no sign-in page is ever visited.
export function authStorage(now = new Date()) {
  const { VITE_AUTH0_CLIENT_ID: clientId, VITE_AUTH0_AUDIENCE: audience } = DUMMY_ENV;
  const user = { sub: 'auth0|demo', name: 'Demo User', email: 'demo@example.invalid' };
  const claims = { ...user, __raw: 'demo.id.token', iss: `https://${DUMMY_ENV.VITE_AUTH0_DOMAIN}/`, aud: clientId };
  const tokenKey = `@@auth0spajs@@::${clientId}::${audience}::${SCOPE}`;
  const expiresAt = Math.floor(now.getTime() / 1000) + 24 * 3600;

  return {
    [tokenKey]: JSON.stringify({
      body: {
        client_id: clientId, access_token: 'demo-access', id_token: 'demo.id.token', scope: SCOPE,
        expires_in: 86400, token_type: 'Bearer', audience,
        decodedToken: { claims, user }, oauthTokenScope: SCOPE,
      },
      expiresAt,
    }),
    [`@@auth0spajs@@::${clientId}`]: JSON.stringify({ keys: [tokenKey] }),
    [`@@auth0spajs@@::${clientId}::@@user@@`]: JSON.stringify({ id_token: 'demo.id.token', decodedToken: { claims, user } }),
    // Hide the one-time "What's changed" cards and the first-run tour, which would otherwise sit in the shots.
    'budget.preferences': JSON.stringify({ seenReleases: ['menu-2026-10', 'names-2026-10'], tourStep: 3 }),
  };
}
```

- [ ] **Step 3: Write the capture script**

Create `scripts/screenshots/capture.mjs`:

```js
// Run with `yarn screenshots`. Starts the dev server against dummy Auth0 values, signs in with a seeded
// session, answers /api from fixtures, and saves WebP screenshots to public/about/.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { SCHEMES, SHOTS, SIZES, shotFileName } from '../../app/lib/aboutShots.ts';
import { DUMMY_ENV, authStorage } from './auth.mjs';
import { createStore } from './fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'public', 'about');

function refuseRealTenant() {
  for (const [name, dummy] of Object.entries(DUMMY_ENV)) {
    const existing = process.env[name];
    if (existing && existing !== dummy) {
      throw new Error(`${name} is set in this shell. Refusing to run against it; unset it and try again.`);
    }
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startDevServer(port) {
  const child = spawn('yarn', ['dev', '--port', String(port), '--strictPort'], {
    cwd: ROOT, env: { ...process.env, ...DUMMY_ENV }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const url = `http://localhost:${port}`;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(url)).ok) return { child, url };
    } catch {
      // not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  child.kill();
  throw new Error(`The dev server did not start. Output:\n${log}`);
}

async function openAddSheet(page, size) {
  await page.getByRole('button', { name: 'Add transaction' }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByRole('textbox').first().fill('4.20');
  await dialog.getByText('Groceries', { exact: true }).first().click();
  await page.waitForTimeout(800);
}

async function capture(browser, url, store, failures, shot, sizeName, scheme) {
  const { width, height } = SIZES[sizeName];
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 2 });
  await context.addInitScript(({ entries, colorScheme }) => {
    for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
    // Mantine reads its colour scheme from here, so the dark shots do not depend on the OS setting.
    window.localStorage.setItem('mantine-color-scheme-value', colorScheme);
  }, { entries: authStorage(), colorScheme: scheme });
  await context.route('**/*', async route => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    if (!pathname.startsWith('/api/')) return route.fallback();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    const { status, json } = store.handle(request.method(), pathname, searchParams, body);
    if (status === 404) failures.push(`${shot.id}/${sizeName}/${scheme}: ${json.error}`);
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });

  const page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`${shot.id}/${sizeName}/${scheme}: console error: ${message.text()}`);
  });
  page.on('pageerror', error => failures.push(`${shot.id}/${sizeName}/${scheme}: page error: ${error.message}`));

  await page.goto(`${url}${shot.route}`, { waitUntil: 'networkidle' });
  if (shot.id === 'add') await openAddSheet(page, sizeName);
  await page.waitForTimeout(400);

  const png = await page.screenshot({ type: 'png' });
  await sharp(png).webp({ quality: 82 }).toFile(path.join(OUT_DIR, shotFileName(shot.id, sizeName, scheme)));
  await context.close();
}

async function main() {
  refuseRealTenant();
  await mkdir(OUT_DIR, { recursive: true });
  const port = await freePort();
  const { child, url } = await startDevServer(port);
  const failures = [];
  const browser = await chromium.launch();
  try {
    const store = createStore();
    // The first load makes Vite re-optimise its dependencies, which reloads the page. Do it once up front.
    const warm = await browser.newPage();
    await warm.goto(url, { waitUntil: 'networkidle' });
    await warm.waitForTimeout(3000);
    await warm.close();

    for (const shot of SHOTS) {
      for (const sizeName of Object.keys(SIZES)) {
        for (const scheme of SCHEMES) {
          await capture(browser, url, store, failures, shot, sizeName, scheme);
          console.log(`saved ${shotFileName(shot.id, sizeName, scheme)}`);
        }
      }
    }
  } finally {
    await browser.close();
    child.kill();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} problem(s):\n${[...new Set(failures)].join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```

Add to `package.json` `scripts`: `"screenshots": "node scripts/screenshots/capture.mjs"`.

- [ ] **Step 4: Run it**

Run: `yarn screenshots`
Expected: 28 lines of `saved ...webp` and exit code 0. If it reports problems, each line names the shot and what failed:
- `No fixture for GET /api/...` → add that endpoint to `createStore` in `fixtures.mjs` with the shape from `app/lib/api.ts`.
- `console error` about a missing key or shape → fix the fixture, not the app.
- The app shows the "You're signed out" panel in a screenshot → the Auth0 seed is wrong: compare the keys in `auth.mjs` with what the SDK reads, in the browser's localStorage after a fresh seed.
- The `add` shot fails to find the amount field or the Groceries chip → open `app/components/transactions/TransactionSheet.tsx`, read the field's accessible name, and update `openAddSheet` to use it.

Do not edit the app to make the harness pass.

- [ ] **Step 5: Look at every image**

Open each of the 28 files in `public/about/` (the Read tool shows images). Confirm: signed in (no sign-in panel); no Vite error overlay; no empty states; dark images are actually dark; the `add` shot shows the sheet with `4.20` and Groceries chosen; text is legible at phone width. Fix and re-run until they are right.

- [ ] **Step 6: Commit the script**

```bash
git add scripts/screenshots/auth.mjs scripts/screenshots/capture.mjs package.json yarn.lock
git commit -m "feat: add yarn screenshots, a harness that captures the About page images

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Commit the images and verify the whole thing

**Files:**
- Create: `public/about/*.webp` (28, generated in Task 6)
- Create: `app/routes/__tests__/aboutImages.test.ts`

**Interfaces:**
- Consumes: `allShotFileNames` (Task 1).
- Produces: a test that fails when a listed image is missing from `public/about/`.

- [ ] **Step 1: Write the test**

Create `app/routes/__tests__/aboutImages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { allShotFileNames } from '~/lib/aboutShots';

const DIR = path.resolve(process.cwd(), 'public', 'about');

describe('About page images', () => {
  it('has a committed image for every shot, size and scheme', () => {
    const missing = allShotFileNames().filter(name => !existsSync(path.join(DIR, name)));
    expect(missing).toEqual([]);
  });

  it('has no image that the shot list does not mention', () => {
    const wanted = new Set(allShotFileNames());
    const extra = readdirSync(DIR).filter(name => name.endsWith('.webp') && !wanted.has(name));
    expect(extra).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `yarn vitest run app/routes/__tests__/aboutImages.test.ts`
Expected: PASS (the images exist from Task 6). To see it fail first, temporarily rename one file in `public/about/`, run it, then restore the file.

- [ ] **Step 3: Full verification**

Run: `yarn test` then `yarn typecheck`, then `yarn audit --json | jq -r 'select(.type=="auditSummary") | .data.vulnerabilities'`.
Expected: all tests pass; typecheck clean; 0 high and 0 critical.

- [ ] **Step 4: Check the page in a browser**

Run `yarn dev` with the dummy env values from `scripts/screenshots/auth.mjs` exported, and open `/about` signed out. Check at a phone width and a desktop width, in both colour schemes: images load and match the scheme, no layout shift, the sign-in buttons are reachable by keyboard, and the "See what it looks like" link on `/` goes to the page. Report what you saw, including anything you could not check.

- [ ] **Step 5: Commit**

```bash
git add public/about app/routes/__tests__/aboutImages.test.ts
git commit -m "feat: add the About page screenshots

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Note the refresh step**

Add one line to the "Security checklist"-style PR checklist if the repo has one (search `.github/pull_request_template.md`); if it does not, skip this step. The line: `- [ ] If the UI changed visibly, re-run yarn screenshots and commit public/about/.`
