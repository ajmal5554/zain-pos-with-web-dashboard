# Stock page PRD

Current implementation note (14 October 2026): version 3.0.18 implements the approved inventory workspace, reviewed Excel preparation, held-batch activation, basic adjustments, tracked-stock limits and return-stock mapping. See [INVENTORY_WORKSPACE.md](INVENTORY_WORKSPACE.md) for the current workflow. The milestone sections below preserve their historical contracts; the ST-03A draft-only limitation describes that earlier milestone, not the later activation workflow.

Version: 1.3, 9 October 2026. Read with `README.md` in this directory. ST-02/ST-03 support small batches and simultaneous old/new labels, replacing the earlier complete-group cutover plan.

ST-01, ST-02 and ST-03A are implemented with review fixes. Complete the owner checks in [ST03A_REVIEW_FIXES.md](ST03A_REVIEW_FIXES.md) before the remaining ST-03 posting work. The owner has deferred [ST-02A: catalogue usability](ST02A_CATALOGUE_USABILITY_PRD.md). Draft entry uses existing saved prepared variants and their codes without that follow-up. Its proposed simple names, category fields and compact labels remain documented for later; no catalogue redesign is authorized by ST-03A. All existing identity, permission, history and preparation safeguards still apply.

## Purpose and separation from Products

Products answers: **What do we sell, at what price, and under which barcode?**

Stock answers: **What quantities are recorded, which have been physically verified, and why did they change?**

Reuse the existing catalogue and inventory movement records. Do not create a second Products page or a separate quantity that disagrees with POS. Break this page into the milestones below; the first Antigravity prompt requests **ST-01 only**.

## ST-01: stock overview and movement history

### Outcome

The owner can inspect the current recorded quantity for each existing variant and its recorded movements. The page is useful immediately, while making clear that opening stock has not yet been verified. This milestone does not activate inventory tracking or change any quantities.

### Included

- A desktop Stock route and navigation item integrated with the existing layout, permissions and error boundary.
- A list of real active product variants with product name, category, barcode/SKU, existing variant description, recorded quantity and recorded minimum quantity.
- Search by product name, barcode and SKU; category and recorded-balance filters; stable pagination.
- A movement detail panel/modal for the selected variant with a date filter and paginated history.
- Clear loading, empty, error and retry states, and a refresh action.
- Links to the existing Products page for users allowed to manage products. No inline catalogue or stock edit controls.

### Explicitly excluded

Do not implement physical counts, opening balances, stock adjustments, goods receipts, CSV import, attributes, label redesign, purchases, accounts, profit, valuation, reorder suggestions or forecasting in ST-01. Do not add fake or disabled action buttons suggesting those features are available.

Do not change POS, refund/exchange math, cash-register workflow or installed databases to make this page look complete. Necessary read APIs and route integration are allowed; broad refactoring is not.

### Page presentation

1. Title: Stock. Explain that quantities shown are current system records.
2. A clear notice: opening stock has not been physically verified. Existing negative/zero balances must not be described as proven physical shortages or empty shelves.
3. Search and category controls, plus filters for All, Positive, Zero and Negative recorded balances. These filter database quantities, not physical availability.
4. A stock table with one row per **variant ID**, not one per product name or selling price.
5. Optional compact totals for matching variants and their positive/zero/negative recorded-balance counts. Calculate over the complete filtered result, before pagination. Do not show invented stock value or total investment.
6. A selected variant's movement history using the existing shared Modal or an accessible in-page panel.

Example labels: `Recorded quantity: -12` and `Opening stock unverified`. Do not label that row `12 pieces missing`. An unknown size/attribute can display `Not recorded`; do not populate it with invented data. The existing colour field need not be exposed and no new colour workflow is wanted.

Use the app's Indian currency/date conventions where relevant, but the stock list does not need cost prices. Do not fetch/display cost data in ST-01.

### Movement detail

- Show timestamp, type, signed quantity, reason, reference and recorded operator where available.
- Respect the existing convention: sale/exchange-out quantities are negative; stock-in/refund/exchange-return quantities are positive. Do not negate them a second time.
- Show the meaning of known movement types and a readable fallback for unknown legacy types. Do not drop records because a type was added elsewhere.
- Allow date filtering of movements. The list's current quantity remains a present-time value; a history filter must not pretend to reconstruct stock at a past date.
- Do not calculate the current balance only by summing history: historical opening stock and direct edits are not yet fully represented.
- References can display invoice/count IDs or use already-supported navigation. Never link to a guessed route or rewrite the referenced record.
- If an inactive legacy variant is opened from an existing historical reference, show its history with an inactive label. No new sale or editing action is implied.

