# Sale-time batch costs — 3.0.33

## Scope

This release records cost allocations at checkout and maintains them during saved-sale edits, refunds, exchanges and voids. It does not build a profit report, calculate tax credits or retroactively assign costs to earlier sales.

Sales History → expand a bill shows **Recorded batch costs** to admins or users with both sales-view and cost-price permissions. Unknown costs explicitly say **Profit unavailable**. Net costs for held returns are shown separately so a later profit report cannot silently treat damaged goods as recovered saleable inventory.

## Receipt batches

- New purchase receipts create a cost lot tied to the receipt line. Its cost is the immutable landed line cost after allocated invoice discount/charges, in integer paise.
- FIFO follows the order receipts entered stock, not the supplier's invoice date or the product's current cost/price. Different price barcodes remain separate stock identities.
- Partial allocations round to paise and leave the remainder on the batch. Partial returns use cumulative rounding of the original allocation so complete reversals recover exactly its original cost.
- Later receipts never update an earlier allocation. A price/discount/payment-only sale edit does not change its captured costs.

## Existing and manually adjusted stock

The first use of a variant establishes its existing physical stock as unknown cost. This includes opening audit counts and stock from purchases entered before cost tracking. The app does not reconstruct an uncertain history from today's catalogue cost. Earlier sales remain Not captured; editing an earlier sale preserves its pre-existing quantity as unknown, while any additional quantity can consume available new receipt lots.

Before a costed mutation, lot quantities reconcile with physical stock. Unexplained additions become unknown-cost lots. Unexplained reductions remove unknown units first, then known FIFO units, recording the cost/quantity change in StockCostChange. They never reprice units already sold. Separate inventory-loss accounting and the Profit page remain future work.

Generic old barcodes retain their existing ability to bill into negative stock. The uncovered quantity is captured as unknown cost, not a fictitious known-cost purchase. Tracked overselling remains blocked by the existing stock guard.

## Stock-changing sale operations

- **Checkout:** aggregate duplicate variant rows and allocate once before physical decrements.
- **Saved-sale edit:** retain existing allocation for unchanged quantities; increases consume the next FIFO pieces; decreases release the latest allocation pieces back at their exact captured cost. Allocations use sale + variant identity because the existing editor replaces SaleItem rows.
- **Refund:** restore the returned quantity from the original sale allocation. A retry cannot restore it twice.
- **Exchange:** prepare all affected variants, restore original costs, then allocate the replacement sale before the existing physical stock movements. This supports a same-barcode size/direct swap and a replacement funded solely by exchange credit.
- **Void:** release all remaining allocations back to stock. Existing void/return restrictions remain in force.
- **Held return:** release sold cost into a separate restoration record without adding a saleable cost lot. Its cost is available for later inventory-loss accounting.
- **Legacy return mapped to a new tracked barcode:** its new physical lot remains unknown; the app cannot infer an old cost from the chosen destination barcode.

## Supplier corrections and returns

Purchase corrections update unconsumed cost lots in the same transaction as invoice and stock corrections. Once part of a batch is consumed or removed, its quantity/cost cannot be rewritten. Metadata-only corrections that keep quantity and landed cost unchanged remain possible. A completely reversed allocation retains its old snapshot; if all original lot units are back, a subsequent whole-lot correction can set the remaining inventory's cost without changing that earlier snapshot.

Supplier returns/cancellations consume unsold units from the selected receipt lot, even if other deliveries of the same barcode have stock. For older purchases with no receipt lot, only available unknown-cost units may be reversed. Purchase detail exposes this batch's remaining quantity for the return form.

## Storage and access

Additive local SQLite tables: StockCostLot, StockCostCoverage, StockCostAllocation, StockCostRestoration, StockCostReturn, StockCostChange. Initialization and all cost mutations occur inside the same transaction as their stock/financial operation; rollback leaves no partial cost allocation. No Prisma regeneration or replacement of the shop database is required.

`sales:getCosts` uses the trusted Electron session and checks active sales-view plus cost-price permission (admin bypass). The read does not create tables or guess missing historical costs. Cost tables are local; cloud-dashboard cost/profit sync is not included.

## Verification

`node --test scripts/stock-cost.test.cjs scripts/stock-cost-ui.test.cjs`

The integration suite executes extracted production checkout, edit, refund, exchange and void handlers with production purchase services against disposable SQLite databases. It verifies mixed receipt costs, unchanged historical costs, exact paise conservation, unknown opening stock, negative legacy stock, held returns, supplier-batch protection, recount reconciliation and rollback. UI tests verify permission changes, historical/unknown labels, refresh and failure/retry behavior. These tests do not open the live POS database or represent a packaged-EXE/printer test.
