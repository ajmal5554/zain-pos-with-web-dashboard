# Opening stock and inventory development plan

Updated: 1 October 2026. Status: planning; this document has not changed application stock quantities or the existing catalogue.

## Agreed shop requirements

- One B2C shop. Physical stock has not yet been counted.
- Track stock by size, fabric/quality, and design (such as checks, plain, or print).
- Do not require colour for stock tracking.
- Assign a separate barcode to each sellable combination. Pieces of the same combination share its barcode.
- Keep scanning fast: a barcode identifies the combination without requiring staff to select attributes during every sale.
- The complete attribute list is still being discovered. Do not require the owner to finalize it before development begins.
- Development, testing, and real opening-stock preparation happen on the owner's personal laptop. Keep the real count session distinct from test data. After tests pass, an EXE installer updates the shop PC, and a separate product/count file transfers the prepared catalogue and reconciled stock. The shop's live sales database remains authoritative.

Example: Shirt / Cotton / Checks / M has one barcode and quantity; Shirt / Cotton / Checks / L has another.

## Flexible product setup

Configure attributes by category instead of enforcing the same fields across all products. Size can use the shop's existing labels or numbers. Keep fabric, quality, and design as distinct attributes where the owner needs that distinction; their precise values remain to be confirmed.

Start with these attributes and allow optional attributes and choices to be added later. Use consistent saved choices to avoid accidental duplicates caused by spelling differences. Make fields required only when they are needed to distinguish stock in that category.

A barcode belongs to a stable variant record. Changing its price or correcting its description must not issue a new barcode or rewrite old bills. A physically different combination receives its own variant and barcode. Do not recycle a barcode already linked to sales.

Edit variants by their stable IDs rather than their position in a list. Keep attribute fields consistent across the local database, cloud database, and synchronization. Show the same variant description in product setup, billing, exchanges, and labels; preserve the description saved on historical sale items.

Adding an optional description later should not lose quantities or transaction history. If an added attribute divides existing stock into multiple combinations, explicitly allocate/recount those pieces before activating the new combinations; do not duplicate the existing quantity across them.

## Current application foundation

The application has categories, product variants, sizes, colours, per-variant barcodes, stock, and cost prices. Local sale, exchange, refund, and void handlers update stock and record movements.

The desktop product editor currently exposes only the first existing variant when editing, and its stock field directly overwrites the quantity. There is no dedicated physical stock-count workflow or purchase-invoice entry. These require work before the first opening count is treated as reliable inventory.

## Development order

0. **Safe app updates:** verify upgrading against a disposable copy of the shop database preserves existing and newly recorded bills. Address the current packaged-app startup behavior that can restore a nonempty database simply because a backup file has a newer filesystem timestamp. An update must not silently replace the live database with a development database or backup.
1. **Product and attribute setup:** support all variants in the desktop editor, category-specific attributes, unique combination validation, barcode creation, and labels. Preserve current product IDs, existing barcodes, and old bills while preparing the catalogue.
2. **Opening stock count and transfer:** prepare real counts on the laptop, retain the original physical counts and subsequent adjustments, and export the reconciled product/count file. On the shop PC, preview and import the new details and absolute quantities with dated stock-adjustment and audit records. Zero is an explicit count; an uncounted item must remain distinguishable from zero.
3. **Stock maintenance:** verify normal sales, edits, refunds, exchanges, and voids against counted stock. Provide controlled adjustments with a reason. Define insufficient-stock handling when the counted inventory becomes active.
4. **Goods receipts and purchases:** enter incoming quantities, purchase costs, supplier invoices, credit balances, and supplier payments.
5. **Profit and planning:** establish reliable costs and stock first, then develop profit reports, purchase suggestions, promotion planning, and sales forecasting.

## First count procedure

The owner prefers to record real physical counts on the personal laptop while the shop PC continues billing. Maintain a real count session separate from development/test transactions. Updating the EXE is a software update; transferring the catalogue and stock file is a separate step.

Prepare and test a small set of real product combinations before labelling and counting the whole shop. Count one group at a time, briefly holding sales and other physical movements for that group. Finish or reconcile pending customer selections before capturing its original count and count time. The remainder of the shop can continue trading.

