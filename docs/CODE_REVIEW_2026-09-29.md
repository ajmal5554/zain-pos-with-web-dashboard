# Zain POS — code quality and shop operations review

Review date: 29 September 2026. Reviewed the current working tree, including existing uncommitted changes.

**Overall assessment**

This is a substantial custom POS with useful shop-specific functionality. The main concern is trustworthiness of money, stock, permissions, and synchronization under unusual conditions. Adding more screens should come after stabilizing those foundations. An incremental repair is more appropriate than a complete rewrite.

| Area | Assessment |
| --- | --- |
| Feature coverage | Broad: billing, variants/barcodes, split payments, exchanges/refunds, reports, printing, users, backup, cloud dashboard |
| Code organization | Needs improvement; large files and duplicated business rules make fixes difficult to keep consistent |
| Transaction correctness | High-priority problems in validation, returns, payment edits, and report reconciliation |
| Security | High-priority boundary problems despite useful permission infrastructure |
| Synchronization | Vulnerable to missed changes, stale overwrites, and false success |
| Performance | Reasonable starting point for one shop, but several queries and screens grow with the entire dataset |
| Verification | Desktop/API type checks pass; dashboard type check and lint fail; automated business regression coverage is insufficient |

This assessment is qualitative, not a benchmark score.

**Scope and evidence**

The review covered the architecture and primary workflows across `src`, `electron`, both Prisma schemas, `zain-pos-api/src`, `zain-pos-dashboard/src`, and build/verification configuration. Detailed tracing focused on checkout, edits, refunds, exchanges, permissions, synchronization, reports, inventory, backups, and printing. Generated Prisma files, dependency trees, extracted application copies, old logs, and imported shop data were not treated as authoritative application source. This is a broad source review, not a claim that every line or possible runtime path has been exhaustively tested.

No application logic was changed. No live database, cloud endpoint, printer, scanner, or payment service was exercised. Findings marked as risks are inferred from the code; they are not claims that damage has already occurred. Legal tax compliance and installed dependency vulnerability status were not audited.

| Check run | Result |
| --- | --- |
| Root `npm run typecheck` | Passed |
| `node scripts/release-smoke-check.js` | Passed; checks file/configuration presence, not shop transactions |
| API TypeScript check, `tsc --noEmit -p tsconfig.json` | Passed |
| Dashboard TypeScript check, `tsc --noEmit -p tsconfig.app.json` | Failed: `src/pages/Reports.tsx:309`, optional `grandTotal` passed to formatter requiring a number |
| Dashboard `npm run lint` | Failed before linting: ESLint 8.57.1 cannot import `eslint/config` used by the configuration |
| Isolated execution of actual checkout validator | Accepted a ₹1,000 item with a ₹1 bill total; also accepted quantity 0.5 |

The validator was extracted from the source, transpiled, and executed in an isolated JavaScript context with synthetic data. No checkout transaction was executed. Packaging, browser interaction, performance load testing, and restore drills remain unverified.

**What is already good**

- SQLite supports billing without depending on the cloud connection.
- Checkout, exchange, refund, and void operations use database transactions for related local writes.
- Sale items snapshot product names and selling prices, preserving some history after catalog changes.
- Split payments have their own records; returns and exchanges also have separate records.
- Void handling checks for existing returns/exchanges and records stock movements.
- There is a centralized permission service and a constrained preload API. The main window enables context isolation and disables Node integration.
- Sync endpoints require a configured secret and use a timing-safe comparison.
- Backup retention, pre-restore backups, error boundaries, audit records, and explicit demo mode show attention to real operational needs.
- Several cloud sales endpoints already use aggregation/pagination rather than always returning all rows.

**Priority 1 — repair money, stock, and access boundaries first**

**1. Customer data has an unauthenticated API route. Confirmed.**

`zain-pos-api/src/routes/customers.ts:8` exposes the customer list without authentication middleware. `zain-pos-api/src/index.ts` mounts it directly. The response returns complete customer rows, potentially including phone, email, address, and GSTIN. Anyone able to reach that deployment can request the route; deployment reachability was not tested.

