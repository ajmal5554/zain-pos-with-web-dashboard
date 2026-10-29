# Zain POS: development contract and page roadmap

Prepared: 8 October 2026. Inventory implementation status updated: 14 October 2026. Audience: the shop owner and Antigravity/Gemini implementing this repository.

Current UI decision (3.0.19): Stock has only **Inventory** and **Excel upload**. The old catalogue stays in Products/POS. Unfinished counts and labels are accessible through a button under Excel upload; the earlier multi-tab navigation is superseded. See [INVENTORY_WORKSPACE.md](INVENTORY_WORKSPACE.md).

This is a proposed implementation specification, not a claim that these features already exist or that existing bugs have been fixed. A prompt cannot guarantee zero bugs. Small changes, explicit business rules, meaningful tests, and review make failures easier to prevent and detect.

## How to use this pack

1. Give the implementing agent this document and the relevant page PRD.
2. Run one named milestone at a time. ST-01, ST-02 and ST-03A remain implemented. Version 3.0.18 adds the owner's approved Inventory / Audit & relabelling / Old billing items workspace, reviewed Excel-to-style preparation, batch activation, tracked-only oversale blocking, basic reasoned stock corrections and legacy-return stock routing. See [INVENTORY_WORKSPACE.md](INVENTORY_WORKSPACE.md) for the current workflow and shop checks. Historical prompts describe their original scope, not instructions to rebuild or undo newer work. Portable laptop-to-shop transfer and generic-code retirement remain separate work.
3. Require a short source assessment and an implementation plan, then implementation and verification of that milestone. Routine choices can be made without repeatedly asking the owner for permission.
4. Ask the owner only about material business choices that the documents do not settle. Do not silently invent them.
5. Review the actual changed code and acceptance results before starting the next milestone. A good screenshot is not evidence that quantities or accounts reconcile.
6. Keep a completion note listing changed files, checks actually run, unresolved issues, and a simple shop-owner test. Do not claim unavailable checks passed.

The owner can request a different order. Necessary data dependencies still apply; a page must identify missing data instead of fabricating results.

## Shop facts and decisions to preserve

- One B2C clothing shop. No multi-branch system or customer-credit accounting is requested.
- The shop PC bills throughout the day and can lose electricity. Core local work must not require an internet connection.
- Development and testing occur on a personal laptop. The owner builds an EXE installer for the shop PC. The live shop database is authoritative for sales and money.
- Opening inventory has never been fully counted. Existing negative balances do not prove physical shortages.
- Products already exists and owns the catalogue. A Stock page must reuse it rather than build a competing catalogue.
- Stock dimensions include size, brand, fabric, quality and design, such as checks/plain/print; sleeve, fit, collar and pocket are also present in the owner's partial audit. Attributes can vary by category; the final list is not settled. Colour tracking must not be required.
- One stable variant ID and unique barcode identify a sellable combination. Identical pieces share that barcode. Changing a price must not change the identity.
- Familiar names may repeat, with readable attributes distinguishing variants. New records can use `Shirt` with price separately; preserve existing literal names such as `Shirt 700`. The physical sticker is 32 × 18 mm. ST-02A's presentation/category/short-code changes are deferred; existing stable identities and codes suffice for count drafts. Real activation still requires accurate physical identification and usable labels.
- The owner has a partial shirt audit taken over several days. Seven later shirt sales lack specifications; they cannot safely be assigned to individual audit rows or assumed to come from the audited subset. Preserve the sheet as a dated reference and freshly count pieces when converting them.
- Convert small physical batches while the shop stays open. Temporarily hold just the pieces being identified, counted and relabelled; commit that batch on the shop PC before putting them back on sale. There is no requirement to finish an entire price group or the whole shop in one day.
- Old generic barcodes and new specific barcodes coexist during conversion. An old code such as Shirt 700 stays usable while any pieces still carry that label. Converted pieces must use their new code; never map a shared old code automatically to one guessed new variant.
- Verified stock covers only committed, newly labelled pieces during conversion. Keep legacy quantities separate and visibly unverified. Do not present a partial count as the whole shop's stock or availability.
- Notebook entry on the shop PC is supported. Portable laptop-prepared catalogue/count transfer is optional ST-05 work; an installer does not transfer the laptop catalogue or counts.
- Cash, UPI and split payment are in use. Cards are disabled by settings. Do not enable them as part of these pages.
- Discounts are applied to the whole bill. Do not force item-level discount entry or add extra steps to routine billing.
- Exchange credit intentionally uses the original full selling price before discounts. Preserve this shop policy. Do not assume a field called MRP always equals the sale's original selling-price snapshot.
- Cash refunds use actual eligible payment, with existing manual original-discount confirmation for ambiguous partial returns. Preserve the existing caps and return-quantity checks.
- Normal saved POS bills remain editable until the cashier starts a new sale. Keep existing blocks for bills already refunded, exchanged or voided. Do not redesign this workflow in an inventory/reporting task.
- Cash Register already exists. Reuse its records and preserve the removal of Add Cash In. Do not introduce another competing drawer balance.
- Taking cash home is an owner withdrawal. Opening float is carried cash, not sales income.
- Purchase invoices and supplier balances are not currently maintained in this app. Customer collection/WhatsApp, mobile billing, forecasting and promotion advice are later projects.

