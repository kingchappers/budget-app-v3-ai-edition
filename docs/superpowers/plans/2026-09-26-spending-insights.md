# Plan: Spending insights (H)

Spec: `docs/superpowers/specs/2026-09-26-spending-insights-design.md`.

Developing directly on the session's assigned branch (`claude/subprojects-g-h-tasks-slpjtk`), not a new `feat/` branch, since this session's environment pins that branch.

## Steps

1. **Shared API helpers** (no behaviour change, refactor only)
   - `src/api/months.ts`: `isValidMonth`, `monthIndex`, `serverMonthIndex`, lifted from `pots.ts`.
   - `src/api/dynamo.ts`: `queryAll`, lifted from `pots.ts`.
   - Update `pots.ts` to import both; `pots.test.ts` should still pass unchanged.

2. **Insights calculation**
   - `src/api/insightsCalc.ts`: types + `computeInsights`.
   - `src/api/__tests__/insightsCalc.test.ts`.

3. **Insights endpoint**
   - `src/api/insights.ts`: `getInsights` handler (validates `asOf`/`months`, queries categories + transactions, calls `computeInsights`).
   - `src/api/__tests__/insights.test.ts`.
   - Register `GET /api/insights` in `api-handler.ts`.
   - `src/api/types.ts`: add the `Insights`-family types.

4. **Client data layer**
   - `app/lib/types.ts`: mirror the `Insights` types.
   - `app/lib/api.ts`: `getInsights(asOf, months?)`.
   - `app/lib/queries.ts`: `useInsights(asOf, months?)` + `queryKeys.insights`.
   - `app/lib/__tests__/queries.test.tsx`: cover the new hook.
   - `summary.ts`: export `toProgress` (currently private) so the Insights page can reuse it for the budget-vs-actual row instead of duplicating the normalisation math.

5. **UI**
   - `app/components/insights/CategoryTrendList.tsx`
   - `app/components/insights/BudgetVsActualList.tsx`
   - `app/components/insights/TopNotesList.tsx`
   - `app/routes/insights.tsx`
   - Component tests for each, mirroring the Pots component tests.
   - `app/routes/__tests__/insights.test.tsx`.
   - `DefaultLayout.tsx`: add "Insights" to `SIDEBAR_ONLY_ITEMS`.

6. **Verify**
   - `yarn test`, `yarn typecheck`.
   - Run the app (`yarn dev`) and check the Insights page renders against real cached data (Playwright/browser pass).

7. **Docs**
   - `docs/ROADMAP.md`: mark H implemented, log follow-ups found during the browser pass, note G was skipped by request.
