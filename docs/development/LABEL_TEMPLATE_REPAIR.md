# Sticker layout and designer repair — 3.0.29

History check confirmed the original order: shop name, product name, barcode, readable code, price. The development database's saved LABEL_LAYOUT had only IDs 1,2,3,5; ID 4 was absent. The saved calibration was 40 × 26 mm at 70%, so the repair preserves those existing values instead of resetting physical printer settings.

The recognizable four-block original template is normalized on load by inserting a dynamic product_code row after the barcode. The original fixed sample text row (ID 4, text 4649350) also becomes a dynamic code. Unrelated custom text and custom layouts remain intact. Loading does not write settings; Save Layout persists the reviewed result.

Designer and print-modal previews share LabelStickerPreview and labelTemplate types/defaults. Both show real CODE128 bars with the same quiet margin, actual label dimensions, 1 mm padding, font units, single-line text and configured content scale. Printing uses the same dimensions and barcode settings. The designer identifies its product/code as sample data; actual labels use the saved selected variant's barcode/SKU unchanged, including leading zeros.

Added Product Code to Add Elements, spacer-height editing, missing-code repair control, vertical-overflow warnings and an explicit Fit content to height action. The fit operation changes content scale only when clicked. Reset Layout restores elements while keeping printer calibration. Preview row-gap is labelled separately because actual one-row print-job feed/gap is controlled by the printer driver. The printable width calculation excludes an extra trailing gap and includes the left margin.

Template imports are limited to 1 MB and validated for element IDs/types/styles and calibration bounds before applying. Notifications use in-app toasts. Failed setting reads prevent edits/saves from replacing unknown saved settings. Stale reads and imports are discarded. Layout/calibration saves go through an authenticated main-process endpoint and one SQLite transaction, with stale-value checks and harmless retries when both values already match.

Validation includes pure template repair/validation/clipping tests, real designer-load/save callback tests, a disposable SQLite atomic-save/rollback/stale-write test, existing printer-job generation tests and an isolated browser preview with no real database or printer connection. Physical thermal alignment/scanner testing still requires a test label on the shop printer.
