# Stock — 3.0.27

The owner's current workflow replaces the earlier prepare/count/label/activate wizard.

## Three tabs

- **Inventory:** only the new explicitly tracked stock, with attributes, size, barcode, batch name, quantities and movement history. Traditional generic items remain in Products and POS.
- **Add manually:** rack audit with category buttons, brand suggestions, selectable attribute options, custom groups and size scales. Count several sizes and save; optionally keep the style for the next rack. Customize categories & attributes manages the saved configuration. See RACK_AUDIT_IMPLEMENTATION.md for the source analysis and matching rules.
- **Excel upload:** choose the audit app workbook, review and edit the rows, optionally change the batch name, then Save stock to inventory. Uploading the workbook alone saves only a source snapshot. The final save creates the products, short barcodes, tracked balances and movements atomically. Previously saved rows are skipped. Earlier unfinished setup rows reuse their existing barcode when finished here.

There is no mandatory draft tab, product-page stock entry or label activation checklist. Products edits catalogue details and prints labels; Stock owns quantities. New entries use the existing 5% tax default and MRP as initial selling price; review pricing/tax in Products where needed. Missing costs remain unknown/zero under the existing catalogue convention; MRP valuation is not profit.

## Identity and editing

Names are readable labels, never merge keys. Two rows named Crazy Heart Plain - XL may represent cotton/single pocket and linen/double pocket garments and receive distinct barcodes. Excel rows stay separate by source identity. Manual rack entries reuse a barcode only when the full category, brand, size, MRP and complete attribute set match; different attributes stay separate. To receive more pieces of an existing barcode, use its stock adjustment and select Stock received rather than recreating the item.

Inventory's **Edit count** opens a physical recount by default. Enter the actual total and a reason. A fresh balance is read and the save rejects if another sale or adjustment changed that balance. Stock received adds pieces; damaged/removed subtracts pieces. Every change has an operator, reason and signed movement. Original sales remain unchanged.

Batch names are optional on screen, with a date/file-based fallback, and persist in StockEntryBatch, item metadata and initial movement descriptions. Counts can change after import without changing the barcode or re-importing the workbook. Repeated successful requests replay the original result. An uncertain save locks its input and retries the same operation ID.

## Imports and operating transition

Supported files: audit app .xlsx/.xls export, up to 10 MB and 1,000 stock rows per entry (split larger workbooks). Category, positive MRP and a non-negative whole count are required for each saved row. Blank counts block saving; zero is a valid out-of-stock item. All rows must be reviewed before the single final save. Source IDs prevent importing the same exported rows again; source validation happens in the authenticated main process. Names, quantities and attributes may deliberately be edited in the preview.

The new stock is billable immediately after saving. Print/apply its new labels through Products and bill those pieces using the new barcode. Sales through an old generic barcode cannot identify which new garment was sold. Keep newly counted batches distinguishable while relabelling and correct any intervening sales before relying on the count. Old generic records and historical bills are preserved.

Installers update application code, not inventory data. Upload the workbook and save the reviewed counts on the shop PC; test entries on the personal laptop do not automatically migrate there.

## Validation

Run npm run typecheck, npm run test:inventory, npm run test:stock, npm run test:excel-audit and npm run verify:smoke. stock-entry.test.cjs uses a disposable SQLite database for direct entries, attribute identity, short barcodes, batch persistence, replay, edited Excel counts, zero counts, unfinished-entry recovery, stale recounts, rollback and untouched generic stock. stock-entry-ui.test.cjs exercises the real entry component for manual input, editable Excel previews and lost-response retry.