### Queries and integration

- Inspect `src/lib/db.ts`, `electron/preload.ts`, `electron/main.ts` and current permissions before choosing the query boundary.
- Use bounded backend queries. Default page size 50, maximum 100, with deterministic ordering including variant ID. Search/filter totals and rows must agree.
- Use projections that omit cost prices and unrelated sensitive data. Avoid fetching every Sale or every Movement to render a list.
- Prefer a focused read service/handler if existing generic query operations cannot supply bounded lists and totals safely. Do not expose arbitrary new model/method access.
- Cancel/ignore stale search results so a slower old request cannot replace a newer search. Reset pagination when filters change and clamp it if the result shrinks.
- Read failures must show a failure state and retry, not silently replace quantities or totals with zeros.
- Refresh should reflect subsequent committed POS movements. Do not poll the full catalogue continuously. Re-read when appropriate on page entry, explicit refresh and relevant local updates.
- Keep the implementation compatible with the actual runtime Prisma client. ST-01 should not need a data-model migration.

### Access

Reuse the existing inventory permission for Stock access: admin or `permManageInventory`. Add it to the relevant route/navigation type unions without changing permissions elsewhere. Backend reads for the new feature must enforce the corresponding allowed access; hiding navigation is insufficient.

Inspect and document the repository's existing caller-supplied-identity limitation. Do not invent an anonymous fallback or grant every active user access. ST-01 introduces no privileged writes; the trusted-auth prerequisite remains required before later stock-write workflows are released.

### ST-01 acceptance cases

| ID | Fixture / action | Expected result |
| --- | --- | --- |
| S1 | Product with 3 existing variants | Three rows, each with its own stable variant ID and barcode. |
| S2 | Two variants both sell for Rs.700 | Separate rows; neither price nor name merges them. |
| S3 | Existing recorded stock -12 | Show -12 as unverified recorded stock; no claim of a physical shortage. |
| S4 | Existing recorded stock 0 | Distinguish zero from loading, missing input or a failed request; no claim of verified empty shelves. |
| S5 | Name, SKU, barcode and category searches | Correct matching rows, counts and stable pages; barcode text stays unchanged. |
| S6 | Result has more than one page | Totals cover all filtered rows; pagination has no duplicate/missing IDs for a stable dataset. |
| S7 | Search A responds after newer search B | B stays visible; A does not overwrite it. |
| S8 | Movement quantities -2, +1 and -1 | Show the stored signs correctly and their source types. |
| S9 | Old or unfamiliar movement type | Record remains visible with a readable type/reason. |
| S10 | Change movement date filter | Only movement history changes; current stock is not relabelled as a past balance. |
| S11 | Data request fails | Show the error and Retry; no fabricated zero totals. |
| S12 | Refresh after a committed sale | Correct variant's recorded quantity and movement reflect the sale. |
| S13 | Unauthorized direct route/read | Access is denied through the applicable boundary; UI and backend behavior are checked. Document existing identity risks honestly. |
| S14 | Authorized request | No cost-price fields are needed or returned by the new stock read response. |
| S15 | Open/refresh/filter/close the page | No ProductVariant, Movement, Sale, Refund, Exchange or CashRegister data is written. |
| S16 | Offline cloud connection | Local stock page still works; cloud failure does not clear local records. |
| S17 | Catalogue is empty | Explain the empty state and offer Products navigation only when permitted. |

Verify the read handler/query behavior with isolated fixtures and inspect the UI in light/dark modes and the shop's display size. Keep tests focused on behavior and boundaries, not a copy of the implementation. Record baseline unrelated failures rather than modifying unrelated code.

### Completion boundary

Finish ST-01 and report actual results. Do not claim the app is ready for physical stock counting yet. ST-02 and ST-03 must be requested separately.

## ST-02: catalogue and label readiness

### Outcome and scope

The owner can prepare specific garment records and print the correct labels using the existing Products page. This milestone makes no physical-stock claim and does not activate conversion. Use `ANTIGRAVITY_ST02_PROMPT.md` for implementation.