After a group's count, record every subsequent physical movement against the exact size/fabric/design combination on the laptop. Keep the original count unchanged and use a separate adjustment ledger to derive the current quantity. Include sales, quantity edits, resalable returns/exchanges, voids, incoming goods, and adjustments. Only deduct movements occurring after that group's count, and record each once. For example, 20 counted followed by 3 sold produces a prepared balance of 17.

Sales using an old generic barcode such as Shirt 700 cannot identify which newly separated size/fabric/design left the shop. While the shop still uses those barcodes, staff must identify the sold combinations for the laptop adjustment ledger. Where reliable notes are not practical, recount the affected combinations at the final cutover. Automatic reconciliation requires mapped variant barcodes and a reliable shop movement checkpoint; invoice dates alone are insufficient.

At cutover, briefly pause billing and physical stock movement, preferably after closing. Reconcile the laptop session through the agreed final cutoff, export, preview/import on the shop PC, verify a few sample variants, and then resume billing using the new barcodes.

Import the prepared quantity as an absolute opening balance. Do not add it to the existing negative balances. Do not deduct the same shop sales again: if the laptop already reduced 20 to 17, the quantity imported at that cutoff is 17. Preserve old bills and record the balance change as an opening-stock adjustment.

Verify that scanning each new barcode selects the correct combination, a sale decreases only that combination, a resalable return restores the correct combination, and an exchange updates both returned and replacement stock once.

## Product and stock file transfer

Provide a dedicated CSV or Excel transfer keyed by unique barcodes and existing stable variant IDs where available. Include size, fabric/quality, design, category, relevant prices, the reconciled stock quantity, and the agreed reconciliation cutoff/session identifier. Preserve barcode text exactly. New combinations receive new variants; matched combinations retain their existing identity.

Preview matched, new, invalid, and duplicate rows before applying. Import catalogue/count changes atomically, audit stock adjustments, and prevent applying the same count session twice. Preserve the shop's current prices unless their replacement is explicitly part of the reviewed product import. If billing continues after the file's cutoff, reconcile those later movements once before import or create a fresh file at the actual cutover.

Current product imports skip existing barcodes and do not reconcile intervening sales; they are not an opening-stock count importer. Do not copy the laptop's pos.db over the shop database or restore a development backup to transfer counts. Preserve the shop's live sales, customers, cash records, and variant IDs.

## Notebook alternative and gradual barcode transition

The owner is also considering recording counts in a book and entering them on the shop PC once the updated version is ready. For that option, use a gradual cutover rather than one early whole-shop count followed by weeks of manual reconciliation.

1. Prepare product categories and useful attribute choices now. A notebook line can identify the existing item/price group, size, fabric/quality, design, quantity, and count date/time. Earlier quantity notes remain provisional until reconciled or recounted at cutover.
2. Test the new product setup, count entry, label printing, and legacy-return handling on the laptop. Verify update preservation, then install the tested version on the shop PC after closing.
3. Pick one manageable complete legacy barcode group, such as all Shirt 700 stock. Prepare its new combinations and barcodes. Count all physical pieces in that group after closing, including storage/display stock, and write the counts by combination.
4. Enter and review that fresh count on the shop PC, print the required copies of each combination's label, and label its pieces. Cover/remove the old shop barcode on converted pieces. Verify that every combination scans correctly before saving the group's opening-stock baseline and allowing sales to resume.
5. Retire the converted group's generic barcode for new sales once all its pieces are converted. Keep its database record and historic bills. Other groups continue using their current barcodes until their own cutover; distinguish counted variants from uncounted legacy stock in inventory views.
6. Repeat with another complete group on another evening. The whole shop does not need relabelling in one session. From each group's activation onward, its new barcode sales reduce the new variant's stock.

All physically identical pieces in a combination share one barcode. Changing size, fabric/quality, or design creates a different combination and barcode. Labeling a group must not duplicate its quantities under both old and new variants.

Legacy bills need explicit return-stock mapping: identify the physical returned piece's new combination while preserving the original bill, refund/exchange value, and returned-quantity limits. Current refund/exchange handlers restock the original generic variant automatically, so that support is a release prerequisite for converted stock. Do not delete old variants or rewrite old bills to solve the mapping.

## Choices still to confirm during product setup

- Category names and their size conventions.
- Which fabric, quality, and design choices are actually useful to the shop.
- Which attributes are necessary to distinguish combinations within each category.
- How existing price-based products and their labels should be mapped to counted variants.

These choices can be refined using a few sample products; a complete attribute list is not needed immediately.
