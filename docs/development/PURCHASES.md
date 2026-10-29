# Purchases, corrections and supplier returns — 3.0.37

Purchases records new supplier invoices from the start of this workflow. Opening audit quantities are not purchase invoices and do not invent costs or supplier debt.

## Daily workflow

1. For a new garment, open Stock → Add manually, enable **Create item codes only**, select attributes and sizes and save with zero opening stock. Existing audited items can be selected directly.
2. Open Purchases → New purchase. Enter supplier, supplier invoice number/date and a delivery/batch name.
3. Find each audited barcode, enter quantity received, invoice rate per piece before GST, selling price and MRP. Up to 100 lines per invoice. Generic/untracked catalogue items are intentionally excluded.
4. Enter invoice discount, charges before GST, the printed CGST/SGST or IGST amounts, signed round-off and amount already paid. ITC remains pending accountant review. Earlier restored drafts retain their inclusive-cost format.
5. Confirm once. The invoice, receipt lines, stock quantities, movements and initial payment commit in one SQLite transaction. Do not also add these quantities in Stock.
6. Search purchase history by supplier, invoice or batch. Totals cover all matching invoices, not only the displayed page. View the invoice for individual batch costs and subsequent payments. Print new price-batch labels from Products.

## Identity and costs

- Same selected barcode and same selling price/MRP: stock is added to that barcode. The receipt retains its own cost even if earlier deliveries cost differently.
- Changed selling price or MRP: create a new six-digit barcode under the same product, clone garment attributes, and receive only the new quantity there. Previous quantities/prices stay unchanged.
- Costs, quantity received, item description, barcode and prices are immutable invoice snapshots. Catalogue `costPrice` is not overwritten with the newest receipt cost.
- Invoice discount and charges are allocated by pre-discount line value using cumulative rounded integer paise. Allocated line totals sum exactly to the invoice total.
- New receipts now maintain cost lots used by FIFO sale allocation and original-cost restoration during returns. See STOCK_COSTS.md for capture coverage and transaction rules. Earlier stock and opening costs remain unknown. The provisional Profit page uses captured costs and clearly marks missing coverage; catalogue cost must not substitute for captured costs. GST-adjusted profit and comprehensive inventory-loss accounting still require review.
- Originals are not overwritten or deleted. Corrections, cancellations and supplier returns are dated, reasoned audit entries. Supplier invoice numbers are case-insensitively unique per supplier; include a financial-year prefix where suppliers reuse numbers. Cancelling an invoice releases its lookup key for an explicitly entered replacement while keeping the cancelled record.

## Correcting and returning purchases

Open Purchases → View / Pay:

- **Correct invoice:** change quantities, unit costs, invoice details, discount or charges. Quantities replace the recorded quantities; stock changes only by the difference. Prices/barcodes remain unchanged. The original and each replacement snapshot remain visible. Once receipt units have been consumed, quantity/cost corrections cannot rewrite that batch. A quantity of zero removes that line economically, but its historical identity is retained. To replace a garment, cancel and enter a replacement invoice.
- **Return goods:** choose quantities from the invoice and the actual supplier credit agreed. The form suggests the proportional landed cost, but the supplier may retain freight or agree a different credit. Saved returns reduce stock and invoice value without inventing a cash receipt. Returned quantity cannot exceed the invoice quantity minus previous returns or available physical stock.
- **Cancel purchase:** reverse all remaining unreturned quantities and remaining invoice value. Prior returns and payments stay in history. Enough stock must be available in the selected receipt batch; otherwise the whole action fails without partial changes.
- **Record refund received:** record money already received, capped by the amount the supplier owes on this invoice. Refunds are negative payment-ledger entries with a reason/reference. They do not return more stock. Refunds into today's open drawer create one linked CASH_IN; UPI, bank or personal cash do not change drawer cash.

After returns, correction is disabled: cancel the remainder and enter a replacement invoice. A supplier with payment history cannot be reassigned; cancel and settle the supplier refund before entering another supplier's invoice. These rules avoid silently moving existing payments or rewriting return bases.

Invoice totals are net of corrections/credits. Payable balances and supplier refunds due are reported separately rather than hiding one inside a negative payable. Refunds due stay attached to their invoice. Applying an overpayment/credit from one invoice to a different invoice is not part of this release. Payment-entry edits and reversal of an already saved correction/return are also not included.

## Payments and access

UPI, bank transfer, shop cash drawer and personal cash are supported. These record payments already made; they do not transfer money. Partial payments and later invoice-specific payments reduce the outstanding balance; overpayment is rejected under the database writer lock.