Existing legacy products remain usable exactly as before. New records explicitly prepared for conversion must be distinguishable from existing saleable records. They can be managed and previewed/printed, but cannot enter a sale or replacement bill until a later committed conversion activates them. Enforce this at the backend as well as selection/search. Do not overload a deletion flag so that prepared records disappear from management or deactivate all existing variants in the same product.

### Identity and editing

- Fix desktop Products to load and edit all variants by stable ID. Reordering the form must never remap an old variant's barcode, stock or sale references to another row. New unsaved rows need stable form keys too.
- Save the product and related variant changes atomically. Reject stale concurrent saves rather than silently overwriting a newer edit. Retry a creation without creating another copy.
- Preserve existing generic records such as Shirt 700. Do not rename one into Crazy Heart XL when it represents many brands/sizes. Prepare the specific records alongside it.
- Support optional structured size, brand, fabric, quality and pattern/design. Sleeve, fit, collar and pocket are also useful optional fields from the audit. Show relevant fields by category; colour is not required. Do not force every category into a shirt form or build an elaborate attribute-rule designer.
- Keep fabric and quality distinct. Two physically different qualities/models can share the same size, brand, fabric, pattern and price. Allow an owner-entered style/model/quality reference to distinguish them; never automatically merge them. If identity is unresolved, keep the record in preparation and explain what needs clarification.
- Trim values and compare obvious case/space duplicates consistently. Do not infer that different brand names or abbreviations are aliases. Preserve readable display values.
- Generate a readable description from structured fields, for example `Shirt | Crazy Heart | XL | Full Sleeve | Checks | Cotton`. Keep price separate; abbreviations are not a settled shop convention. Use a shared description formatter for current catalogue/POS/return selections and labels without rewriting stored old sale-item descriptions.
- Attribute-only edits and price changes must not change quantity, historical movements or identity. Changing the physical meaning of a referenced variant requires a new variant, not rewriting the old one. Preserve inactive historical variants; removing a form row must not hard-delete history or silently deactivate it.
- Catalogue saves must not accept stock, tracking activation or inventory movements from the renderer. Preserve existing quantities, including if a sale commits during editing. New conversion records start at the schema's default zero with an explicit unverified/prepared state. The count belongs to ST-03, not an Initial Stock field in this workflow.
- Preserve cost permissions. Editing other fields must not overwrite a hidden cost with a default zero or expose costs to unauthorized users. This milestone does not establish verified costs or profit.

### Barcodes and labels

- Preserve existing barcode/SKU strings and leading zeros. Each distinct identified variant has its own globally unique code; identical pieces share one code. Price is not a matching key. A shared old generic code must never be aliased to one guessed new variant.
- Enforce uniqueness in backend/database, including inactive records and concurrent generation. Keep a generated code stable through saving/reopening and printing. Do not generate a new code on every label request. Existing assigned codes must not be silently replaced or recycled.
- Let the owner select any variant, preview its description, barcode and price, and enter an explicit positive whole-number label-copy count. Label copies are independent of recorded stock and the old audit quantity. Bound print jobs sensibly and show errors truthfully.
- Printing, cancelling, failing or reprinting a job changes neither stock nor conversion state. Do not equate a successful print call with labels being applied to physical garments. Test labels only in ST-02; do not advise relabelling selling stock until ST-03 is ready.
- Reuse the existing label printer/layout and scanner conventions. Escape owner-entered text in generated print HTML. Preserve usable quiet zones/bar widths and long-description layout; real printer/scanner verification is a shop-release requirement.

### Integration and exclusions

Inspect source/generated local schemas, installed-database upgrade logic, cloud schema and product sync together before choosing a minimal additive representation. Missing fields in an older sync payload must preserve newer metadata and preparation state; old sync must not activate prepared variants or reset stock. Do not erase schema models to reconcile drift or deploy cloud changes from this milestone.

Use the existing relevant product/label permissions with a trustworthy backend identity. The known F-00 identity and upgrade prerequisites remain production release gates; a supplied user ID or hidden control is not proof of authorization. If a safe path depends on work outside ST-02, identify that dependency plainly and keep unsafe writes blocked rather than claiming a production-ready feature.

Do not implement count sessions, conversion posting, adjustments, receipts, mass rename/rebarcode/import, laptop-to-shop transfer, supplier accounts, profit, forecasts, mobile billing or WhatsApp here. Do not read/import the owner's audit as fixture data into a live database. Do not replace old labels or retire old codes.

