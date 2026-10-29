# ST-02A: simple product names, category fields and small labels

Version: 1.1, 9 October 2026. Status: deferred by the owner; not implemented by this document. The current next task is ST-03A stock-count drafts in `STOCK_PAGE_PRD.md`.

Read with `README.md`, `STOCK_PAGE_PRD.md`, `ST02_REVIEW_FIXES.md` and the current `AGENTS.md`. ST-02 and its review fixes already exist. This is a focused follow-up, not permission to rebuild the catalogue or start stock conversion. Where the original ST-02 requires a full garment description on a sticker, this document replaces that presentation requirement with a compact sticker title. Keep full readable details in the app.

## Outcome

The owner can prepare distinct garments under familiar names such as **Shirt**, distinguish them by relevant attributes, and print a short barcode on the existing **32 × 18 mm** sticker. Staff do not have to read or type a code name such as `SH CH XL FS CK CO`.

This milestone is deferred and does not block ST-03A draft entry using existing identities/codes. Accurate physical identification and usable printed labels still need verification before shop activation. If this milestone is resumed later, preparation labels may be printed for testing; applying them to selling stock and activating quantities belong to the conversion workflow.

## Decisions already settled

- Product names do not have to be unique. Several variants may all appear as `Shirt` with a separate Rs.700 price, or be understood by staff as `Shirt 700`.
- For new records, prefer the base name `Shirt` and a separate selling-price field. The list can display `Shirt` with Rs.700 beside it. Price is not part of identity and must not require renaming when it changes.
- Preserve literal legacy names such as `Shirt 700`, their IDs, codes and history. Do not parse names to derive prices, mass-rename records, group existing products automatically, or repurpose a referenced generic item as one specific garment.
- Each physically distinct sellable combination has a stable variant ID and its own barcode. Identical pieces share a barcode. Different size, quality, model, fabric or design can require separate variants even at the same price.
- Do not create a second variant automatically. Opening and saving a one-variant product must leave one variant. Extra variants require an explicit Add variant action.
- Fabric and quality are separate information. Missing quality/model information does not establish that two garments are identical. Keep unresolved records separate and prepared.
- Colour is not required for the shop's workflow. Preserve existing colour data even if it is not shown in the main form; do not merge records merely because colour is hidden.
- Categories and field suggestions below are provisional. The owner will provide exact categories later. Unknown categories must remain usable without being treated as shirts.
- Existing legacy codes and previously issued/reserved codes remain unchanged. Use six-digit numeric codes for **new automatic reservations only**, subject to physical print/scan verification before rollout.

## 1. Products list and editor

Use the current Products page, services and permissions. Do not create a competing catalogue page.

Present a simple name, price and concise readable attribute subline. Make the barcode and the correct variant's recorded stock/preparation state accessible. For example:

| Name | Price | Details | Barcode |
| --- | --- | --- | --- |
| Shirt | Rs.700 | Crazy Heart · XL · Full sleeve · Checks · Cotton · Single pocket | 100001 |
| Shirt | Rs.700 | Crazy Heart · XL · Full sleeve · Plain · Satin · Single pocket | 100002 |
| Shirt | Rs.700 | Crazy Heart · XXL · Full sleeve · Plain · Cotton · Single pocket | 100003 |

These codes are illustrations, not reservations. This table does not establish current stock or import the owner's audit.

Requirements:

- Retain one distinguishable entry per variant, whether displayed as rows or within an expandable product group. Do not hide all but the first variant or sum distinct variants into one apparently verified quantity.
- Search the name, barcode and recorded attributes needed to distinguish garments. Keep bounded queries and stable pagination; filtering and sorting must not change action targets.
- Edit, reorder, save and print by stable IDs, never array position, name or price. Maintain stable client draft IDs until the backend assigns real IDs.
- Keep the current quick Edit behavior: open the modal immediately with its own loading state, preserve the list and scroll position, and provide inline error/retry. Do not reload or blank the whole page to load one product.
- Ignore late responses after Cancel, another Edit, Add, navigation, logout or unmount. Prevent saving until the intended record has loaded successfully.
- Preserve exact revision checks, durable save request IDs, retry replay and stock-free catalogue updates. Do not make quantities editable in this milestone.
- A price change updates the current price only. It must not change assigned codes, identity, quantities or historical sale/receipt snapshots.
- If a possible duplicate is reported, make it advisory and show the existing identities/codes and their differences. Do not implement automatic merging, deletion, aliases or deactivation. A duplicate-detection subsystem is not required for this milestone.

## 2. Category-appropriate fields