Shop cash requires today's open register and register permission. It creates a linked CASH_OUT transaction in the same transaction as the supplier payment (or CASH_IN for a refund received). Purchase mutations share the register operation queue with register closure. Linked cash entries cannot be deleted through the register. Personal cash does not affect the shop drawer.

Fresh trusted Electron session and inventory permission are required at IPC entry. The service additionally requires active inventory + cost-price permissions (or admin). Main-process checks do not trust renderer user IDs. Purchase tables are local SQLite sidecars; cloud-dashboard purchase reporting/sync is not included.

## Retry safety

Purchase and payment requests use durable operation IDs, operator IDs and normalized payload hashes. Exact retries return the saved result. Changed-content reuse fails. Drafts and unresolved requests are remembered per signed-in user on this device. Uncertain requests freeze edits until retried. Confirmed transaction rejection unlocks the form. Supplier/invoice duplicate detection also prevents resubmitting under a fresh operation ID.

## Invoice GST capture (3.0.37)

New forms use item rates BEFORE GST. Enter the exact invoice CGST/SGST or IGST amounts, an optional supplier GSTIN, optional line HSN (4/6/8 digits), and signed round-off within ±₹1. No current/historical GST percentage is assumed or automatically applied. CGST/SGST cannot be combined with IGST. ITC is fixed to PENDING; this records evidence, not a claim or confirmed eligibility. Invoice charges are entered before GST; the entered tax amounts cover the invoice as printed.

Supplier total = sum(quantity × pre-GST rate) − invoice discount + pre-GST charges + entered GST + signed round-off. Taxable value is the pre-tax balance. Supplier payments and due balances use the complete rounded total. Pending review, all entered GST and round-off remain part of provisional receipt costs, allocated by item value with exact paise conservation. No earlier sale cost is repriced or claimed ITC deducted.

Original tax evidence lives in PurchaseTaxInvoice and HSN in PurchaseTaxLine, saved atomically with the purchase. Corrections require the GST breakdown if already present and preserve the original tax snapshot while saving revised values in adjustment history. The existing consumed-lot correction guard still applies. Supplier return/cancel credits change invoice balances but do not automatically calculate a tax credit note; detail clearly labels GST as the breakdown before supplier credits. ITC confirmation, HSN-wise tax allocation, credit-note tax reconciliation and purchase GST-return export remain outside this milestone.

Earlier purchases and restored requests without a tax object retain their tax-inclusive interpretation and original normalized request hash. They are not automatically converted. New data does not change existing catalogue barcodes for cost-only receipts.

Tests reproduce the uploaded Mamta (₹52,479), Crazy Heart (₹12,285) and Rajdhani (₹68,210, including −₹0.10 round-off) totals in disposable databases. The photographs are examples only; no historic invoice or stock was imported.

## Verification

`node --test scripts/purchase-adjustments.test.cjs scripts/purchases-flow.test.cjs scripts/purchases.test.cjs scripts/purchases-ui.test.cjs scripts/stock-entry-ui.test.cjs`

Integration tests create disposable SQLite databases from the generated runtime schema. They cover cost and price preservation, attribute cloning, atomic rollback, duplicate invoices, operation replay, overpayment, cash linkage, permissions, invoice validation and paise allocation. UI tests cover unresolved-save recovery and bridge result classification. Browser QA uses mocked APIs with no connection to the development or shop database.

The application-flow regression test connects the actual renderer purchase service, actual preload bridge, extracted production IPC handlers, fresh-session permission checks and production purchase service to disposable SQLite. Only Electron transport is simulated. It verifies five-piece receipts, a cost-only change from ₹450 to ₹480, a selling-price change from ₹700 to ₹750, partial-payment replay, lost replies after committed saves, duplicate invoices, database reconnect and permission revocation. It also sends corrections, supplier returns, cancellations and refunds through the actual secured channels, including lost correction/refund replies after database commit. This is not a packaged-Electron or physical-printer test. No production inventory is used.

Adjustment tests cover atomic quantity rollback, original preservation, agreed supplier credit, negative payment-ledger refunds, protected drawer cash-in, cancellation and invoice-key reuse, stale revision rejection, permissions and over-return/over-refund limits. UI tests cover selected return quantities, correction inputs, explicit confirmation and persistent retry of unresolved requests. Browser QA covers the supplier-return dialog and the resulting invoice and refund-due balances using isolated mock data.

