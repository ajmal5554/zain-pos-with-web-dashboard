# Zain POS Business System Roadmap

**Purpose:** a durable, phased plan for making Zain POS a dependable operating and decision-support system for Zain Gents Palace.

**Last reviewed:** 1 November 2026  
**Business context:** one B2C clothing shop, GST-registered, one primary shop PC, cash and UPI in use, staff need a fast checkout, and the owner is learning the finance side of the business.  
**Reference reviewed:** the Vyapar screenshots supplied in this conversation. They show parts of its home, parties, sales, purchase bills, settings, imports, accounts, cash/bank and reports experiences. They are not a complete review of Vyapar.

## 1. Product direction

Zain POS should become a **clothing-shop manager that explains the business and helps the owner make better decisions**. It should not try to reproduce every general-purpose ERP feature visible in Vyapar.

The app should help answer, in plain language:

1. What did we sell, and how much money did we actually collect?
2. After the cost of those garments and the shop expenses, how much operating profit did we make?
3. What stock do we have by sellable garment, size and barcode, and how certain is that count?
4. Which purchase invoices and supplier balances are still outstanding?
5. What should we reorder, when, and what evidence supports that recommendation?
6. Which promotion could increase sales without selling below a safe margin?
7. What needs an accountant's decision, and what is only an estimate?

The app must make the numbers understandable rather than assuming the owner knows accounting. Every important total should have a short definition, date range, source and a way to inspect the records behind it.

## 2. Principles and boundaries

- **One shop first.** Multi-firm, multi-branch and warehouse features are not current requirements.
- **Fast B2C checkout.** Barcode scanning and simple payment entry take priority over accounting forms during rush hours.
- **Clothing is the specialization.** Apparel categories can use different attributes. A shirt's collar, sleeve, fabric or pattern must not become required fields for pants, mundus or accessories.
- **A sellable combination has a stable identity.** Size, fabric/quality, design and any other physically distinguishing attributes determine whether two pieces need separate tracked stock and barcodes. Do not merge distinct products just because their names or prices match.
- **Preserve history.** A price edit or catalogue cleanup must not rewrite a completed bill, purchase receipt, refund, exchange or stock movement.
- **Separate shop identity from supplier wording.** Keep the POS item selected for the physical garment and the supplier invoice's original description as separate pieces of information.
- **Use confidence labels.** Distinguish audited stock from legacy/unverified balances, known cost from missing cost, actual results from forecasts, and provisional GST calculations from accountant-confirmed treatment.
- **Do not silently invent values.** Missing cost, customer data, tax treatment, sale history or physical counts should be shown as missing or provisional.
- **Offline and recovery are business-critical.** Local sales must be durable, backups restorable, and updates must never replace the shop database with a development or demo database.
- **AI advises; it does not post money or tax entries.** Suggestions must show their calculations and let the owner decide.
- **Privacy by default.** Collect customer details only when the shop has a real purpose and explain what they will be used for. Marketing requires a clear opt-in.

## 3. Current application foundation

The current desktop app already includes these substantial building blocks:

- POS checkout, barcode scanning, payments, receipts, sales history, exchanges and refunds.
- Products/catalogue, barcode labels, stock workspace, manual and Excel-based audit/count paths, stock movements, and tracked-stock controls.
- Purchases with invoice identity, invoice date, supplier text, batch name, item/variant mapping, quantities, unit costs, prices, HSN/GST snapshots, payments and invoice-level balances.
- Purchase cost lots used by profit calculations, plus purchase corrections and supplier returns/refunds.
- Expenses, daily cash register reconciliation, cash movement history and GST reports.
- Profit and Analysis and the Sales Forecasting page. Forecast scope includes one-to-six-month sales projections, stock/reorder directions, seasonal planning and comparisons; retain those capabilities.
- User permissions and activity/audit records.

These features exist in code, but their usefulness still depends on clean real records and owner workflow checks. Demo/test values are not business results. See the existing [inventory plan](INVENTORY_PLAN.md) and [Stock page PRD](development/STOCK_PAGE_PRD.md) for detailed stock contracts; this roadmap complements those documents and does not replace them.

### Known gaps or policy questions in the current foundation