Use a small set of field profiles, explicitly associated with a stable category ID or stored template choice. Do not infer profiles through broad substring checks. In particular, `T-shirt` must not accidentally take a Shirts branch because it contains `shirt`.

Use existing field storage where it fits. Add only the minimal compatible metadata required for relevant distinctions. Do not overload unrelated fields to avoid a schema change, or build a general attribute-rule designer. If a category has no assigned profile, show a concise general form with optional details and an explicit profile selector for an authorized catalogue manager.

| Provisional profile | Suggested visible fields |
| --- | --- |
| Shirts | Brand, size, sleeve, pattern/design, fabric, quality; optional fit, collar, pocket and style/model reference |
| T-shirts / Polo | Brand, size, garment type, sleeve, pattern/design, fabric, quality; optional fit, collar and style/model reference |
| Pants / Jeans | Brand, waist/size, garment type, fabric, quality, fit; optional length, pattern/design, pocket and style/model reference |
| Mundu | Brand, subtype (single/double or owner-entered), size/length, fabric, quality; optional border and style/model reference |
| Kidswear | Garment type, brand, age/size, fabric, quality, pattern/design; sleeve/fit only where relevant, optional style/model reference |
| Innerwear | Garment type, brand, size, fabric, quality; optional pack count and style/model reference |
| Accessories | Item type, brand and applicable size/material; optional quality and style/model reference |
| General / not yet assigned | Name, price, optional size, brand and model/reference; concise optional details |

The table is guidance for presentation, not a demand to fill every field or a finalized category taxonomy. Allow owner-entered values as well as sensible suggestions. Do not require invented brand, fabric, quality or size just to save a prepared record. A pack count describes the sale unit; it does not multiply stock or silently change how existing pieces are billed.

Keep inputs concise, with less common details behind an optional section. Size, age/size and waist labels can reuse compatible size storage; do not force every garment into numeric sizes. Persist any genuinely new fields through the backend, reload and outgoing catalogue representation. Display their useful details consistently in Products, Stock details, POS/replacement selection and new sale snapshots where those views already use shared descriptions.

Changing a profile/category must not silently erase hidden values. Preserve omitted fields, unknown metadata and restricted costs. For a referenced garment, changing physical identity remains prohibited; create a separate prepared record instead. Extend backend identity protection to every new physical metadata key, such as garment type, length, subtype, border and pack count. Existing guards for older fields do not automatically protect new metadata. Reject prohibited changes atomically while continuing to allow price-only edits. Do not relax protection to make profile switching easier.

## 3. Short barcode allocation

Current ST-02 reservations are durable but automatically generate 12-digit codes. Change the generator for new reservations to a durable six-digit numeric sequence, for example 100001. Do not shorten or reassign any existing or already reserved code.

- Allocate within an explicit six-digit range. Persist allocator progress in the local database and claim candidates under the existing serialized transaction boundary; no in-memory counter, timestamp code or random-only retry loop.
- Check all assigned codes, inactive/retired records and reservations, including those from older implementations. Treat barcode strings exactly, preserving leading zeros. Numeric-looking identifiers must not be converted to numbers during save, print, import or export.
- Keep a reservation tied to the same draft and authorized actor. Repeating a request or restarting returns the same reservation. Cancelling a draft must not silently recycle its issued code. Never recycle a code previously assigned to a garment.
- Concurrent requests must receive distinct codes. A failure must leave a valid recoverable reservation/state, not partially save a garment.
- Define explicit exhaustion behavior and report that another code cannot be allocated. Do not wrap to the start, create duplicates, or silently switch to a longer format.
- Audit every existing writer of barcodes, including older product creation/import, generic operations and incoming sync. They must respect the same reservation/claim rules or reject conflicting/unsupported writes. Do not leave a legacy writer able to claim a reserved code. Do not build a new import feature as part of this audit.
- Existing assigned barcode/SKU immutability, permission checks and save replay remain in force. Merely validating uniqueness in the renderer is insufficient.
- This guarantees allocation within one authoritative local database. Independently prepared laptop and shop databases do not automatically share a sequence. Cross-device preparation/transfer collision handling remains ST-05; do not promise global uniqueness or copy the laptop database to solve it.

Manual existing codes remain compatible with the established policy. Do not block a valid legacy seven-digit code because new automatic codes have six digits.

## 4. The 32 × 18 mm sticker

Keep the familiar layout shown by the owner:

1. Shop name: ZAIN GENTS PALACE.
2. Compact readable item title, for example `Shirt XL` or `Doubil Mundu`.
3. Barcode bars.
4. The exact encoded barcode digits.
5. Bold selling price, for example `Rs.700.00`.

The compact title is presentation, not an identity key. It can include a short readable brand/model qualifier when useful, but must not require the cryptic abbreviation string the owner rejected. Full attributes remain available in the app. Preserve the existing label designer and arbitrary owner-entered text blocks; do not replace the whole printing system.

Requirements:

- Use the selected **saved variant**, its current allowed price and exact barcode. Preview and print must agree. Existing sale receipts continue using their saved snapshots.
- Default human-readable digits must be a dynamic barcode field, not hard-coded sample text. Inspect defaults in `StickerPrintModal.tsx`, `LabelDesigner.tsx` and `print.service.ts`; current defaults contain literal `4649350`. Correct defaults consistently.
- Existing saved layouts need compatible handling. Recognize a known unchanged legacy default only with a narrow versioned rule, or offer an explicit preview/review action to replace its sample text. Do not rewrite arbitrary user text just because it resembles a barcode. Make the exact selected code visible before printing.
- Preserve saved printer selection, dimensions, calibration, scale, margins, gaps, labels per row and delays. Do not reset a saved configuration when opening the modal or upgrading. The owner's physical label is 32 × 18 mm; warn clearly when a saved layout has a different size, without silently overwriting it.
- Preserve barcode quiet zones and useful bar height. Do not force a long description into this label or solve overflow by horizontally squeezing the barcode. Keep text/price within the label bounds and explain any truncation in preview.
- Continue waiting for settings to load, showing failures/retry, requiring sticker permission and exact saved revision, and accepting only 1–100 whole copies. Block overlapping jobs and escape all entered HTML/text in print generation.
- Odd copy counts and partial final rows must print the requested number, without extra labels or shifted item/code pairs.
- Printing, cancelling, failing and reprinting never change quantity, preparation status or tracking state. Copies are not a stock count.
- Report screen preview, generated print layout and real hardware checks separately. Six digits are the proposed default; actual readability/scanning must be tested with the owner's printer and scanner before use on selling stock. Do not claim hardware success from a screenshot or simulated printer callback.

## 5. Preserve the working safeguards

Inspect current source and uncommitted changes before editing. Preserve other agents' work. These are regression gates, not instructions to rebuild already completed work:

- Trusted sender/token identity and backend permissions for catalogue/database/label operations; inactive users and logout cannot keep writing.
- Backend cost masking, omitted-field/unknown-metadata preservation and reference protection.
- Exact stale-edit rejection, durable save request replay across restart and atomic catalogue writes.
- Existing quantities/movements unaffected by catalogue saves, including a checkout committing concurrently with an edit.
- New conversion variants remain stock-zero and prepared. POS, refund/exchange and saved-bill updates retain their preparation guards.
- Existing literal names, IDs, codes, old bills, descriptions, payments and cash-register records stay intact.
- Full readable new descriptions remain shared where appropriate; compact sticker titles must not replace detailed sale snapshots throughout the app.
- Outgoing catalogue metadata is complete. Preserve the capability/version acknowledgement gate, revision-specific sync acknowledgement and paging past held products. Unsupported servers must leave new metadata pending locally while eligible existing work continues; do not deploy or silently weaken the gate.
- No changes to refund/exchange amounts, bill-level discounts, the allowed saved-sale editing window, payment methods or cash-register workflow.

If new category/profile metadata needs a newer compatible sync representation, document and test that boundary; do not acknowledge a server response that would discard it. Keep local work usable offline.

## 6. Scope boundaries and implementation points

Inspect these areas before selecting a minimal implementation:

```text
src/pages/Products.tsx
src/pages/Stock.tsx
src/lib/catalogueDescription.ts
src/components/ui/StickerPrintModal.tsx
src/components/settings/LabelDesigner.tsx
src/services/print.service.ts
electron/catalogue.service.ts
electron/catalogue-sync.service.ts
electron/session-auth.service.ts
electron/main.ts
electron/preload.ts
electron/devBridge.cjs
src/lib/db.ts
src/lib/browserBridge.ts
prisma/schema.prisma and the actual runtime client
scripts/catalogue-*.test.cjs
scripts/stock-st02.test.cjs
```

Do not regenerate Prisma blindly or remove models to resolve source/runtime drift. Use additive compatible changes and isolated upgrade tests. Keep runtime schema failures explicit; no anonymous or permissive fallback.