### ST-02 acceptance cases

| ID | Fixture / action | Expected result |
| --- | --- | --- |
| C1 | Open a product with three variants, reorder and edit one | All three load; only the selected stable ID changes; IDs, codes, quantities and history stay attached correctly. |
| C2 | Add one variant; save twice/retry | One new prepared variant, one stable unique barcode; no duplicate record or inventory movement. |
| C3 | Two garments share price/size/pattern but differ in quality/model | Separate identities and codes; no automatic merge. Unresolved differences remain prepared. |
| C4 | Save an existing generic Shirt 700 beside a prepared specific shirt | Legacy code remains usable; no historical rename or reassignment. |
| C5 | Enter a duplicate code, including an inactive record or concurrent generator | Backend rejects/retries safely; no partial product save or reassigned code. |
| C6 | Save/reopen/print barcode 0012345 | Text and encoded barcode remain 0012345 throughout. |
| C7 | Print five labels, cancel a job, fail a job, then reprint | No quantity, tracking state, movement, sale or financial record changes. |
| C8 | Scan/select a prepared conversion variant in POS or exchange replacement | Clear preparation message; backend cannot post it as a saleable item. Existing legacy billing still works. |
| C9 | Change description/price while a legacy sale changes quantity | Correct description/price update; latest stock and all sale snapshots are preserved. |
| C10 | Unauthorized catalogue/print request or forged stock/activation fields | Denied at the appropriate backend boundary; no hidden costs returned or stock overwritten. Document any F-00 dependency. |
| C11 | Remove/reorder an existing referenced row; submit a stale edit | No history deletion, index remapping or silent concurrent overwrite. |
| C12 | Offline save/restart; older sync payload later arrives | Metadata and preparation state persist; no activation, quantity reset or duplicate variant. |
| C13 | Upgrade a disposable existing database with multiple variants and bills | Additive migration preserves records, codes, quantities, settings and references. |
| C14 | Long description and special characters; light/dark and keyboard use | Safe, readable form/label preview; printer/scanner cases reported as tested or pending. |

Finish with changed files, actual test results, remaining release dependencies and a short owner test. Do not claim tracked stock is ready because catalogue preparation passed.

## ST-03: opening counts and gradual transition

Develop and test this milestone independently, but activate tracked stock at the shop only when ST-04's basic receipts/adjustments and the legacy-return mapping below are also ready. Notebook entry is a complete supported path; portable CSV is not a prerequisite.

### ST-03A: durable drafts only — implemented for owner testing

Implement the draft boundary first. ST-02A is deferred and is not a prerequisite for this task. Use the current Stock page and existing saved prepared variant identities/codes. No stock posting, finalization or activation is included. The remaining ST-03 sections describe later behavior, not instructions to implement it now.

Provide a concise Count drafts view with create, save, reopen, edit and cancel. Each draft represents one explicitly described physical batch, not all goods sharing an old generic code. It records an observed count; it does not certify that pieces are currently held, labels applied or counts ready to post.

Required durable records:

- Header: stable ID, operation kind fixed to conversion additions, Draft/Cancelled status, batch description, creator/last editor, created/updated times, optional observed count time, source legacy reference and notes.
- Lines: stable line IDs and saved prepared variant IDs, backend-captured readable identity/barcode snapshots, counted quantity or explicit uncounted value, and optional notes. Current catalogue changes/unavailability must be visible for review, without silently substituting another variant.
- A draft revision and durable create/save/cancel operation IDs bound to normalized request payloads. Header, lines, revision and replay outcome commit atomically. Reject an operation ID reused with different content. Repeated requests after a lost response/restart must not duplicate records or overwrite newer edits; an older replay response must not replace newer/cancelled UI state. Cancelling is terminal; stale saves cannot revive it. Retain cancelled records for review.

Allow incomplete drafts to be saved. A new draft may be empty, and a line may be uncounted. Adding an identified line requires a real saved prepared variant; unresolved identity belongs in a clearly incomplete note, not a fabricated ID or guessed match. Keep one line per variant per draft and let the operator edit its batch quantity. Supplied quantities must be non-negative whole pieces, with blank distinct from zero. Zero on a draft addition means no eligible counted pieces on that line, not a verified zero baseline. Complete baseline/recount is excluded from ST-03A.