See `../INVENTORY_PLAN.md` and `../REFUND_WORKFLOW_1A.md` for context. The older `../CODE_REVIEW_2026-09-29.md` contains historical findings: recheck each finding against current code instead of assuming all remain unfixed.

## Current source map and known constraints

The original map was checked on 8 October; the catalogue status below was updated on 9 October after ST-02 review fixes. The implementing agent must inspect the files again because other development may occur.

| Area | Existing files / behavior |
| --- | --- |
| Desktop routes and navigation | `src/App.tsx`, `src/components/Layout/MainLayout.tsx` |
| Catalogue and stock fields | `src/pages/Products.tsx`, `electron/catalogue.service.ts`, `src/lib/catalogueDescription.ts`, `prisma/schema.prisma` and additive catalogue storage |
| Data bridge | `src/lib/db.ts`, `electron/preload.ts`, `electron/main.ts` |
| Permissions | `electron/permission.service.ts`, `src/store/authStore.ts`, `src/pages/Permissions.tsx` |
| Local stock movements | `InventoryMovement`; sale/refund/exchange/void handlers in `electron/main.ts` |
| Cash Register | `src/pages/CashDrawer.tsx`, `src/types/cashRegister.ts`, register handlers in `electron/main.ts` |
| Reports | `src/pages/Reports.tsx`, `src/services/reports.service.ts`, cloud reports/sales routes |
| Cloud compatibility | `electron/sync.service.ts`, `zain-pos-api/prisma/schema.prisma`, `zain-pos-api/src/routes/sync.ts` |
| Existing checks | `scripts/catalogue-*.test.cjs`, `scripts/stock-st02.test.cjs`, `scripts/refund-regression.test.cjs`, `scripts/cash-register-history.test.cjs`, `scripts/stock-st01.test.cjs`, `scripts/stock-page.test.cjs`, `scripts/release-smoke-check.js` |

Important constraints:

- ST-02 now edits all variants by stable ID, with exact revisions, durable save replay, barcode reservations and preparation guards. The Products Edit modal also has independent loading/error/retry and stale-response protection. Preserve these fixes; see `ST02_REVIEW_FIXES.md` for dated verification evidence, not a substitute for inspecting current code.
- Catalogue saves do not set existing stock; new conversion variants remain zero and prepared. Authoritative counts/adjustments are still future work and need stock + movement + audit records in one transaction.
- Connected product imports accept Excel and skip existing barcodes. They do not apply opening counts, understand all proposed attributes, or reconcile subsequent sales. Do not present them as the new count importer.
- Source Prisma schemas and the generated runtime client have pre-existing drift. Inspect both before changing models. Do not regenerate blindly, erase models to make a build pass, or run destructive schema commands against the shop DB.
- Scoped catalogue/database/label operations now enforce a trusted sender/token identity and backend permissions. Preserve that boundary and cost masking. Do not assume every other legacy operation has been audited or accept a renderer-supplied user ID for new privileged writes.
- Catalogue metadata sync requires compatible server capability and acknowledgement. Unsupported cloud servers leave new catalogue metadata pending locally; preserve eligible legacy/sales progress and do not claim a production server upgrade has happened.
- Packaged startup can automatically restore a nonempty database based on backup filesystem modification time. Address and test that before releasing an installer to the shop PC.