Fix: authenticate the router, authorize customer access, minimize returned fields, and cap pagination. Add a test that unauthenticated access returns 401.

**2. Desktop permissions trust a user ID supplied by the caller. Confirmed.**

`electron/main.ts:138` obtains identity from IPC arguments and looks up that user's permissions. `auth:login` returns user data but does not establish an authoritative main-process session. `users:listForLogin` also exposes user IDs and roles. A renderer caller can claim another identity; knowing an admin ID must never be equivalent to proving admin login.

Several powerful handlers, including import/export, backup/restore, and sync configuration, use direct `ipcMain.handle` registrations without the permission wrapper. UI route protection does not secure those IPC calls.

Fix: bind authenticated identity to the main-process session and approved sender, derive actors internally, and authorize every privileged operation. Electron specifically recommends validating IPC senders; see [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

**3. Settings access can disclose the cloud synchronization secret. Confirmed.**

`electron/main.ts:1721` registers `settings:get` with unconditional permission approval and accepts arbitrary keys. `loadCloudSyncSecret` reads `CLOUD_SYNC_SECRET` from that same table. The preload exposes this getter. Consequently, the application boundary does not distinguish public display settings from privileged secrets.

Fix: allowlist public keys, keep credentials outside renderer-readable settings, and restrict cloud configuration. Review secret rotation after exposure assessment; do not assume this source finding proves a leak occurred.

**4. Checkout does not establish authoritative totals or enforce stock availability. Confirmed.**

`electron/main.ts:193` validates some amounts and payment equality, but never proves that line totals add up to the bill. `sales:checkout` at line 1789 persists caller-supplied subtotal, grand total, item price, item tax, and item total. It decrements stock without a sufficient-stock condition or active-product check. Integer quantities are not validated at this boundary.

The actual validator accepted a line priced at ₹1,000 while the bill and payment were ₹1. A fractional quantity also passed validation; the database may reject it later because the schema uses integer quantities.

Fix: load authoritative product details, validate allowed overrides, aggregate duplicate variants, calculate all totals internally, and perform a conditional stock decrement in the transaction. If negative stock is intentionally allowed for migration or backorders, make it an explicit manager-controlled exception with a reason.

**5. Discounts can produce refunds or exchange credits greater than the customer paid. Confirmed behavior; policy needs definition.**

`electron/main.ts:2513` computes exchange credit using the original selling price before discounts. The refund handler around line 3118 does the same. A ₹1,000 item sold for ₹900 can receive ₹1,000 of refund or exchange value. This behavior also exists in the Sales UI, so it is not merely a malformed-request scenario.

Fix: normally refund the allocated net amount paid after line and bill discounts. If full-price exchange credit is an intentional shop policy, label it separately, require appropriate approval, and record the extra concession. The existing `getSaleItemNetUnitPrice` helper is a starting point, but rounding and partial returns need tests.

**6. Return quantity checks are incomplete. Confirmed at the transaction boundary.**

`sales:refund` at `electron/main.ts:3065` loads previous refunds but not previous exchanges. It can refund a unit already surrendered in an exchange. The UI subtracts both, which helps ordinary clicks, but the authoritative handler does not. Duplicate entries for one variant in a single refund or exchange are also validated independently against the same available quantity.

Fix: identify returns by original sale-line ID, aggregate requested quantities, subtract all previous refunds/exchanges, and enforce the remaining quantity inside the transaction. Test repeated, duplicated, stale-screen, and simultaneous requests.

**7. Completed-sale edits can undermine return/void history. Confirmed missing guards.**

`electron/main.ts:2087` checks an edit permission but does not reject voided sales or sales with returns/exchanges. It replaces all original sale items and changes stock using quantity differences. This can change the basis of an existing refund or adjust stock on an invoice whose stock was already restored. It also does not repeat the checkout discount-limit check or check that the actor is active.

Fix: define permitted state transitions explicitly. Block editing after void/return/exchange, or use linked adjustment records. Preserve original issued invoices and line IDs. Keep draft editing separate from finalized-sale adjustments.

**8. Payment edits bypass the payment invariants used during checkout. Confirmed.**

`electron/main.ts:1928` replaces payment rows and paid/change amounts without checking that modes are valid, amounts are nonnegative, or their sum matches the payable amount. Exchange credit also requires preservation as a separate funding source.

Fix: share one payment validation routine between checkout and payment changes, distinguish tendered cash from applied payment, and reject invalid state changes. A permission to change payment mode should not imply permission to change how much the shop collected.

**9. Reports disagree about sales, returns, exchange credit, and dates. Confirmed.**

- `src/services/reports.service.ts:38` subtracts exchange credit from daily sales, but does not subtract refunds and still adds the full tax of replacement bills.
- `zain-pos-api/src/routes/sales.ts:89` sums completed sale grand totals without refund or exchange-credit adjustment. An original ₹1,000 bill followed by an equal-value replacement can total ₹2,000 here while the desktop collection calculation remains ₹1,000.
- The cloud GST route does not load refund records.
- `src/pages/Reports.tsx:822` selects invoices by `createdAt` and loads their refunds without a refund-date cutoff. A later refund can change an earlier report, while a refund today against an older invoice may be absent from today's invoice selection.
- Cloud daily grouping uses UTC date strings, whereas desktop date-fns calculations use the PC's local day; cloud hourly reporting separately applies an offset.

Fix: define gross sales, net sales, receipts, refunds, tax, and exchange credit separately. Generate reports from shared transaction events with explicit event dates and the shop timezone. Decide whether historical views are original-period or restated views, and label them. Reconcile every screen/export against the same fixtures.

**10. Tax calculations are inconsistent with the configurable product tax rates. Confirmed arithmetic problem.**

Checkout and replacement invoice totals use a fixed divisor of 1.05, while line items carry configurable tax rates. Bill discounts reduce header tax but are not allocated into the stored line taxes. Independently rounding both halves can also produce a one-paisa mismatch with total tax.

In `zain-pos-api/src/routes/reports.ts:224`, `taxableValue` is computed as subtotal minus discount although this application's sale amounts are tax-inclusive. For a synthetic ₹105 invoice at 5%, the expected tax-exclusive base is ₹100, while this expression gives ₹105.

Fix: use one deterministic per-line calculation with discount allocation and explicit rounding residuals. Store consistent gross, net, tax-exclusive base, and tax values. These are internal arithmetic findings, not an assessment of which statutory tax rate applies to your products.

**11. Disabled cloud users can retain access, and read permissions are incomplete. Confirmed.**

`zain-pos-api/src/routes/auth.ts` issues 365-day tokens. `middleware/auth.ts` verifies the signature but does not check current account status. Admin/product mutation guards fetch users but do not check `isActive`. Sales, reports, activity, and invoice read routes generally require only a token, not their corresponding permission flags. `/inventory/products/manage` returns variants including cost prices without a cost-price permission check. The web auth context contains no permission flags.

Fix: enforce active status and permissions server-side, use a revocable session/token strategy, and return only permitted fields. Apply equivalent checks to live socket subscriptions. Add login rate limiting; none was found in the application authentication path.

**Priority 2 — make synchronization and recovery dependable**

**12. Some local changes are never marked for synchronization. Confirmed.**

Product edits and soft deletion in `src/pages/Products.tsx:153` and `:311` do not set `isSynced: false`. The generic database handler triggers a sync but does not mark records dirty. `verifyAndSync` selects only unsynced products/variants. Refund restocking also increments variant stock without marking it unsynced. Previously synchronized records can therefore remain stale in the cloud.

Fix: write a sync event in the same transaction as every domain change, including deletions, stock adjustments, customer edits, and refunds. At minimum, centralize dirty marking; do not rely on each screen remembering it.

**13. Sync can mark skipped or newer records as successfully uploaded. Confirmed design flaws.**

`zain-pos-api/src/routes/sync.ts:1075` can skip refunds whose parent invoice is missing and still return HTTP 200 with a `skipped` list. Exchange sync follows the same pattern. Desktop realtime/batch paths mark submitted records synced without inspecting per-record acceptance.

In `electron/sync.service.ts:326`, products and variants are marked synced by ID after the network request. A stock change made while the request is in flight can be marked synced even though the uploaded snapshot predates it.

The offline queue stores snapshots. `drainQueueInternal` uploads those old snapshots, marks current rows synced, and deletes queued records. An old queued sale can overwrite a newer local edit in the cloud without the newer version being selected afterward.

Fix: acknowledgments must contain accepted IDs and versions. Mark only that acknowledged version clean; leave later changes pending. Queue entity/version references or immutable events, enforce version ordering, and retry only failed records with visible errors and backoff.

**14. Cloud invoice replacement is not atomic. Confirmed.**

`zain-pos-api/src/routes/sync.ts:320` upserts a sale while deleting its children, then recreates items/payments in separate database operations. A failure after deletion leaves the cloud invoice incomplete. Concurrent deliveries can interleave. Refund/exchange synchronization similarly deletes and recreates children across separate writes.

Fix: use a transaction per complete aggregate, reject stale versions, and make retries idempotent. Emit notifications only after a successful commit.

**15. Cloud editing and desktop ownership conflict. Confirmed architecture gap.**

The API supports catalog, user, and settings edits. The desktop sync implementation uploads records and reads sync status; no corresponding inbound application-data pull was found. Cloud-created products will not automatically appear in the shop POS, and desktop uploads can overwrite cloud edits. `syncUsers` and `syncSettings` methods exist without callers in the Electron source reviewed. Routine `verifyAndSync` also omits customers and inventory movements, although bulk sync handles them.

Fix: select an explicit owner for each data type. The simplest immediate option is desktop-owned catalog/stock with a read-only web dashboard. If web editing is needed, add an authenticated command/download flow with version conflicts and acknowledgment. Report status by entity and backlog, rather than claiming everything is synchronized from partial batches.

**16. Backup verification can report success without validating the result. Confirmed; copying has additional concurrency risk.**

`electron/main.ts:356` runs `PRAGMA integrity_check` but ignores its rows. SQLite reports integrity failures in returned rows; absence of an exception does not mean the result is `ok`. See [SQLite integrity checks](https://sqlite.org/pragma.html#pragma_integrity_check).

Backups copy the live database and WAL as separate filesystem operations. Automatic backup can start from inside checkout before commit and there is no consistent snapshot boundary covering those copies. This is a recovery risk, not proof that existing backups are corrupt. The freshness check only looks for sales in the last hour and does not compare the backup with the source; a quiet shop can be flagged as stale.

Fix: create a consistent SQLite snapshot, inspect integrity results and required schema, record row counts/latest committed transaction, and perform isolated restore drills. SQLite documents the [online backup API and VACUUM INTO](https://sqlite.org/backup.html) for live snapshots. Keep at least one verified copy on another device/location, with controlled access and retention.

**Priority 3 — improve maintainability, performance, and daily usability**

**17. Product editing bypasses an inventory ledger and can partially save. Confirmed.**

The product screen writes the product and each variant through separate IPC calls. A failed variant write can leave earlier writes committed. Stock is overwritten directly without a corresponding adjustment movement, reason, or before/after quantity. The edit form initializes only `product.variants[0]` around `src/pages/Products.tsx:478`, despite the schema supporting multiple size/color variants.

Fix: use one transactional product-edit command, preserve stable variant IDs, expose every variant, and separate stock adjustments from descriptive product edits. Record opening stock, receiving, damage, stocktake corrections, sales, and returns consistently.

**18. The generic database bridge is too broad. Confirmed.**

`db:secureQuery` forwards caller-controlled Prisma arguments after checking only the top-level model/method. Nested writes and relation includes do not receive equivalent domain-specific checks. Product reads can expose costs; permissive reads can include related data. `invoicePayment` appears in the permission matrix and renderer database service but is absent from the handler's allowed-model list, making those methods fail if used.

Fix: replace generic database access with typed operations such as search products, adjust stock, create sale, and get report. Allowlist both inputs and output fields and test nested access paths during transition.

**19. Large modules and duplicated rules raise regression risk. Confirmed.**

At review time, `electron/main.ts` has 5,066 lines, desktop Sales 2,326, Reports 1,980, and POS 1,645. Financial calculations and report transformations appear in multiple screens/services across desktop and cloud. Widespread `any` use, including the primary database client, limits the protection supplied by TypeScript.

Fix incrementally: extract pure money/tax functions first, then transaction services, authorization, synchronization, backup, printing, and migrations. Share domain types and calculations between apps while retaining platform-specific UI. Do not begin with a large cosmetic folder reshuffle.

**20. Data loading will become expensive as history grows. Observed patterns; no benchmark performed.**

The product screen returns all matches and sorts locally. POS loads active variants. Low-stock reporting loads variants to filter locally. Desktop forecasting loads sales plus products; dashboard week/year views perform multiple period queries. Many API modules instantiate separate Prisma clients. Both app roots eagerly import the major pages.

Fix in order: measure checkout/search latency on a realistic data copy; add bounded product search and list pagination; aggregate reports in the database; consolidate API clients; add route-level lazy loading; examine query plans before adding indexes. Review cloud movement/audit indexes and frequently joined foreign keys, which are less comprehensively indexed than local equivalents. Virtualize large tables only where measurements justify it.

**21. Money representation and historical snapshots need strengthening. Confirmed schema limitations.**

Both schemas use `Float` throughout monetary fields. SaleItem snapshots selling price but not cost price or HSN. Current product costs cannot reliably reconstruct historical gross margin, and the desktop report reads HSN through the current product relation. Customer references on sales are name/phone snapshots without a stable customer ID.

Fix: use integer paise or an explicit decimal strategy, migrate with reconciliation, and snapshot cost/tax metadata needed for historical reporting. Keep both stable customer identity and invoice-time display details. Define whether cost means last purchase cost or another valuation policy before adding profit dashboards.

**22. Receipt text is interpolated into HTML without escaping. Confirmed; browser impact depends on rendering context.**

Both print services insert customer names and product/template text into HTML strings, for example desktop `src/services/print.service.ts:163`. A name containing markup can alter the receipt or execute markup where the consuming preview permits it.

Fix: escape ordinary data, validate URLs/styles separately, and isolate intentional rich templates. Test long names, ampersands, angle brackets, multiline addresses, zero-price items, split payments, printer disconnection, and paper widths. Keep printing retryable independently of recording a sale.

**23. Build and deployment verification are incomplete. Confirmed.**

Resolve the dashboard type error and align ESLint/configuration/plugin versions. Root smoke tests check presence rather than behavior. No conventional application unit/integration test suite or GitHub CI configuration was found in the reviewed source. API `postinstall` runs `prisma db push`, coupling dependency installation to database schema modification. Electron includes `prisma/**/*` and a local database in packaging inputs; historical backups and generated temporary binaries are tracked in Git.

Fix: introduce explicit versioned migrations and a release pipeline, narrow packaged resources, generate clean seed data rather than shipping a working shop database, and review repository access/history before removing tracked backup artifacts. Use one chosen lockfile per package. Review/update runtime dependencies separately with an actual vulnerability audit; this review did not establish specific CVEs.

**24. Forecasts are not consistent across apps. Confirmed model difference.**

Desktop forecasting includes a damped model and backtesting; the web screen uses a recent weighted average plus a simple trend. Web monthly grouping omits zero-sale months and includes the current partial month. This can distort comparisons and make the two devices show different expectations.

Fix: use one definition of input revenue, explicitly handle missing/partial months, share the model, and show backtest error and data coverage. Forecasts should inform purchasing, not automatically order stock. Avoid implying certainty from an AI-style label.

**25. Repeated requests need business-level duplicate protection. Design risk.**

The POS disables save buttons while processing, which is useful. However, checkout has no persisted client request ID. If a save succeeds but its response is lost or the app crashes before updating its local session, retrying can create another invoice and reduce stock again.

Fix: persist a checkout request ID before submission, enforce uniqueness in the transaction, and return the previously created sale on retry. Apply equivalent protection to refunds and exchanges.

**Feature gaps ranked for a clothing shop**

These are capabilities absent or incomplete in the reviewed models/workflows, not assertions about external systems you may already use.

| Priority | Feature | Practical benefit |
| --- | --- | --- |
| High | Shift opening/closing, opening cash, cash in/out, counted cash, variance, manager sign-off | Explains why the drawer differs from sales totals |
| High | Purchase receiving and supplier invoices/returns | Adds stock with provenance and tracks amounts owed to suppliers |
| High | Stocktake sessions and damaged/non-resellable returns | Prevents every customer return automatically increasing sellable stock |
| High | Real store-credit ledger and redemption | Exchange code currently records a credit balance in remarks/audit, without a dedicated balance/redemption model |
| High | Per-entity sync health and tested recovery workflow | Makes missing data and backup failures visible before a crisis |
| High | Full size/color variant editor and variant-level reorder thresholds | Supports actual clothing inventory rather than only the first variant |
| Medium | UPI/card reconciliation and payment references | A cashier choosing UPI is not confirmation that money arrived; retain provider/bank reference and settlement status |
| Medium | Multiple held carts and controlled cashier handover | Handles interruptions and several customers without sharing one anonymous persisted cart |
| Medium | Stable customer history, consent, and return-policy tracking | Improves repeat-customer service and consistent returns |
| Medium | Expenses and historical cost snapshots | Enables meaningful gross margin; net profit additionally needs expenses and other costs |
| Later | Loyalty, promotions, purchase suggestions | Useful once core records reconcile reliably |
| Conditional | Multi-terminal/multi-shop support | Requires explicit store/device identity, invoice allocation, stock ownership, and conflicts; do not assume current upload sync supplies this |

The web `pages/POS.tsx` is a feature-description placeholder and is not registered as a checkout route in `App.tsx`. The current web app should be described as a dashboard/management interface, not a fully working browser POS.

**Recommended repair order**

1. Close unauthenticated customer access and desktop identity/secret exposure. Enforce active accounts and permissions on API/IPC boundaries.
2. Establish one tested money calculation and transaction validation layer. Fix return quantities, discount allocation, payment editing, and sale-state transitions.
3. Define reporting metrics and dates. Reconcile desktop, cloud, receipts, and exports with a small golden dataset.
4. Fix dirty tracking, per-record acknowledgments, version ordering, and atomic cloud writes. Decide whether web changes are supported or desktop-owned data is read-only there.
5. Implement consistent backup snapshots and rehearse recovery on an isolated database copy.
6. Repair dashboard tooling and establish business regression tests and a release gate.
7. Refactor large files incrementally, measure performance, then add shift closing, receiving, stocktake, and usable store credit.

**Minimum business regression scenarios before relying on a release**

| Scenario | Required result |
| --- | --- |
| ₹1,000 item, ₹100 discount, full refund | Refund is ₹900 unless an explicitly approved concession applies |
| Mixed tax rates plus bill discount | Line totals, tax slabs, invoice, and export agree to the defined rounding unit |
| Last unit sold, repeated checkout request | One invoice; stock reduced exactly once |
| Refund after exchange; duplicate return lines | Never return/refund more than the remaining purchased quantity |
| Edit a voided or previously returned invoice | Rejected or handled through an explicit adjustment workflow |
| Change cash to split payment | Applied payments reconcile to the payable total; exchange credit remains intact |
| Lose network, edit sale, reconnect | Cloud ends with the latest version and no stale queue overwrite |
| Cloud skips a refund with a missing invoice | Refund remains pending until its dependency is accepted |
| Product changes while upload is in flight | Newer change remains pending and is subsequently uploaded |
| Yesterday's sale refunded today | Both periods follow the documented transaction-date policy across all reports |
| Sale near local midnight | Same shop day on desktop, web, charts, and exports |
| Disable a logged-in user | Further protected requests fail, including active socket access as designed |
| Restore a backup after simulated write activity | Integrity/schema checks pass and committed invoices, payments, and stock reconcile |
| Printer fails after saving | Sale remains saved and can be reprinted without a duplicate checkout |

The best next investment is a dependable transaction and reconciliation core. Once money, stock, permissions, sync, and restore behavior are consistent, the existing feature set can become a strong foundation for daily shop use.
