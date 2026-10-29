# Rack audit reference analysis and implementation — 3.0.27

## Reference inspected (read only)

Source: C:\Users\admin\OneDrive\Desktop\zain stock

- src/app/audit/page.tsx: category selection, category-scoped brands, attributes assembled from setup and harvested item values, size-scale selection, size counters, custom values, keep-style checkbox and locally remembered unfinished entries.
- src/app/settings/page.tsx and src/lib/store-defaults.ts: configurable category groups, options, custom attribute types, brands and named size scales. Empty saved groups must stay configurable rather than requiring shirt fields for every category.
- src/app/api/settings/route.ts: durable setup, optimistic UI caches and harvesting suggestions from existing items.
- src/app/api/products/route.ts and src/app/api/variants/route.ts: rack additions and absolute quantity corrections.
- src/app/inventory/page.tsx and src/app/api/export/route.ts: grouped styles versus size entries, attribute tags, filters, sorting, inline counters and flattened export.

## Why the previous POS entry was insufficient

Free-text attribute cells do not offer the category-guided chip workflow. A fixed set of garment fields prevents adding a new attribute type. Treating every rack entry as a new product duplicates identical stock; treating a readable name as an identity merges different garments. A plain quantity overwrite can lose a sale made while an editor is open.

## Implemented POS behavior

Stock retains three tabs. Add manually now opens Rack audit; the earlier table-based manual form is no longer used by Stock. Excel upload retains its editable review and direct-save behavior.

Rack audit displays category buttons, category-specific brand suggestions, configurable attribute groups/options, price suggestions from existing stock, optional readable name and batch/rack name, named size scales and editable quantity counters. All configured groups are category-specific. Unknown new categories receive a small starter template that can be customized. Custom option/brand/size additions are saved immediately through an in-app modal. Customize categories & attributes edits group labels/options and size scales, adds categories and custom attribute types, and removes configuration options without deleting inventory.

The form remembers unfinished entry per signed-in user on this device. Saving clears counts and optionally retains the style and price. An uncertain stock request retains its operation ID and blocks altered retries. Switching category with counted pieces requires saving or clearing them first. Size-scale switching retains any already entered counts.

StockAuditSetup and StockAuditSetupOperation are additive SQLite sidecars. Setup reads do not create tables; saves check active inventory permission, validate all values, use a revision check, record the operator, and replay a repeated request safely. Concurrent setup edits require a reload instead of overwriting each other.

Custom attribute keys are bounded and namespaced. Stock item metadata stores their values and readable labels. Inventory exposes only approved attributes/custom keys, never arbitrary private metadata. Available attribute values can be filtered, including collar, pocket, sleeve, fit, color, border and custom types.

Manual rack entries opt into complete-identity matching: actual category ID, normalized brand, size, MRP and every non-empty saved attribute. Readable names, batch names, source IDs and display labels do not define identity. Multiple exact matches are treated as ambiguous and require selecting the barcode in Inventory. An existing exact match gets an additive receipt using its current balance under the writer lock. New sizes in the same save share a Product/style, with separate variant barcodes. Excel rows continue to retain source identity and do not automatically merge.

Inventory quick counters perform guarded recount corrections with signed movements and an automatic reason. They are not receipts or sale buttons. An intervening stock change rejects the stale correction; an uncertain reply retries the same request. The existing Edit count form remains available for explicit recounts, receipts, removals and reasons.

## Deliberate safeguards compared with the reference

The reference product POST compares only selected fields and notes, then enriches some missing metadata. That can merge garments whose collars/pockets/custom fields differ. The POS compares the entire known attribute set. The reference quantity PATCH assigns a total without checking an earlier balance; the POS protects against intervening sales. The reference deletion endpoints physically delete variants/products; this was not copied into POS stock because existing bills and movement history refer to stable IDs. Product catalogue edits and labels remain in Products.

Default category-specific suggestions are starter values, not a copy of the audit database's live settings. The reference app and its database were not modified or connected. Its private environment files were not read. POS users can customize and persist their own values.

## Validation

Disposable SQLite tests cover setup persistence, custom types/scales, permissions, stale setup rejection, request replay, full-attribute matching, matching barcode reuse, different custom values remaining separate, size grouping, inventory exposure, stale recounts and unchanged generic stock. Component tests exercise category changes, option creation, multiple size counts, keep-style behavior, setup editing and uncertain quick-count retry. Existing sale/refund/exchange protections remain covered by the regression suite.