Search/pick variants by stable ID with barcode and readable distinguishing details, including when names/prices match. Offer existing Products navigation when permitted. Do not create/rename products, shorten codes or redesign category fields/labels in this screen. Prepared state alone is not proof that the physical garment is correctly identified; show that the operator must check it.

Clearly label all counts **Draft only — not applied to stock**. Show observed batch quantities separately from current recorded stock. No Apply/Activate/Finalize action or placeholder. Draft saves/cancellation must not change stock, preparation/tracking status, movements, sales, returns, exchanges, payments or cash records.

Use trusted backend session identity and admin or `permManageInventory` for every read/write. Do not trust a renderer-supplied actor ID or expose costs. Use bounded lists/detail queries, stable pagination, loading/error/retry and stale-response protection. Store drafts locally in the database; retain them across restart/offline use. Do not put them into existing posted-stock/cloud sync representations.

Laptop drafts remain on the laptop. The later installer does not transfer them. Re-entry/rechecking on the shop PC or reviewed ST-05 transfer is required. The dated audit and seven unspecified sales cannot reconstruct exact current quantities; fresh verification/reconciliation remains necessary before later posting. Do not relabel selling stock during this draft-only milestone.

Before activation, the remaining ST-03 work must settle insufficient-stock behavior, finalization and legacy-return mapping, validate real printed labels and pass ST-04/F-00 rollout prerequisites. These are not blockers for saving drafts and must not be silently implemented in this task.

#### ST-03A acceptance cases

| ID | Action | Expected result |
| --- | --- | --- |
| D1 | Save/reopen a draft; restart while offline | Header, lines, observed time, notes, IDs and operation kind survive; clearly draft-only. |
| D2 | Select two prepared variants sharing name/price; reorder/edit one line | Separate identities/codes; the intended line changes without catalogue changes. |
| D3 | Save empty/incomplete, blank-count and explicit-zero drafts | Incomplete states are clear and durable; zero differs from uncounted and is not a baseline/activation. |
| D4 | Supply negative, fractional, non-finite quantities or nonexistent/non-prepared target IDs | Backend rejects invalid identified lines atomically; no invented variants or partial update. |
| D5 | Retry create/save after timeout and a fresh database connection; reuse ID with different content; replay an old success after a later edit/cancel | Original operation outcome without duplicate records; changed payload rejected; newer/cancelled database and UI state preserved. |
| D6 | Two operators edit the same revision | One valid update; stale update rejected without overwriting it; reload/review is available. |
| D7 | Cancel, restart/retry, then submit an older edit | Cancelled record persists; no revival, deletion or duplicate cancellation. |
| D8 | Failure after header or one line would have changed | Complete rollback including revision/replay state; recovery permits a safe retry. |
| D9 | Unauthorized or forged-identity direct read/write; logout/disabled user | Denied by trusted backend permission checks; no costs or draft data exposed. |
| D10 | Rename/change/unavailable catalogue record while draft exists; slow UI response arrives late | Captured identity retained, current difference shown for review; no guessed replacement/stale overwrite. |
| D11 | Compare relevant records before/after create/save/edit/cancel and concurrent POS activity | Draft actions change no stock, preparation, movements, sales, refunds/exchanges, payments or cash; valid POS work is preserved. |
| D12 | Inspect UI and cloud/local behavior | No posting/activation/import/retirement; observed counts remain distinct from current/verified stock and excluded from posted-stock sync. |

Use disposable synthetic databases and meaningful service/handler/UI tests. Preserve existing ST-02/Stock/refund/cash regressions, run typecheck/smoke and bundle build, follow AGENTS.md version/changelog rules for actual implementation, report exact results and stop for review. See `ANTIGRAVITY_ST03A_PROMPT.md` for the paste-ready task.

### Required records and state

Use a durable conversion/count session with ID, operation kind, source legacy group/code where known, status, operator, created/finalized times, effective cutoff, and lines keyed by stable variant IDs. A batch is a specified set of physical pieces, not every garment using an old price code. Keep original physical counts and reconciliation notes separate from current balances. Do not use localStorage as the authoritative count record.

Each eligible variant needs an explicit persisted tracking/baseline state and scope. Do not infer `TRACKED` from stock being positive, or `UNTRACKED` from a negative number. Existing stock starts unverified/untracked unless an actual count record proves otherwise. A converted variant's quantity initially covers only pieces with its new labels, not matching pieces still carrying an old generic label. Show conversion coverage separately from tracking status.