## Recommended milestones

| ID | Deliverable | Boundary / dependency |
| --- | --- | --- |
| F-00 | Upgrade/data preservation and privileged-write permission prerequisites | Required before a production rollout with new write workflows; independent from designing a read-only page. |
| ST-01 | Stock overview and movement history using actual existing data | First page milestone. Read-only; no counts, catalogue rewrites or purchases. |
| ST-02 | All-variant Products editing, flexible attributes and label preparation | Implemented with review fixes. Preserve the existing safeguards; new conversion variants remain prepared. |
| ST-02A | Simple names, category fields, short new barcodes and 32 × 18 mm labels | Deferred by the owner. Not a prerequisite for draft entry; retain its brief for later. |
| ST-03A | Durable stock-count drafts | Implemented with review fixes; owner testing pending. Create/save/reopen/edit/cancel locally; no stock changes or activation. See `ST03A_REVIEW_FIXES.md`. |
| Excel audit upload | Offline audit review inbox | Replaces Neon Audit at the owner's request. Stock → Excel Audit previews and saves an uploaded workbook separately from live inventory. No catalogue/count-draft import or stock posting. See `EXCEL_AUDIT_UPLOAD.md`. |
| ST-03B / remaining ST-03 | Review and once-only batch posting/activation | After draft review. Small physical batches; old and new codes coexist. Needs accurate identity, usable labels, reliable permissions, old-bill return-stock mapping and an agreed insufficient-stock policy; shop rollout also waits for ST-04 and F-00. |
| ST-04 | Controlled stock adjustments and simple goods receipt | Record reasons and movements; do not invent supplier invoices or expenses. |
| ST-05 | Optional portable catalogue/count transfer | Only if laptop-prepared counts are chosen; preview, match and apply once. |
| PU-01 | Suppliers, purchase invoices, receipt/cost records and opening supplier balances | Establish incoming inventory and supplier amounts owed. Link any earlier receipt instead of receiving it twice. |
| AC-01 | Accounts: money movements, expenses and supplier payments | Reuse cash register and purchase records; no duplicate drawer or full general ledger. |
| PF-01 | Profit with cost coverage and historical cost basis | Depends on verified costs, returns/exchange rules and recorded expenses. |
| Later | Forecasting, purchase advice, promotions, mobile billing and WhatsApp | Separate requirements after underlying records are reliable. |

Accounts can be implemented earlier as a limited cash-flow view, but it must not pretend supplier balances or complete profit are available before their source records exist.

Development milestones can be reviewed separately, but the real shop's tracked-stock rollout needs both ST-03 and ST-04. Counting without a supported way to record tomorrow's deliveries, damage or corrections would immediately make the new balances unreliable. Notebook count entry must work without ST-05; CSV is optional.

ST-02 prepared the catalogue and label tools; ST-02A is deferred. ST-03A now saves observed draft counts only; complete its owner checks before moving on. Until the remaining ST-03 workflow is ready, do not replace labels on selling stock or activate quantities from the old audit. At rollout, install the tested app first, prepare or transfer catalogue/count records through a reviewed path on the shop PC, then convert one small batch at a time. Existing bills and cash records stay in that PC's database.

## Rules shared by every implementation

### Scope and UI

- Read `AGENTS.md` before editing. Never use `window.alert`, `window.confirm` or `window.prompt`.
- Use `src/components/ui/ConfirmDialog.tsx`, `Modal.tsx`, and `Toast.tsx` for confirmations, modals and notifications. Existing OS file pickers are separate from prohibited native browser dialogs.
- Match the established app design, support light/dark mode, keyboard use, loading, empty, failure and retry states. Keep routine cashier tasks short.
- Real data only. Do not ship hard-coded demonstration amounts, random charts, fake supplier balances, or nonfunctional action buttons.
- Do not reformat unrelated files, reset the working tree, remove others' edits, or implement the next milestone without a request.

### Data and writes