1. **Supplier master and item-description mapping:** supplier is currently entered as text on a purchase. The exact supplier wording for each invoice line is not kept separately from the selected shop item. This makes later invoice matching and supplier statements harder.
2. **Batch label friction:** the system creates a purchase record internally, but currently requires a human-entered batch name. The internal identifier should be automatic; the readable name should be optional or generated from supplier invoice number/date.
3. **Price-versus-identity policy:** cost changes alone should create new purchase cost layers for the same physical sellable item. Current purchase code can create a new variant/barcode when selling price or MRP changes. This needs to be reconciled with the inventory plan's stable-identity rule before high-volume purchasing. Decide how to handle coexisting stock with different printed MRPs without corrupting historical bills or charging above the garment's marked price.
4. **Supplier balances:** invoice-level paid/due amounts are present. A supplier directory and complete supplier statement across invoices, payments, returns and credits are not yet a first-class workflow.
5. **Customer accounts:** a customer directory is not the same as a receivable ledger. Credit sales/customer balances should be added only if the shop starts allowing customers to pay later and wants that recorded.
6. **Financial interpretation:** profit/GST totals can remain provisional when purchase tax eligibility, historical costs or stock trust are unknown. The app must not present these as final statutory accounts.
7. **Opening-stock transition:** the latest supplied audit workbook is dated 25 October 2026. Sales continued afterwards, so it must be reconciled to a chosen cutoff or recounted before being used as live opening stock.
8. **Mobile continuity:** the main POS is a desktop app. Mobile billing while the shop PC is off needs a deliberate offline queue and conflict-safe bill-number/sync design; sharing a screen or copying the desktop database is not sufficient.

## 4. What to learn from Vyapar screenshots

### Useful patterns to adapt

- Keep **Add Sale** and **Add Purchase** easy to reach.
- Group a large feature set into expandable, named areas instead of presenting a long flat list.
- Provide quick search across transactions and strong date/type filters on report tables.
- Make supplier/customer balances traceable to the underlying invoices, payments and returns.
- Make export and print actions visible on reports that an accountant or owner regularly uses.
- Let owners choose which dashboard summaries are useful, while keeping the default dashboard simple.
- Make settings expose business rules clearly, such as negative-stock handling, GST information, backups and enabled workflows.

### Do not copy without a shop need

Vyapar's screenshots expose many capabilities that are useful to some businesses but not necessarily this shop. A menu item by itself is not a business outcome. Avoid adding a page or button until its user, data source, accounting effect, permission, recovery behavior and acceptance tests are defined.

## 5. Phased roadmap

### Phase 0 — Protect records and complete the stock transition

**Goal:** make the current catalogue and quantities trustworthy without interrupting daily sales or losing bills.

**Work**

- Use a dedicated, reviewed audit workbook and keep demo/test data isolated from the shop data.
- Reconcile counts made before the final cutover with sales, returns, exchanges, receipts and adjustments since each count. The old generic barcode cannot automatically identify the audited size/design that left the shop; where movements cannot be mapped reliably, recount the affected combinations at cutover.
- Agree a cutoff and import absolute opening balances with a review, duplicate-session protection and an audit record. Do not copy the laptop's database over the shop database.
- Complete a staged relabelling procedure so old and new codes do not double-count or silently sell the wrong tracked item. Verify barcode scan, sale, return, exchange and void for converted stock.
- Verify update/backup/restore behavior against a disposable copy of the shop database before sending an installer to the shop PC.

**Done when**

- The owner can explain which catalogue items are tracked and which balances remain unverified.
- A reviewed stock transfer is repeat-safe, traceable to a count session and does not overwrite live sales/customer/cash history.
- Staff can sell the new codes and process returns/exchanges without duplicate or wrong-variant stock movements.
- A backup has been restored in a test location and the updated app opens it with bills intact.

**Not included:** treating the 25 October workbook as current without reconciliation, or making every remaining generic balance appear physically verified.

### Phase 1 — Reliable purchase receipts and supplier ledger

**Goal:** let staff record each real delivery once and explain what is owed to each supplier.

**Work**

