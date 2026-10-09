# Public About page and screenshot harness: design

Gives people who are not signed in a way to see the product before they use it, and gives signed-in people a help page. The screenshots come from a repeatable script that runs the real app against invented data, so they can be refreshed whenever the UI changes.

## Decisions

| Question | Decision |
|----------|----------|
| Static or interactive? | Static screenshots only. A live try-it demo stays on the roadmap as "Demo Mode". |
| Where does the harness live? | In the repo, under `scripts/screenshots/`, run with `yarn screenshots`. Playwright becomes a devDependency. |
| How does a signed-out visitor reach the page? | A new `/about` route. `DefaultLayout` keeps its sign-in gate but lets a small allowlist of paths through. |
| Is the page also the help page? | Yes. It renders the same signed in or out, with a Help link from Settings. |
| What data is shown? | Entirely invented. No real transactions, names or amounts. |
| Image format and theme | WebP, at 390px (phone) and 1280px (desktop), in light and dark. The page picks the dark image with `<picture>` and `prefers-color-scheme`. |

## 1. Public route allowlist

```ts
// app/components/layout/DefaultLayout.tsx
export const PUBLIC_PATHS = ['/about'];
```

- `MainContent` renders `children` when the session is `signedIn` **or** the current pathname is in `PUBLIC_PATHS`. Otherwise behaviour is unchanged: `loading` shows the loader, and signed out or ended shows `SignedOutPanel`.
- While Auth0 is still loading, a public path renders immediately instead of the loader, so the page never flashes a spinner.
- The header, theme toggle and sign-in button stay. The Add button and tab-bar Add stay hidden when signed out, as today.
- `NAV_ITEMS` does not gain an About entry. Entry points are below.

## 2. About page (`app/routes/about.tsx`)

Static content, no API calls, so it works with no session.

1. **Intro.** One short paragraph: what the app is, who it is for, and that it can be self-hosted. A primary "Sign in" button.
2. **Walkthrough.** One section per feature, each with a screenshot, a caption and one "how to" line:
   Home, Add a transaction, Transactions, Plan (budgets and pots), Insights, Recurring bills, Settings.
3. **Short FAQ.** How recurring bills work, what a pot is, how to install the app to a phone's home screen. Wording reuses `app/lib/glossary.ts` terms so the page and the in-app help agree.
4. **Final sign-in call to action.**

Rules:
- Every image has alt text that says what it shows, not "screenshot".
- Images have explicit `width` and `height` so the page does not shift as they load, and `loading="lazy"` below the first.
- The route exports `meta` with the title `About – Budget` via the existing `pageTitle` helper.
- Image paths come from one typed list (`app/lib/aboutShots.ts`) shared by the page and the capture script, so a renamed shot cannot silently break the page.

## 3. Entry points

- `SignedOutPanel` gets a text link "See what it looks like" to `/about`, under the Sign in button.
- Settings gets a "Help and about" link to `/about`.
- No change to the avatar menu or navigation bar.

## 4. Screenshot harness (`scripts/screenshots/`)

`yarn screenshots` does the following:

1. Starts `yarn dev` on a free port with dummy `VITE_AUTH0_*` values, and waits for it.
2. Launches headless Chromium via Playwright.
3. Seeds the Auth0 SPA SDK localStorage cache for the dummy client and audience (token entry, manifest, and `@@user@@` entry), so the app believes it is signed in. No credentials are used or contacted.
4. Routes `**/api/**` to an in-memory fixture store with the same response shapes as `api-handler.ts`, and lets every other request through.
5. Warms the page once (Vite re-optimises dependencies on first load), then visits each shot in `aboutShots.ts`, waits for it to settle (about 800ms after a sheet opens, to skip the slide-in), and writes WebP files to `public/about/`.
6. Stops the dev server, including on failure.

**Fixtures (`fixtures.ts`).** One invented household: about three months of transactions, the default categories with their groups and emoji, budgets for a few categories, two pots (Holidays and Emergency fund) with balances, two recurring bills with one due soon, and two accounts. Dates are computed from "today", so Home always looks current. Names and amounts are generic.

**Shot list (`shots.ts`).** Each entry has an id, route, optional setup steps (for example open the Add sheet and type an amount), viewport, and colour scheme. Starting list:

| Id | Route | Notes |
|----|-------|-------|
| home | `/` | Left to spend, upcoming bill |
| add | `/` | Add sheet open with an amount typed |
| transactions | `/transactions` | |
| plan | `/plan` | Budgets and pots |
| insights | `/insights` | |
| recurring | `/recurring` | |
| settings | `/settings` | |

Each id is captured four times: phone and desktop, light and dark. That is 28 images in total.

**Guard rails.**
- The script refuses to run if `VITE_AUTH0_DOMAIN` points at a real tenant, by requiring the dummy values it sets itself.
- It fails if any shot's page logs a console error or an unhandled `/api/` route, so a missing fixture shows up as a failure rather than a blank screenshot.
- Output files are committed. The script is not part of `yarn build` or CI.

## 5. Testing

- Vitest, in `app/components/layout/__tests__/`: with a signed-out session, `/about` renders the page and `/` still renders `SignedOutPanel`. While loading, `/about` renders and `/` shows the loader.
- Vitest: `SignedOutPanel` shows the link to `/about`; Settings shows its link.
- Vitest: every entry in `aboutShots.ts` has the four expected file names, and `public/about/` contains each one (catches a stale or missing screenshot).
- The About page gets the same axe check the other routes use, for contrast and alt text, in light and dark.
- The harness itself has no unit tests. It is verified by running it and viewing the output.

## 6. Out of scope

- A live, interactive demo (roadmap "Demo Mode").
- Screenshots in the README.
- Translating the page, or marketing copy beyond factual descriptions.
- Running the harness in CI or regenerating screenshots automatically.
- Changes to infrastructure: the static Lambda already serves `public/` files and the CSP allows `img-src 'self'`.

## 7. Risks

- **Screenshots go stale.** Mitigated by one command to refresh, and by the guard rail on console errors. Nothing forces a refresh when the UI changes, so the plan should mention re-running it in the PR checklist.
- **The Auth0 cache seed depends on SDK internals** (key names). If the SDK changes them, the harness breaks loudly (the app shows the sign-in panel), not silently.
- **Repo size.** 28 WebP images at roughly 30-80 KB each is a small, one-off addition, but each refresh adds a new copy to git history.