- The backend validates quantities, money, identities, permissions and allowed state transitions. A renderer-computed number is not authoritative.
- Use whole pieces for clothing quantities. Reject fractional, non-finite and invalid inputs. Handle legitimate zero distinctly from missing input.
- Calculate currency deterministically to paise and define rounding reconciliation. Do not independently round related amounts so their totals disagree.
- Related writes are atomic. A failure must not leave stock updated without its movement, or money recorded without its matching transaction.
- Retry/double-click behavior is part of the design. Use durable operation IDs/idempotency, not just a disabled button.
- Keep posted financial history traceable. Correct it through a linked adjustment/reversal where required; do not silently delete evidence.
- Do not turn unavailable data or failed requests into zero. Display unknown/incomplete/error explicitly.
- Persist critical records locally. Record successful local work even when cloud sync is unavailable, then synchronize without applying it twice.
- Apply permitted catalog changes and their sync representations consistently. Older payloads must not erase new metadata or reset verified stock.
- Enforce cost visibility in backend responses as well as the UI. Do not send hidden cost data to an unauthorized renderer.
- Use indexed, bounded queries and stable pagination. Totals must match the complete filtered result, not just the visible page.
- Use the shop's Asia/Kolkata business day consistently. Cash flow uses the actual payment/refund event day; don't silently group by UTC or original invoice date.

### Upgrade and deployment

- Development/test DBs are separate from the live shop DB. Never copy or restore the laptop DB over current shop sales to transfer products or counts.
- Changes to installed data must be additive/versioned and preserve IDs, bills, settings, payments, cash closings and audit history.
- Do not use reset, force-reset, drop/recreate, or demo seeding as an upgrade procedure.
- Verify an upgrade on a disposable copy, including sales recorded after that copy's older backup. A newer backup file timestamp must not overwrite valid current bills.
- Test restart/retry after an interrupted count or import. The app must recover to a clear state without partial or duplicated posting.
- No deployment, cloud migration or live-shop mutation is authorized by this document. Prepare and test the feature; the owner controls shop rollout.

## Accounts page: preliminary brief for AC-01

Purpose: let the owner understand where shop money went and what is owed. This is a practical operating page, not a full accountant's general ledger.

Required sections:

- Date-filtered cash and UPI collections, actual customer refunds, operating expenses and owner withdrawals, with drill-down to source records.
- Expense records with date, category, amount, payment mode, description and operator. Support Cash and UPI without creating cash movements for UPI expenses.
- Supplier payments, linked to supplier invoices or verified opening balances once PU-01 is available.
- A clear distinction between net cash flow and cash physically expected in the drawer. The existing register owns the drawer reconciliation.

Financial rules:

- Cash tendered minus cash change is collected cash. A Rs.900 bill paid with Rs.1,000 and Rs.100 change contributes Rs.900, not Rs.1,000.
- Split Cash Rs.400 + UPI Rs.500 contributes Rs.900 total, Rs.400 to cash, Rs.500 to UPI.
- Exchange credit is an internal funding source, not new Cash/UPI collected. Store-credit liabilities/redemptions need real linked records before reports claim to track them; a remarks note alone is insufficient.
- Float corrections and cash carried forward are not income. Owner withdrawals reduce cash, not operating profit.
- Reuse existing cash-out records for drawer-paid expenses. A new expense must link to exactly one cash movement; an existing cash movement must not become a second expense.
- Credit purchase Rs.1,000 increases the supplier amount owed. Paying Rs.400 leaves Rs.600 owed; the payment is not another purchase or operating expense.
- Supplier opening balances carry a stated effective date and verified amount. They create neither stock nor current-period purchases/expenses.
- UPI collections are not a verified bank balance. Label them accordingly unless actual bank records are integrated.
- Posted corrections, cancellations and repeated saves must not create duplicate money movements.

Do not add customer loans, B2B invoicing, bank reconciliation, journal vouchers, full financial statements or automatic tax-compliance claims to AC-01.

## Profit page: preliminary brief for PF-01

Purpose: show a defensible operating result and what data is missing, rather than a confident-looking number based on incomplete costs.

Metric definitions:

- **Net sales value:** selling values after discounts and valid return/exchange adjustments; not merely the sum of every bill or payment row.
- **Sales revenue:** net sales value excluding its tax component under the application's verified tax treatment. Do not invent a new GST rate or tax/legal policy in this task.
- **Cost of goods sold (COGS):** the historical cost basis of the units sold, reversed appropriately for resalable returns.
- **Gross profit:** sales revenue minus COGS.
- **Operating profit estimate:** gross profit minus recorded operating expenses. Do not label it complete net profit while other costs are missing.
- **Gross margin:** gross profit / sales revenue, with an explicit unavailable state for zero/invalid denominators. Do not confuse margin with markup.