- Create a supplier record with a stable ID, display name, GSTIN/contact details when available, and optional aliases for spelling variations.
- Keep a purchase invoice's supplier name, invoice number, invoice date, received date (if different), tax totals, discount/charges, payment history and adjustment history.
- For every invoice line, preserve the **supplier's original item description** and separately map it to a **shop item/variant** after staff verify the physical garment and size.
- If an item is not in the shop catalogue, create/prepare its shop identity and barcode first; do not receive ambiguous stock into a guessed variant.
- Generate an internal receipt/batch ID automatically. Make the human-readable batch label optional, defaulting to a readable value such as `Supplier · Invoice No. · Date`.
- Record quantity, unit cost, selling price/MRP according to the approved price policy, HSN, tax, discount/charges allocation, and amount paid. Support part-payments and supplier credit clearly.
- Keep receipt costs immutable after stock has been sold; correct errors with an audited correction/return rather than rewriting cost history.
- Show a supplier statement: opening balance if one is explicitly entered, invoice charges, payments, returns/credits and closing amount due. Do not invent historical balances.
- Export a monthly purchase/invoice pack for the accountant, with the original invoice numbers and GST evidence that was actually entered.

**Done when**

- The same physical item received on two dates at different costs remains one shop identity when the approved price policy allows it, while each cost batch remains inspectable.
- A bill line with a vague supplier name can be traced to the exact shop item selected without losing the supplier's original words.
- Supplier outstanding balance equals recorded invoices and adjustments less recorded payments/refunds.
- Duplicate supplier invoice numbers are caught using supplier identity and invoice number.

**Accountant dependency:** confirm how tax, input tax credit (ITC), invoice rounding and eligible costs should appear in the accountant export. Until confirmed, show tax/ITC and tax-inclusive profit calculations as provisional; do not mark ITC claimed automatically.

### Phase 2 — Owner's Money Overview and practical finance learning

**Goal:** explain daily and monthly business health without requiring the owner to understand accounting jargon first.

**Proposed overview cards**

- **Sales turnover:** merchandise sales for the selected period, clearly stating whether GST is included and how discounts/returns are treated.
- **Money collected:** cash, UPI and other payment receipts, shown separately from sales billed and from change given/refunds.
- **Estimated cost of sold garments:** sourced from recorded purchase lots; disclose missing or provisional costs.
- **Gross profit:** net merchandise sales less estimated cost of goods sold. Show the calculation and label it provisional when cost/tax data is incomplete.
- **Shop expenses:** recorded operating expenses by category, with a link to the entries.
- **Operating result:** gross profit minus recorded operating expenses. Label it as an operational estimate, not final net profit or taxable income.
- **Supplier balances due:** amount based on recorded invoices, payments and supplier credits.
- **Stock position:** audited quantity and cost value only where stock/cost are trustworthy; keep legacy/unverified stock separate.

**Learning UX**

- Add a short plain-language explanation and a “How calculated” view to every finance figure.
- Give one concrete example in rupees, not accounting shorthand alone.
- Let the user open the bills, purchase lots or expense rows that make up a total.
- Teach distinctions such as turnover versus profit, gross profit versus operating result, and sale GST versus purchase GST/possible ITC.
- Label unavailable data as unavailable; never replace it with zero or a confident green status.

**Done when**

- The user can explain what each headline figure means and reconcile it to underlying records.
- A date filter changes every relevant card consistently.
- Refunds, exchanges, bill discounts, supplier credits and missing costs do not create unexplained jumps.
- The figures agree with accountant-reviewed examples before being treated as decision-grade.

### Phase 3 — Sales planning, restocking and promotion guardrails

**Goal:** turn reliable history into suggestions the owner can understand, edit and reject.

**Preserve existing forecast scope:** one to six upcoming months, sales forecasts, restocking directions, seasonal alerts and period/year comparisons. Improve accuracy and data labels without replacing this purpose.

**Restock suggestions**

- Suggest at the actual sellable variant/style and size level, not only a broad category.
- Use trusted on-hand quantity, recent net sales/returns, supplier lead time, owner-selected buffer and seasonality where evidence supports it.
- Show current stock basis, units sold, calculation, suggested quantity and confidence.
- Do not treat unverified legacy stock as a reliable on-hand balance; do not recommend an order from a zero or stale count without warning.
- Allow the owner to record supplier lead times and minimum order quantities only when they are known.

**Promotion and discount guardrails**

