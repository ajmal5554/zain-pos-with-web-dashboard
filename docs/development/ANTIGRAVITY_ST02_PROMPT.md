# Paste into Antigravity: ST-02 catalogue and label preparation

Historical brief: ST-02 and its review fixes are implemented; ST-02A is deferred. For the next task, use [ANTIGRAVITY_ST03A_PROMPT.md](ANTIGRAVITY_ST03A_PROMPT.md) for stock-count drafts only. Do not rerun this original brief or begin stock activation.

With this repository open in Antigravity/Gemini, paste the message below. The referenced PRD is the detailed contract. This milestone prepares the tools; it does not begin physical conversion at the shop.

---

Implement **ST-02: catalogue and label readiness** in the existing Zain POS repository.

Read these first:

```text
AGENTS.md
docs/development/README.md
docs/development/STOCK_PAGE_PRD.md
```

ST-01 Stock overview/history and its review fixes already exist. Preserve them; do not rebuild that page or implement ST-03 counts yet. Inspect current source and changes rather than assuming the docs describe every recent edit. Give a short assessment and plan, then implement and verify ST-02. Make routine technical/design decisions without repeated permission requests. Ask only about an unresolved material business rule; report prerequisite blockers honestly.

## Shop context

We have one B2C garment shop. The shop PC is billing live while development/testing happens on my personal laptop. I later send a tested EXE installer. Work only on development files and isolated test databases. Do not mutate the real shop database, deploy cloud changes, package a release, restore my laptop database onto the shop PC, or import my real audit as test data.

Existing products such as `Shirt 700` are generic: multiple sizes, brands and qualities share that code. Keep those records, their IDs/barcodes and old bills intact. New specific variants must be prepared alongside them. Two garments can have the same price and visible attributes but different qualities; do not merge them automatically.

I have a partial shirt audit, not a verified current opening balance. Seven shirts later sold without specifications. We cannot know which audit rows, or whether the audited subset, supplied those sales. Do not allocate those sales, deduct seven from the sheet automatically, or activate its quantities.

We cannot finish relabelling in one day or close the shop. The future ST-03 workflow is: hold a small batch, freshly identify/count it, apply labels, commit that batch once on the shop PC, then put it back on sale. Other pieces continue selling under old labels. An old generic barcode stays active until every remaining piece using that code is converted. ST-02 only prepares the catalogue and label tools for this workflow.

## Inspect the actual integration points

```text
src/pages/Products.tsx
src/pages/POS.tsx
src/pages/Sales.tsx
src/pages/Stock.tsx
src/lib/db.ts
src/store/authStore.ts
src/services/barcode.service.ts
src/services/print.service.ts
src/components/ui/Modal.tsx
src/components/ui/ConfirmDialog.tsx
src/components/ui/Toast.tsx
electron/main.ts
electron/preload.ts
electron/permission.service.ts
electron/sync.service.ts
prisma/schema.prisma
prisma/generated/client/schema.prisma
zain-pos-api/prisma/schema.prisma
zain-pos-api/src/routes/sync.ts
package.json
```

Locate the actual sticker dialog/layout component and installed-database upgrade code too. Source/runtime Prisma drift and caller-supplied IPC identity were known concerns; recheck them rather than assuming fixed or blindly regenerating/resetting schemas. F-00 trusted permissions and safe upgrades are production release prerequisites. Do not invent anonymous access, expand generic database permissions, or claim frontend permission checks secure writes. Keep any operation without a safe backend authorization path blocked and explain the prerequisite; do not bundle an unrelated authentication overhaul into this milestone.

## Build only this

1. **Reliable multi-variant Products editing.** Load every variant, edit by stable ID, use stable keys for unsaved rows, and save related changes atomically. Preserve IDs when reordered. Do not index-match rows, hard-delete referenced variants, silently retire omitted rows, or silently overwrite stale edits. Retry creating a record without duplicating it.

2. **Practical optional garment details.** Support size, brand, fabric, quality and pattern/design, with optional sleeve, fit, collar, pocket and a style/model/quality reference when needed. Show fields appropriate to the category. No compulsory colour or final naming convention. Keep fabric and quality distinct. Normalize obvious whitespace/case duplicates without inventing brand aliases. Preserve unresolved distinctions in preparation rather than guessing/merging.