Required behavior:

- Choose and document a cost method in the purchase/costing specification before coding final profit calculations. Capture a durable cost basis/snapshot for each sale and returned unit. Later product-cost changes must not rewrite previous profit.
- Opening quantities do not establish costs automatically. Obtain a verified opening cost basis; do not silently apply today's cost to old sales.
- Existing zero/default cost values must not be treated as verified free stock. Unknown cost stays unknown unless a real zero cost was confirmed.
- Show cost coverage and excluded/unknown items. If totals cover only known costs, label that subset precisely; don't subtract partial COGS from all revenue and call the result complete profit.
- Supplier payments, owner withdrawals, opening float and stock counts are not COGS or operating expenses.
- Buying stock is not an immediate sale expense. Recognize cost when stock is sold under the agreed cost method. Damage/loss has its own defined treatment.
- Refunds must reverse eligible revenue once. Distinguish resalable restocks from damaged/unidentified returns; don't silently restore saleable inventory.
- Replacement bills and exchange credit must reconcile with original sales. Preserve the MRP/full-selling-price credit policy without double-counting turnover.

Exchange acceptance example, excluding tax only to make the illustration simple: a Rs.700 shirt sold for Rs.650 is exchanged for an Rs.800 item using Rs.700 credit and Rs.100 fresh payment. Total customer money is Rs.750. The reporting treatment must reconcile the returned item, replacement and Rs.50 shop-funded allowance explicitly. It must not report Rs.1,450 simply by summing both bills. For partial old discounted bills, the actual net returned value may need explicit allocation; don't invent it from generic product names. Unused store credit requires separate liability treatment.

The completed PF-01 specification must settle sale/refund/exchange period treatment, costing, missing historical data, expense coverage and store-credit behavior before presenting a final profit number. Forecasts and discount advice remain later features.

## Required verification and delivery evidence

Use isolated temporary databases. Do not run fixtures, reset commands, imports or tests against `prisma/pos.db`, the shop's user-data database, or the production cloud.

Existing commands to check before selecting relevant checks:

```text
npm run typecheck
npm run verify:smoke
npm run test:refunds
npm run test:stock
npm run test:st02
node --test scripts/cash-register-history.test.cjs
node node_modules/vite/bin/vite.js build
```

The Vite build compiles renderer/Electron code; it is not an installer upgrade test. `npm run build` also packages an installer and should be used at a deliberate release checkpoint. If an existing command fails before changes, record the baseline and distinguish it from new regressions; do not suppress failures or change calculations to satisfy weak tests.

For each write milestone, verify actual production handlers with meaningful fixtures, including invalid input, unauthorized access, stale data, failure rollback, retry and offline/restart behavior. UI-only tests or snapshots cannot establish financial correctness.

Before a shop rollout, manually verify the real scanner, label printer, receipts, restart after interruption, and upgrade preservation. Keep claimed results limited to what was actually tested.

Delivery note template:

```text
Milestone:
Implemented behavior:
Files and schema changes:
Business rules preserved:
Checks run and actual results:
Acceptance cases passed / failed / not tested:
Known limitations or dependencies:
How the owner can test it:
Deployment/data migration status:
```

## Decisions to collect before the corresponding later milestone

- Actual category/attribute choices and size conventions: refine during ST-02. Optional attributes and distinct quality/style references allow preparation without pretending the naming system is final.
- Notebook direct entry versus portable laptop-prepared counts: ST-03/ST-05; do not build both at once without need.
- Negative-stock handling for converted pieces, insufficient stock overrides, and damaged-return handling: before ST-03 activation. Never apply a new stock restriction to uncounted legacy pieces silently.
- Supplier opening-balance date, purchase-cost method and treatment of receipt charges: PU-01.
- Expense categories, access rights, and whether Accounts initially excludes supplier balances: AC-01.
- Verified cost basis, profit period treatment and exchange/store-credit accounting: PF-01.

Do not turn this list into a large questionnaire before ST-01. None of these unresolved later choices prevents a truthful read-only stock overview.
