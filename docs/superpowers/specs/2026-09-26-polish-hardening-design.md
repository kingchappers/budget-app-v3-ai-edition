# Polish and hardening: design

Sub-project **G**. It fixes a batch of small issues collected from the A to F2 reviews. It builds on F2 (`docs/superpowers/specs/2026-09-25-savings-pots-design.md`, PR #38), so its branch, `feat/polish-hardening`, starts from `feat/savings-pots`. Later sub-projects: H spending insights, I net worth and accounts, J offline entry queue.

## Intent

Close the known rough edges and security gaps before more features go on top: a late-loading note history that never recalls a category, bottom sheets that fill the whole phone screen, no upper bound on amounts, a static handler that serves its own source and sends no Content-Security-Policy, an Undo that leaves a recurring item hidden, and an immediate recurring delete. The owner's Auth0 tenant is `dev-xf4mizgda1uv0xvb.uk.auth0.com`; it is public (it appears in the built client) but is still read from `VITE_AUTH0_DOMAIN` at build time and never hard-coded.

## Decisions

| Question | Decision |
|----------|----------|
| Scope | Six fixes (below). The floating + button overlapping a row is not fixed: `AppShell.Main` already has 150px of bottom padding, so the overlap is only momentary while scrolling. |
| Amount cap | £10,000,000 (1,000,000,000 pence), one shared constant, the same value the pots API already uses. |
| CSP | Sent as `Content-Security-Policy-Report-Only` first, with a one-line switch to enforce. Enforcing waits until the owner has checked the browser console after a deploy. |
| Recurring delete | A confirmation dialog, not an Undo toast. |
| Branching | `feat/polish-hardening` is stacked on `feat/savings-pots`; retarget the PR to `main` if #38 merges first. |
| Delivery | Written as a plan for a cloud agent to execute; the agent commits and pushes the branch but opens no PR. Review, the security checklist and the PR happen afterwards. |

**Not doing (on purpose):** enforcing the CSP now, moving the handler out of the served directory (needs an infra change), an Undo for recurring delete, and the other logged follow-ups (grouped selects elsewhere, group editing, Home emoji).

## 1. The six fixes

**1. Note recall for late history** (`app/components/transactions/TransactionSheet.tsx`). The recall step is pulled out of the note-change handler into one function. An effect re-runs it when the note history (`noteIndex`) changes, but only when a note is present, the sheet is not editing, and the category was not picked by the user (`categorySource !== 'user'`). It never overwrites a user pick. Clearing a remembered category when the note stops matching behaves as today.

**2. Bottom sheets on mobile** (`app/components/layout/ResponsiveSheet.tsx`). The mobile drawer sizes to its content with a maximum of about 90% of the screen height and its own scrolling above that, with rounded top corners. Desktop's centred modal is unchanged. The current `size="auto"` has no effect (the drawer fills the screen with content at the top), so the exact Mantine styling is settled and confirmed in a real browser at 390px.

**3. Amount limits.**
- API: `MAX_AMOUNT_PENCE = 1_000_000_000` in `src/api/constants.ts`. Transaction and recurring validation reject an amount above it with 400 (an amount equal to it is accepted). The pots API imports the shared constant in place of its local `MAX_POT_AMOUNT_PENCE` (the export keeps working for its tests).
- Client: `app/lib/money.ts` gets `MAX_AMOUNT_PENCE` and `parsePounds` rejects any amount that is not a safe integer or is above the cap with `Amount is too large`. That covers the Add sheet, recurring templates, targets and pot settings, which all use `parsePounds`.

**4. Static handler** (`src/static/handler.ts`, `scripts/build-static-handler.cjs`).
- `/index.js` (the handler's own source) returns 404, also with a query string or percent-encoding. Other files are unaffected.
- A `Content-Security-Policy-Report-Only` header is added to HTML responses only (the page, SPA fallbacks, directory indexes), not to assets, JSON or errors.
- A pure `buildCsp(indexHtml, auth0Domain)` builds the policy when the handler starts. `script-src` is `'self'` plus the sha256 hash of every inline `<script>` without a `src` in `index.html` (the built page has five, and their content changes each build), with no `unsafe-inline`. `style-src` is `'self' 'unsafe-inline' https://fonts.googleapis.com` (Mantine adds `<style>` elements at runtime). `font-src` is `https://fonts.gstatic.com`. `connect-src` and `frame-src` allow `'self'` and the Auth0 tenant. `img-src` allows `'self' data:` plus Gravatar, Google and Auth0 CDN profile pictures. It also sets `object-src 'none'`, `base-uri 'self'`, `manifest-src 'self'` and `frame-ancestors 'none'`.
- The build script writes `build/client/csp.json` (`{ "auth0Domain": "<VITE_AUTH0_DOMAIN>" }`) after compiling the handler. If the file is missing or empty the policy simply omits the Auth0 origins.
- The header name is one constant, so switching to enforcing is a one-word follow-up.

**5. Undo after a Due-card Edit.** `useSaveWithUndo`'s returned function takes an optional second argument `{ onUndo?: () => void }`, called when the user presses Undo (after the delete is issued). `TransactionSheet` gets an optional `onUndone` prop and passes it through. In `DueRecurringCard`, the Edit path's `onSaved` marks the item handled as today, and `onUndone` restores the item's previous handled period (`editing.recurring.handledPeriod`, captured when Edit was opened). Undo after Add and Skip behave as they do now.

**6. Recurring delete** (`app/routes/recurring.tsx`). Choosing Delete opens a Mantine `Modal` ("Delete <name>? This can't be undone.") with Cancel and Delete. Only Delete calls the existing remove mutation.

## 2. Testing, verification and rollout

**Automated tests**

- Note recall: history arriving after a matching note is typed recalls the category; a user pick is never overwritten; editing is unaffected; a note that stops matching still clears a remembered category.
- Amount cap: API tests for transactions, recurring and pots (exactly the cap accepted, one pence over is 400); `parsePounds` tests for the cap, a 20-digit input and exactly the cap.
- Static handler: `/index.js` is 404 (also with `?x=1` and `%69ndex.js`), other files unaffected; the CSP-Report-Only header is on HTML responses only; `buildCsp` tests: the script hashes match the real inline scripts, scripts with a `src` are skipped, `script-src` has no `unsafe-inline`, `style-src` does, the Auth0 origin is present, a missing or empty domain still gives a valid policy; the handler tolerates a missing `csp.json`.
- Due-card Edit then Undo restores the previous handled period; Skip and Add are unchanged.
- Recurring delete: a dialog appears, Cancel deletes nothing, Delete removes the template.
- Existing suites stay green; `yarn typecheck` is clean.

**Verification the executing agent runs** (scratch files outside the repo):

- Build with `VITE_AUTH0_DOMAIN=dev-xf4mizgda1uv0xvb.uk.auth0.com` and dummy client values, serve `build/client` through the compiled handler on a local port, load the app in headless Chromium with stubbed sign-in and API, collect every `securitypolicyviolation` event and console message across the main pages, and expect zero violations.
- In a scratch copy, switch the header to enforcing and confirm the app still loads and works.
- Screenshot the bottom sheets at 390px and confirm they size to their content.

**Rollout:** a code deploy with no infra, IAM or dependency changes. The pipeline already builds with `VITE_AUTH0_DOMAIN`, so `csp.json` is generated at build. The header is report-only, so behaviour does not change. After deploying, the owner opens the app signed in and checks the browser console for CSP reports; if it is quiet, a one-word follow-up makes it enforcing. Rollback is a revert.

## Global constraints (for the plan)

- No infra, IAM or dependency changes.
- Explicit types on function parameters and return values; early returns; no nested ternaries; no comments that restate code; no empty catch blocks.
- StrictMode: never read an event object inside a functional `setState` updater; effects must tolerate double invocation, and an effect must never overwrite what the user typed or chose.
- Security controls in `SECURITY.md` apply (IO-01 for the amount cap, WEB-A05 for the CSP); run the pre-PR checklist before any PR.
- Conventional commits, imperative subject under 72 characters, explicit staging, and the repo's commit trailers.
- Update `docs/ROADMAP.md` (G status and follow-ups).

## Follow-ups

- Switch the CSP from report-only to enforcing once the console is quiet after a deploy.
- Grouped selects in the recurring form, the Transactions filter and the reassign dialog; group editing; Home emoji (logged under F1).
- Moving the handler out of the served directory, if the 404 is ever not enough.