- Estimate the effect of a proposed discount using selling price, recorded cost, GST treatment and expected returns; show uncertainty if any input is missing.
- Let the owner choose a minimum acceptable gross-margin target with a simple explanation.
- Show the lowest safe selling price/maximum suggested discount and the rupee margin before and after the offer.
- Consider old/slow stock and season end only when the stock count and sale history are trusted.
- The app suggests; staff/owner approves. No automatic promotions or discount changes.

**Done when**

- Each recommendation can be reproduced from visible inputs.
- Forecast basis, training period, partial-month handling and comparison dates are explicit.
- Short or unreliable history produces a limitation message rather than false certainty.
- Suggestions distinguish “more revenue” from “more profit.”

### Phase 4 — Accountant-ready records and deeper reporting

**Goal:** reduce the monthly effort of preparing records while leaving accounting and tax filing under the accountant's review.

**Candidate reports after Phase 1/2 data quality is stable**

- Sales by day/month, payment method, item/category and discount.
- Purchase register by supplier, invoice date, HSN/tax and payment/balance.
- Stock movement and stock valuation, separating verified stock from unverified legacy quantities.
- Returns/exchanges with original sale reference and payment/credit treatment.
- Expense register with category and payment source.
- Exports in formats agreed with the accountant; include source references and totals that reconcile to the app.

**Explicitly deferred**

- Full chart of accounts, journal-entry editor, trial balance and balance sheet.
- Automated GST returns, ITC claims or legal/tax advice.
- Tally import/export unless the accountant confirms the required format and workflow.

These features require a written accounting model and accountant review. Do not add nominal accounting pages that produce unbalanced or misleading statements.

### Phase 5 — Customer tools, mobile billing and WhatsApp

**Goal:** preserve service during power cuts and communicate with customers only when the shop is ready to manage the data and consent.

**Mobile/offline billing design**

- Decide which devices may bill, who can sign in, and how local catalogues/prices/stock snapshots are refreshed.
- Assign each device a unique sale ID and use a collision-safe bill-number strategy. Clearly distinguish temporary/offline receipt IDs from final synchronized invoice numbers if necessary.
- Queue sales locally, prevent duplicate upload, retry safely, reconcile payment and stock movements exactly once, and surface conflicts for owner review.
- Define what the phone may sell when its last stock snapshot is stale or the main shop PC is off.
- Test power loss, app restart, offline duration, two-device transactions, receipt print/share and recovery before live deployment.

**WhatsApp/e-bill path**

- Start with a customer-approved phone number and a shareable digital bill/PDF; keep a paper/thermal option.
- Add automated WhatsApp messaging only after the provider, consent, opt-out and message-failure behavior are defined.
- Stock-update and promotion messages require an explicit opt-in and a simple way to stop messages. Do not auto-add customers to a group/channel.
- Keep bill sharing separate from marketing subscription.

**Customer profile/loyalty**

- Keep optional until the owner decides what to collect and how it improves service. Avoid adding phone/email fields to every walk-in checkout by default.

## 6. Features not planned for the current business stage

Do not build these unless the business need changes or the accountant/owner specifically asks:

- Multi-company, multi-branch, godown transfers and warehouse routing.
- Multiple currencies, cheque book management and loan accounts.
- B2B credit/debtor workflows, customer outstanding statements and collection reminders while the shop remains primarily walk-in B2C and does not offer customer credit.
- Estimates/quotations, proforma invoices, sales orders and delivery challans unless the shop begins taking orders or delivering goods in a way that needs them.
- Full accounting ledgers/journals and self-filed GST returns before the accountant specifies and approves the model.
- E-commerce, online store, paid ads, Google profile integrations and social marketing dashboards before the shop has chosen to operate those channels.
- Loyalty points, customer segmentation or bulk marketing before the shop has a consent-based customer data process.
- Card terminal support until the shop begins accepting card payments.
- AI that autonomously changes prices, posts purchases, pays suppliers, sends campaigns or files tax returns.

These may be valid future products. Deferring them keeps training, data entry and support manageable now.

## 7. Navigation and page organization recommendation

Use a compact expandable sidebar inspired by Vyapar's grouping, but tailor its labels and page count to this shop:

1. **Sell:** POS, Sales & Returns, Customers (only if useful).
2. **Stock & Purchases:** Stock, Products/Barcodes, Purchases, Suppliers.
3. **Money:** Owner Overview, Expenses, Cash Register, GST/Accountant Exports.
4. **Plan:** Sales Forecast, Restock Suggestions, Promotions (when available).
5. **Admin:** Users, Permissions, Activity, Settings, Backup/Restore.

Keep common **New Sale** and **New Purchase** actions visible where appropriate. Do not add a persistent feature button that allows editing an already completed sale without an explicit audited correction workflow.

## 8. Data definitions that the app must publish

Before a metric is used for a business decision, write down its source and formula. At minimum:

- **Billed turnover:** which sales statuses, dates, GST inclusion, discounts and returns are included.
- **Collections:** sum of completed payments by actual payment mode; not the same as sales turnover.
- **Goods cost:** cost layer method, purchase discount/charges allocation and tax/ITC treatment.
- **Gross profit and margin:** calculation and whether provisional costs are included.
- **Operating expenses/result:** categories included and exclusions such as owner withdrawals or capital purchases.
- **Supplier balance:** invoice and adjustment total less recorded payments and refunds.
- **Stock quantity/value:** whether physically verified, date/cutoff, cost basis and treatment of returns/damaged/held goods.
- **Forecast:** observed history window, selected forecast method, excluded/incomplete data and confidence/limitations.

Use Indian Rupees and Asia/Kolkata business dates consistently. Store monetary values safely in integer paise where the service model requires precision.

## 9. Cross-cutting quality and release gates

Every new financial or stock workflow should include:

- A stated owner/staff role and permission boundary.
- Validation for duplicate submissions, retries, stale edits and interrupted saves.
- An immutable audit trail for completed financial/stock actions; corrections should be explicit and linked to their originals.
- Clear loading, empty, error and retry states. A failed request must not look like “zero records.”
- A review/confirmation step for bulk imports, stock activation, financial corrections and irreversible actions, using the app's in-app dialogs/toasts (never native browser dialogs).
- Tests for calculation boundaries, permissions, persistence/restart, duplicate replay, rollback and UI states.
- A demo database isolated from the live shop data and cloud sync.
- A shop-PC backup and restore/update check before each installer rollout that changes data or the database schema.
- User-facing changelog updates at actual builds or milestones, not every individual edit.

## 10. Decisions to confirm before each relevant phase

These do not block documenting the roadmap, but they should be resolved when the phase reaches them:

1. **Supplier accounting:** supplier GST invoice requirements and ITC treatment, confirmed by the accountant.
2. **Batch/price identity:** whether a changed printed MRP on otherwise identical garments requires a separate barcode/variant, or whether the app should retain a stable barcode and capture MRP by received batch.
3. **Supplier data:** whether invoice PDFs/photos should be attached, or whether supplier, invoice number, line wording, HSN and totals are enough.
4. **Supplier credit:** whether existing old balances should be entered as a dated opening balance or tracked only for purchases recorded from the chosen start date.
5. **Mobile:** whether the phone will share the shop's live stock online, work fully offline, or create provisional receipts while the PC is unavailable.
6. **WhatsApp:** customer consent process and whether digital bills are manual share first or automated messaging.

## 11. Reference screenshots

The supplied screenshots are sufficient to define this high-level roadmap. No additional Vyapar screenshots are needed now.

If a future page is being designed against a specific workflow, screenshots of that exact page and its add/edit/detail dialogs would help. The most valuable candidates would be:

- A complete purchase invoice form and its supplier/item line detail.
- A supplier statement showing invoice, payment, return and balance history.
- The actual Profit & Loss report with its date filter and drill-down.
- A stock item detail/movement view and its barcode/variant setup.
- The mobile POS offline/sync flow, if you want to evaluate that workflow.

Treat future screenshots as reference material, not as instructions to copy every visible feature. Confirm the shop need and accounting behavior before implementation.

## 12. Immediate next work

1. Reconcile the latest stock-audit counts to sales after the count date or arrange a fresh count at the real cutover.
2. Resolve the barcode/MRP policy and supplier line-description gap before recording large volumes of real purchase invoices.
3. Ask the accountant how purchase GST/possible ITC should be represented in reports and exports.
4. Validate a small real purchase and supplier balance using an isolated development copy, then confirm against the supplier invoice.
5. Only after those inputs, promote the data-quality work into the next development milestone.

