# Decision Log

Notable architecture/product decisions that aren't obvious from the code alone, especially ones that were tried, reverted, or explicitly deferred.

## 2026-09-18: Automatic bank sync removed — no viable free UK provider

**Status:** Active. Transactions are entered manually; there is no bank connection feature.

**What was tried:**
1. [Enable Banking](https://enablebanking.com) — chosen first as a free, modern open banking aggregator. Discovered during setup that it does not support UK banks: it covers EEA/EU countries only, and the transitional arrangement that let some EU-passported firms keep operating in the UK ended 31 December 2025.
2. [TrueLayer](https://truelayer.com) — rebuilt the entire feature (provider client, OAuth, connection/webhook flow, worker Lambda, EventBridge schedule, Secrets Manager storage) against TrueLayer's Data API v3. Got as far as a working client-credentials token exchange, but `POST /v3/data-connections` consistently returned `403 Forbidden` in sandbox regardless of request shape — even with a payload verified against TrueLayer's own published OpenAPI spec. TrueLayer support couldn't resolve it, and it turned out TrueLayer's production access isn't actually free for a hobby project (no self-serve free tier, despite some marketing suggesting otherwise).
3. Surveyed the remaining market: GoCardless Bank Account Data (formerly Nordigen) — closed to new signups since mid-2025 and being wound down. Plaid, Yapily, Tink — all sales-gated for UK/EU production access, no self-serve free tier. Salt Edge — doesn't support PSD2 access for personal (non-business) use.
4. Checked whether a UK bank (e.g. Lloyds) could be integrated directly — technically yes, they run Open Banking developer portals, but registration requires being listed on the Open Banking Directory as an FCA-authorised AISP (or an agent of one). This is a regulatory registration, not a signup form, and isn't available to an individual/hobby project.

**Decision:** Remove all bank-sync code, infrastructure, and planning docs, and go back to manual transaction entry. Every actively-maintained open-source personal finance project (Actual Budget, Firefly III) is in the same position as of September 2026 and falls back to manual/CSV import as their reliable baseline.

**Why:** There is currently no free, self-serve, ToS-compliant way for an individual to pull live UK bank transaction data. Continuing to chase provider integrations was consuming significant effort for a feature that was blocked at the regulatory/commercial level, not a technical one.

**How to revisit this:** If a UK-capable free aggregator appears, or TrueLayer/another provider opens genuine self-serve production access, or the user personally becomes an AISP agent, bank sync could be rebuilt. A manual CSV/OFX import feature (à la Actual Budget/Firefly III) would be a reasonable middle ground if that's wanted before then — it requires no regulatory status and works with every bank's existing statement export.