Suggested count states: Draft, Finalized, Cancelled. These are behavior requirements; use names consistent with the repository. Draft changes no live stock. Finalized applies once and becomes immutable; corrections create a later referenced adjustment/count.

### Owner workflow

- Install the tested version on the shop PC and prepare the catalogue there, or use a later reviewed ST-05 transfer. The installer alone does not bring laptop records into the shop database.
- Take aside a small physical batch, for example ten shirts, while all other stock remains available for sale. Identify the actual variants and freshly count those held pieces. Notebook notes are supported; enter/review the batch on the shop PC.
- Print/apply the new labels, removing or fully covering the old scannable labels on those pieces. Keep them aside until the batch has committed successfully. A failed/interrupted batch stays held for recovery; do not release newly labelled but uncommitted pieces to customers.
- Commit the held batch once, verify the result, then return those pieces to the shelf. Repeat during spare time. No whole-shop closure or same-day completion of a generic price group is required.
- Old-label sales continue against the legacy generic record; new-label sales use the specific converted variant. Make this distinction clear and give staff a quick specific-item lookup if its label fails. Never route a converted piece through the old generic shortcut, or guess a new variant from an old generic scan.
- Laptop option: keep real count sessions distinct from tests. For any counts used later, record exact subsequent movements or recount the held pieces at conversion. Transfer only reviewed records with an explicit operation kind/cutoff using ST-05.
- Only adjust an item for movements occurring after that item's physical count. Include sales, sale edits, returns/exchanges, incoming goods, damage and voids with their actual physical effect.
- Generic old Shirt 700 bills cannot identify the size/fabric/design sold. The seven unspecified sales cannot be allocated to audit rows, or even assumed to belong to the audited subset. Use a fresh batch count or reliable physical records; never deduct seven automatically or claim automatic reconstruction is possible.
- Hold only the batch being converted during final reconciliation/posting. Detect changes to any tracked target balance and apply additions transactionally without overwriting concurrent valid sales. The initial release does not promise automatic counting across devices while sales continue.
- Distinguish a blank/uncounted row from explicit zero. Count all relevant display/storage pieces. Resolve pending customer selections at the cutoff so physical and recorded movements align.

### Finalization invariants

- Backend validates permissions, session status, operation kind, stable identities, quantities and the explicitly held physical batch. A new generic-to-specific conversion batch needs positive whole-piece additions; an explicit zero belongs to a complete baseline/recount, not a fictitious conversion.
- Distinguish **conversion additions** from **complete baseline/recounts**. A new specific variant at zero receives a committed batch of ten as +10. If two sell, quantity is eight; converting five more matching pieces adds +5 to produce thirteen. Never reset eight to five, or re-add the first ten.
- Only a complete reviewed baseline/recount of the stated physical scope replaces its prior unreliable quantity. In that separate mode, prior -12 and count 12 results in stock 12 with adjustment +24. Do not apply that replacement rule to later conversion additions. The UI and backend must make the operation kind explicit.
- Save adjustment/movement, audit, count status, tracking activation and stock changes in one transaction. If any step fails, none are posted.
- Repeated clicks, restart and retry must return the original outcome without posting the baseline twice.
- Preserve all old bills and inventory movements. Opening stock creates no cash, purchase invoice, supplier balance, sales revenue or operating expense.
- Verify the batch is still held and no unresolved physical movement affects its count. For a replacement baseline/recount, reject a stale checkpoint and reconcile before posting. Conversion additions must preserve intervening committed sales on the target variant. Do not rely only on invoice dates or laptop clock time.
- Never show one garment as inventory in both a legacy aggregate and its new variants. Legacy untracked quantities are excluded from verified totals/valuation.
- Keep a generic barcode active until the owner verifies that every remaining physical piece carrying that particular old code has been converted, including other brands/qualities/sizes using it. Finishing one new variant does not retire the shared code. Retire only for future billing, preserve history and prevent accidental reuse.
- Show `Conversion in progress: tracked quantities cover newly labelled pieces only`. Legacy balances stay visibly unverified and excluded from verified totals/valuation. Do not subtract a partial batch from an unreliable legacy number and present the remainder as a counted balance.
- Define and approve insufficient-stock behavior for tracked variants before activation; do not suddenly enforce zero/negative restrictions on uncounted products.

### Old bills and returned pieces

Current return handlers restock the original variant. After conversion, a legacy bill's generic variant may no longer describe the physical piece.