3. **Readable descriptions.** Generate descriptions from structured fields, for example `Shirt | Crazy Heart | XL | Full Sleeve | Checks | Cotton`, keeping price separate. Use a shared formatter for current catalogue/selection/label descriptions. Keep saved sale-item/receipt snapshots unchanged. A change in price does not create another identity; a different physical quality/model does.

4. **Explicit preparation state.** New conversion variants can be saved, edited, previewed and printed, but are not yet saleable or counted. Keep them visible in catalogue management. Reject their sale/replacement selection and posting at the backend as well as UI; explain that stock conversion is pending. Existing active legacy records remain saleable. Do not overload deletion flags or deactivate the parent product. No stock quantity entry or activation in this preparation workflow; preserve existing stock even if a sale commits while Products is open.

5. **Stable unique barcodes.** Each identified variant gets its own globally unique code; identical pieces share it. Keep codes as strings, including leading zeros. Preserve old codes and history; never alias a shared old code to a guessed specific variant. Enforce backend/database uniqueness including inactive records and concurrent generation. Keep a generated code stable on save/reopen/reprint. No silent regeneration/recycling.

6. **Labels for any selected variant.** Reuse the existing label printer/layout and scanner conventions. Show a preview and an explicit positive whole-number copy count independent of stock. Handle long descriptions and escape user-entered print HTML. Print/cancel/failure/reprint must never write stock, activate conversion, create movement records, or imply labels were physically applied. Report real printer/scanner validation as pending if unavailable. ST-02 labels are preparation/test labels; selling stock must not be relabelled until ST-03 is ready.

7. **Compatible persistence.** Use a minimal additive schema/upgrade path if needed. Preserve existing records and unknown legacy metadata. Older sync payloads must not erase new fields/preparation state, activate prepared variants or reset stock. Local preparation must work offline and survive restart. Catalogue saves must reject forged stock/tracking fields; hidden cost fields must not be fetched without permission or overwritten with zero during other edits.

Use the existing Products page and app styling. Support light/dark, keyboard use, useful loading/error/retry states and concise forms. No native browser alert/confirm/prompt: use the shared in-app components required by AGENTS.md. Keep billing fast and show only meaningful controls.

## Strict boundary

Do not implement opening counts, conversion-batch posting, actual stock activation, adjustments, goods receipts, bulk migration/import/export, mass renaming, legacy-code retirement, purchases, Accounts, Profit, forecasting, mobile billing or WhatsApp. Do not modify refund/exchange amounts, bill-level discounts, saved-sale editing, cash-register calculations or enable card payments. Necessary description/preparation guards in existing selection and backend paths are in scope; financial workflow redesign is not.

Do not treat new default-zero quantity as verified zero, use label-copy count as stock, or apply the audit workbook as a baseline. Do not change live legacy quantities while editing attributes/prices. Existing histories must remain linked to their original IDs and descriptions.

## Verification and completion

Implement the ST-02 acceptance cases C1-C14 in the PRD with meaningful isolated handler/database fixtures and targeted UI checks. Especially verify reorder/edit identity, duplicate-code concurrency, retry-safe creation, stock preservation during a concurrent sale, forged activation rejection, prepared-item sale rejection, print-without-stock-side-effects, and older sync behavior. Tests must exercise real relevant handlers rather than copying their logic into a test.

Check available scripts before selecting relevant commands:

```text
npm run typecheck
npm run verify:smoke
npm run test:stock
npm run test:refunds
node --test scripts/cash-register-history.test.cjs
node node_modules/vite/bin/vite.js build
```

Use disposable test databases, never `prisma/pos.db` or production data. Verify an additive upgrade against a disposable existing database. Do not run schema reset/force-reset, destructive seed, or installer packaging. Record unrelated baseline failures instead of changing unrelated code to hide them. A passing renderer build is not an installer or real hardware test.

Deliver:

```text
Milestone: ST-02
Implemented behavior:
Files and schema changes:
Business rules preserved:
Checks run and actual results:
C1-C14 passed / failed / not tested:
Known limitations and F-00/ST-03 dependencies:
Simple owner test steps:
Deployment/data migration status:
```

Stop after this milestone and its verification. Do not claim tracked stock or shop rollout is ready. I will bring the changes back for code review before we build conversion batches.