Excluded: audit import, authoritative counts, conversion batches, activation, old-barcode retirement, live relabelling, purchasing, supplier balances, accounts, profit, forecasts, customer/WhatsApp features and mobile billing. Do not seed the actual audit workbook into a database or subtract its seven unspecified later sales. F-00 packaged-startup data preservation remains a separate production gate.

## 7. Acceptance and verification

Use synthetic fixtures in disposable databases. Do not modify `prisma/pos.db`, the shop user-data database, cloud data or the owner's audit workbook. Tests should execute the relevant handlers/UI behavior, not only search source text for expected strings.

| ID | Action | Expected result |
| --- | --- | --- |
| A1 | Prepare three Shirts at Rs.700 with different sizes/fabrics/patterns | Distinct variants and codes with simple names and readable details; no grouping by name or price. |
| A2 | Open/save a product with one variant, then explicitly add another | First save leaves one variant; explicit Add creates just one new variant. Repeat save/retry does not duplicate it. |
| A3 | Load/reorder/filter an eight-variant product and edit/print one | All variants remain available; only the intended stable ID is edited/printed; quantities/history stay attached. |
| A4 | Change a current selling price | Current price changes without code/identity/stock changes or historical snapshot rewrites; literal legacy names remain untouched automatically. |
| A5 | Open Shirts, T-shirts, Pants, Mundu and an unassigned category | Relevant concise forms; no shirt substring collision; no colour requirement or invented attributes. |
| A6 | Save/reload category-specific details; switch profile with hidden metadata/cost | Relevant values round-trip; omitted/hidden fields and unknown keys survive; identity protection still rejects prohibited repurposing. |
| A7 | Edit while the list is scrolled; cancel or open another record before a slow response | Immediate modal loading/error/retry; no whole-page flash/reset; stale responses cannot overwrite the intended draft. |
| A8 | Reserve new codes concurrently and retry after a fresh database connection | Distinct six-digit codes; same draft keeps its code across retry/restart; previous reservations stay unchanged. |
| A9 | Candidates already assigned/inactive/retired/reserved; legacy writer attempts a reserved code; exhausted range | Occupied codes are skipped/blocked through every relevant path; exhaustion is explicit with no wrap/recycle. |
| A10 | Load/print existing seven/twelve-digit codes and a code with leading zeros | All remain exact strings; existing codes are not shortened or reassigned. |
| A11 | Preview/print 1, 3 and 100 labels; invalid/fractional copies, failure/retry and overlapping jobs | Correct variant and exact count; invalid/overlapping operations rejected; no stock/preparation writes. |
| A12 | Default/saved layout, dynamic digits, custom text, long title and special characters | Bars and digits match the selected saved variant; custom text/calibration survives; escaped content and bounded label layout. |
| A13 | Concurrent checkout/edit, stale edit, denied user and lost save response | Existing stock, permission, revision, metadata/cost and durable retry safeguards remain effective. |
| A14 | Cloud lacks required metadata support or acknowledges an older revision | Metadata stays pending; eligible other work continues; concurrent local changes are not marked synchronized. |
| A15 | Inspect database before/after this catalogue/printing workflow | No audit counts, activation, code retirement, financial rewrites or duplicated records/movements. |
| A16 | Change a new physical metadata field on a variant with sale/movement references, then try a price-only edit | Physical change is rejected atomically and requires a new prepared variant; the permitted price-only edit succeeds with identity, codes and history preserved. |

Run focused new tests plus the existing relevant regression checks:

```text
npm run test:st02
npm run test:stock
npm run test:refunds
node --test scripts/cash-register-history.test.cjs
npm run typecheck
npm run verify:smoke
node node_modules/vite/bin/vite.js build
```

The last command verifies bundles without packaging an installer. Do not run `npm run build` or a release packager for this milestone. Report exact pass/fail/skipped counts and any unavailable checks; old review results are not evidence for new edits.

Follow `AGENTS.md`: use existing in-app dialogs/toasts, bump the currently checked-out app version and add a new current Version Info release for the actual implementation. Do not assume a fixed next version from this document.

## Delivery and owner check

Provide changed files, a brief explanation, acceptance evidence, remaining risks and a short development-laptop test. Separately list physical printer/scanner verification as pending if it was not performed. Stop after ST-02A; do not proceed into counts or shop rollout.

Owner check: prepare two test Shirts at the same price but with different details; confirm only explicit variants exist; reopen each; verify simple names and separate codes; change one price; check a Mundu and a T-shirt form; preview three small labels and confirm their exact digits. Physical print/scan comes next. Keep test preparation labels off selling stock until the conversion workflow is ready.