Before ST-03 rollout, add explicit return-stock mapping: link the return to its original bill/item for quantities and financial values, while the operator identifies the actual new matching physical variant for stock. Enforce compatibility and audit the selection. Restock exactly one variant, not both. An unidentified/damaged item must not silently enter saleable stock. Preserve original refund/exchange pricing and return caps.

### ST-03 release acceptance

| Scenario | Required result |
| --- | --- |
| Save a draft batch of 12 | Live quantity and POS are unchanged; no activation. |
| New specific variant at 0; commit ten held, relabelled pieces | Quantity 10, one +10 conversion movement and audited activation. |
| Sell two of those ten, then convert five more matching pieces | Quantity 13; later conversion adds five once without replacing eight. |
| Sell three other shirts under the still-active generic code | Specific tracked quantity is unchanged; legacy sale stays separate/unverified. |
| Print/reprint labels without committing | No stock or activation; held pieces are not returned to sale. |
| Complete baseline/recount mode: prior quantity -12; finalize 12 | Quantity 12, adjustment +24; not treated as a conversion addition. |
| Finalize an explicit zero in complete baseline/recount mode | Tracked quantity 0; it is not skipped as a blank. |
| Leave a row uncounted | Finalization does not assume zero. |
| Repeat finalization or retry after a timeout | Same posted result, no second adjustment. |
| Fail after one line would have been changed | Whole session rolls back. |
| Count 20, manually reconcile 3 sold | Import/finalize 17 once; do not subtract those 3 again. |
| Sale committed after a replacement baseline/recount checkpoint | Detect stale submission and reconcile before overwriting a balance. |
| Sale commits to an already tracked target while a separate batch is prepared | Apply the new batch addition to the latest balance; do not lose the sale. |
| Convert some Shirt 700 pieces while others retain their old labels | Both old and new codes work; new quantities cover only converted pieces. |
| Finish Crazy Heart XL while another brand still uses Shirt 700 | Shared old code stays active. Retirement requires completion across all its pieces. |
| Scan a retired generic barcode | Explain that the new specific barcode is required; do not select a random variant. |
| Return an old generic-billed shirt | Preserve original financial handling; selected new variant restocks once. |
| Save/update a normal bill repeatedly | Stock changes only by the actual final quantity delta, without extra sale or movement. |
| Refund/exchange/void a counted item | Correct signed stock changes once, respecting existing return limits. |
| Restart during preparation or after print before posting | Draft survives; pieces stay held, no partial activation or duplicate posting. |
| Install/update application | Current shop bills, IDs, payments, settings and history are preserved. |

## ST-04: adjustments and simple receipts

Later scope: enter a reasoned receipt, damage/loss, or recount correction against a tracked variant. Each operation has operator, timestamp, durable ID, reason/reference, signed quantity and atomic stock/movement/audit posting.

Receipts are inventory movements, not automatically supplier invoices or expenses. When PU-01 is introduced, link an already-recorded receipt rather than receive the same goods again. Unknown receipt cost must stay identifiable for later profit coverage.

For a recount, show current and counted quantities plus the proposed difference. For damage/loss, validate the requested quantity and the selected variant. Unauthorized users, invalid/fractional amounts, failures and retries must not change stock.

## ST-05: optional portable count transfer

Implement only if the owner chooses laptop-prepared data. Current product import is not a substitute.

- Portable CSV/Excel rows include stable identity/barcode, catalogue details where reviewed, final quantity, real count/session reference and reconciliation cutoff.
- Preserve barcode text including leading zeros. Reject invalid, duplicate, ambiguous and non-finite values with row-specific errors.
- Preview new combinations separately from existing matches. Never match only on product name or price, and never silently reassign an existing barcode to another variant.
- Declare the operation kind: catalogue only, held conversion-batch additions, or a complete reconciled baseline/recount. Never infer additions versus replacement from quantity/sign. Raw dated counts require reconciliation/recount, not automatic activation; do not subtract recorded sales twice.
- Keep existing prices unless replacement is explicitly reviewed. Include new attributes in both export and import.
- Apply a reviewed session atomically with idempotency, audit and a clear report. Re-importing the same file/session must not post stock twice.
- A bad row or interrupted write must not leave half an import active. Preserve live sales, customers, cash and old variants.
- Do not transfer `pos.db` or restore a development backup as a product/count import.
