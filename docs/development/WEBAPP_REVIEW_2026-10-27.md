# Web application review — 27 October 2026

Scope: `zain-pos-dashboard` React/PWA, `zain-pos-api` Express/Prisma, and their relationship to the desktop POS. This is a source review and local verification, not a deployed-system penetration test or a completed phone usability study. No production database, deployment, or shop data was changed.

## Purpose to preserve

The web dashboard is currently for monitoring the shop. Preserve sales forecasting for 1–6 upcoming months, restocking directions, season planning, and comparisons. Mobile billing during a shop-PC outage is a future capability requiring a separate synchronization design; a responsive dashboard does not provide it automatically.

## Confirmed findings and fixes in 3.0.43

| Priority | Finding and effect | Change |
|---|---|---|
| Critical | Customer routes had no authentication middleware: customer records could be read or changed without a dashboard session. | Added active-account authentication to the entire router. |
| Critical | Maintenance routes used a known fallback secret if configuration was missing. | Fail closed with 503 unless an explicit maintenance secret is configured. Existing explicitly configured access is preserved. |
| High | JWT verification did not check whether the account still existed or was active. | Each API request checks the current account. New Socket.IO connections check it too. Existing open sockets are a remaining limitation. |
| High | Dashboard request failures were converted to zero totals/empty lists, potentially presenting an outage as no business. | Failed requests show an explicit error with Retry; no synthetic zero summary. One failed panel currently blocks the dashboard rather than presenting mixed data. |
| High | Rapid filter changes could allow an older dashboard request to overwrite a newer period. | Request generation guard and effect cleanup reject stale results. |
| Medium | All Time changed to null bounds, but the dashboard effect refused to fetch null ranges. | All Time requests now run. |
| Medium | Top products were all-time, including non-completed sales, beside period-filtered sales totals. | Pass the selected dates and restrict aggregation to completed sales. This is still sold quantity before returns, not net demand. |
| Medium | Daily buckets used UTC and were not explicitly date-sorted. Early-morning India sales could appear on the previous day. | India calendar-date grouping and chronological sorting. Hourly dashboard requests use the shop's India offset. Other endpoints still need a common date helper. |
| Medium | Stock endpoint omitted barcode and minStock consumed by the UI. Barcode search and low-stock metrics were incomplete. | Supply barcode, threshold and updated timestamp; low-stock results exclude inactive parent products. |
| Medium | Inventory errors silently left empty/old values without an error. | Error banner and Retry; headline metrics hidden on error. |
| Medium | Reports ignored the shared date range and had no rejection handler, leaving an endless loading view. | Pass date filters including explicit All Time; show Retry and guard stale requests. |
| Medium | Sales revenue/average cards sum only the currently loaded page, beside a full result count. | Explicitly label both values as current-page bill values. Period-wide totals remain a future enhancement. |
| Medium | Cloud customer create/update submitted `isSynced`, which is absent from the cloud Prisma schema. | Remove the unsupported field; no schema change. This does not solve bidirectional customer sync. |
| Low | Two Toaster instances could render duplicate messages. | Keep the app-level instance only. |
| Low | A 401 from the login form triggered a full reload, while expired-session cleanup left saved user data behind. | Login failures remain on the form; session expiry clears token and saved user and replaces the route. Add a 30-second request timeout. |
| Low | Unknown URLs rendered an empty route. | Redirect to the home route through existing authentication. |

## Remaining issues, ordered by impact

### 1. Permission enforcement is incomplete

Sales, reports, invoices and activity routers generally require login but do not enforce their desktop-equivalent view permissions. Navigation exposes all destinations. Inventory management GET returns full variant data including costs, while the write routes have separate permission checks. Audit every read and mutation against a shared permission matrix. Return only allowed fields; hiding a menu is insufficient. Retain owner monitoring access and show an explicit access-denied page for staff.

Evidence: API `routes/sales.ts`, `reports.ts`, `invoices.ts`, `activity.ts`, `inventory.ts`; dashboard `components/layout/navigation.ts` and `App.tsx`.

### 2. Financial definitions differ between web and desktop

Web sales summary adds completed bill grand totals. Web GST scales replacement bills by fresh payment and skips zero-fresh-payment exchanges. Neither is equivalent to the desktop's structured exchange-credit reconciliation. This can produce conflicting sales, cash collection and tax figures. Do not call fresh collections revenue, and do not patch historical financial records by guessing. Port a reconciled reporting contract with separate billed value, return/exchange adjustments, fresh collections and unresolved records. Validate with the accountant's report examples before relying on the web GST export.

The current fixes deliberately do not rewrite GST accounting. This review describes code behavior, not tax advice.

### 3. Web forecasting is still an older implementation

