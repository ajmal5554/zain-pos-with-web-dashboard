# Excel stock audit upload

Version 3.0.16, 14 October 2026. Replaces the Neon Audit connection at the owner's request. The Settings connection card, automatic remote pulls, Neon IPC bridge and driver dependency have been removed. This feature never contacts or changes Neon.

## Use in the desktop app

1. Open **Stock → Excel Audit** with inventory permission.
2. Choose an `.xlsx` or `.xls` audit workbook, up to 10 MiB, then click **Review Excel file**.
3. Review the file and worksheet, number of rows, total counted pieces, missing counts and sample rows. This is a preview; nothing is saved yet.
4. Confirm the upload in the app. It replaces the **entire previous audit inbox** on this computer. It does not append quantities or merge files.
5. Search and page through the saved audit rows. Upload a newer complete workbook when counts change. The saved review remains available offline and after restarting the app.

## Workbook format

The owner's export has a **Stock Audit** worksheet with a header row and one row per audited item. Its **Summary** worksheet is not imported as item data.

Supported details include ID, Category, Brand, Size, Quantity, MRP, Subtype, Pattern, Fabric, Collar, Pocket, Sleeve, Fit, Color, Border and Last Updated. A product Name column can supply the display name; otherwise Category supplies it. Colour is optional. Source IDs and row numbers keep repeated names distinct. Rows are never matched to shop products by name or price.

Counts must be nonnegative whole numbers. A blank count stays **Not counted**, while a numeric zero remains zero. Prices, when supplied, must be valid nonnegative numbers. Formula cells in imported fields must be converted to values before uploading. Duplicate explicit IDs, ambiguous worksheets/headers, malformed rows or excessive files reject the upload instead of silently dropping data. Files without source IDs receive row-based review IDs with a preview warning; those are not POS variant IDs.

Only supported public item fields are retained. Purchase costs, free-form notes, summary totals and unrelated columns are not imported. Source last-updated text is preserved without guessing a timezone. The upload time records when the file was saved in POS; it does not establish when stock was physically counted.

## Boundaries and storage

- Uploads are audit observations for review. They do not change live products, barcodes, quantities, stock movements, bills, refunds, cash, prepared variants or count drafts.
- Sales do not reduce the uploaded counts. Before future stock posting, counts still need reconciliation and physical checks on the shop PC.
- The upload preview is tied to the authenticated user and window and expires after ten minutes. If the saved inbox changes after preview, choose the workbook again and review a fresh preview.
- Reuploading identical file bytes does not duplicate rows. Another file replaces the whole inbox after confirmation. Failed parsing or atomic saving preserves the previous saved snapshot.
- The main process validates and parses the workbook, then stores the review in a separate `excel-audit.json` file under Electron's user-data directory. It never writes these rows to the POS database.
- Inventory permission is checked in the main process for every read, preview and import. Browser preview does not persist uploads; use the desktop app.
- The review snapshot is local to each computer and is not included in existing POS database backups or cloud sync. Keep the original workbook and upload it on the shop PC after installing the updated app.
- Unreadable saved audit data is preserved and reported. A reviewed replacement upload can recover the inbox without affecting billing.

## Verification

Run `npm run test:excel-audit`, `npm run typecheck` and `npm run verify:smoke`. Tests use generated in-memory workbooks and temporary files, with no remote database or live POS access. Set `EXCEL_AUDIT_TEST_FILE` to the original October 8 audit workbook path to run its expected 110-row / 498-piece reconciliation and temporary import/restart check without importing into the installed app.

Verified on 14 October 2026: 43 Excel upload checks passed, including the original workbook's temporary import and restart; 178 existing catalogue/stock/draft/refund/cash checks passed, with one existing physical-printer-related skip. TypeScript, release smoke checks and renderer/main/preload production bundles passed. No installer was built or deployed, and the original workbook was not edited.

The owner should check a few known rows, including two items with the same category and price but different sizes or fabrics; confirm blank versus zero counts; cancel a preview; upload a newer complete file; and reopen the app. Live Stock Overview and Count Drafts must retain their existing quantities and records.