`pages/Forecasting.tsx` produces four months, aggregates only present months, includes the current partial month and uses a weighted average plus unrestricted linear trend. Forecast dates start after the last observed month, so stale history can produce projections that are already in the past. It lacks the desktop's validation, basis labels, planning ranges, restocking directions, season reminders and year comparisons. The “AI” badge overstates a simple deterministic calculation.

Next implementation should reuse a tested, platform-neutral forecast engine and a cloud data contract. Preserve the user-approved full scope; do not replace it with short-term insights. Exclude partial months from complete-month training, preserve zero calendar months, distinguish no observations from zero trade and anchor forecasts to the current shop month. Label billed versus reconciled net basis explicitly.

### 4. Stock does not match the audited-stock workflow

Cloud inventory flattens active variants and uses every stock balance as if reliable. Generic “Shirt 700” legacy counts are mixed with genuinely audited stock. Negative legacy counts can inflate “out of stock” alarms and reduce valuation. The dashboard has no synced audited/prepared status, custom category-attribute workflow, audit import review or batch/FIFO views. Its value is selling-price value, not purchase-cost inventory value or profit.

Keep this page monitoring-first: show audited stock separately, show the last shop synchronization time, label selling-price valuation, and withhold reorder quantities for uncounted/insufficient-history entries. Do not duplicate the entire desktop stock-entry workflow without a conflict policy.

### 5. Web writes and desktop sync can conflict

The dashboard supports product/customer/user/settings writes while desktop sync also updates cloud copies. Cloud customer fields do not include the desktop's local sync flag. The review has not established a supported reverse sync for all these writes. A web edit can appear successful yet never reach the shop PC, or be overwritten by a later desktop sync. Define the authority for each entity and show pending/confirmed status; do not promise live shop edits until round-trip tests prove them.

### 6. Session and maintenance hardening remains

Tokens last 365 days and are held in localStorage; login still supports legacy plaintext-password upgrading. There is no visible login rate limiter. Account deactivation now stops REST and new sockets but does not immediately disconnect existing sockets. Stored user identity is trusted for initial rendering until the API checks it. Add `/auth/me` session restoration, token expiry/refresh policy, credential-change revocation and live-connection revocation. Protect maintenance with separate explicit credentials and audit; never invoke reset during testing. API installation has a `postinstall` database-push command: separate install/build from production migrations before deployment automation.

### 7. Mobile and accessibility review is still needed in a running browser

Source shows fixed bottom navigation, small text, several icon-only actions without accessible names, repeated header/date controls and wide dense tables. Test 320/360/390/768px widths, keyboard-only navigation, focus restoration in modals, touch targets, zoom, long product names and visible loading/error states. Avoid replacing the current design wholesale. Prioritize one clear date-range control, readable currency, table overflow and named actions. Unknown routes are now handled; route-level render error boundaries are still absent.

### 8. Reports and data loading need consolidation

Pages duplicate formatting, demo fixtures, fetch logic and date handling. Demo fixtures use fixed historical periods and can contradict the chosen filter. Sales detail loading and other pages still need stale-response guards. Invoice paging parameters are not bounded. Some report endpoints parse invalid dates without a clear 400 response. Daily trends omit zero days. Build a shared typed query contract with bounds, consistent India dates, cancellation, empty-versus-error semantics and paginated exports.

### 9. Performance and offline expectations

All pages are imported eagerly in `App.tsx`, including charts and management screens. Inventory fetches full product lists and filters on the client. Realtime dashboard updates refetch five endpoints. Introduce route-level lazy loading and bounded server queries after correctness checks. The PWA precaches shell assets but does not provide offline transaction persistence, conflict resolution or safe multi-device bill numbering. Do not market outage billing as ready.

### 10. Missing business views

Web has no equivalent verified purchase/supplier-credit/expense/profit reporting contract for the recently added desktop features. First sync the required immutable transaction snapshots and batch costs, then expose monitoring pages. Missing costs, provisional GST/ITC treatment and unreconciled exchanges must remain visible instead of being treated as zero cost or guaranteed profit.

## Recommended implementation order

1. Complete API permission/field filtering and sync-authority decisions; reconcile web totals against desktop fixtures.
2. Unify forecast calculations and restore all approved planning capabilities on the web.
3. Make Stock an accurate audited-inventory monitoring view with freshness and legacy distinctions.
4. Add purchase, supplier balance, expense and profit monitoring from verified synchronized records.
5. Finish phone/keyboard/accessibility testing and measured performance improvements.
6. Design mobile offline billing separately with idempotency and bill-number allocation before implementation.

## Verification

Regression tests in `scripts/webapp-review.test.cjs` exercise actual transpiled auth middleware with missing/invalid/inactive/deleted/valid accounts and database failures; dashboard service tests date forwarding and rejecting failures instead of zero fallback. API and dashboard TypeScript checks and a dashboard production build are run locally. No maintenance/reset operation, real cloud request or database write is part of these tests. Browser visual validation and deployed integration tests remain outstanding.
