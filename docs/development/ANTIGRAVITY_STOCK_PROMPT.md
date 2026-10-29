# Paste into Antigravity: first Stock page milestone

Copy the message below into Antigravity/Gemini with this repository open. It deliberately requests ST-01 only. The full stock workflow is staged in the accompanying PRD.

---

Work in the existing Zain POS repository. Implement **ST-01: Stock overview and movement history** from `docs/development/STOCK_PAGE_PRD.md`. Read `docs/development/README.md` and `AGENTS.md` first.

My shop already uses this app for real billing. Development happens on my personal laptop; I later build an EXE installer for the shop PC. Preserve all existing work and shop data. Do not deploy, access a production cloud, modify a live database, or package a release unless separately requested.

I want you to design a polished, practical Stock page that works with real existing data. Products already manages the catalogue. Stock should show recorded quantities and their movement history. Opening stock has never been fully verified, so old negative numbers must not be presented as proven physical shortages.

Start by inspecting the relevant files and giving a brief assessment of the existing data paths and permissions. Then implement this milestone without repeatedly asking permission for routine coding choices. Ask only if a material business decision or incompatible requirement prevents progress. Do not invent policies to avoid asking.

Inspect at least:

```text
src/pages/Products.tsx
src/App.tsx
src/components/Layout/MainLayout.tsx
src/lib/db.ts
src/store/authStore.ts
src/components/ui/Modal.tsx
src/components/ui/ConfirmDialog.tsx
src/components/ui/Toast.tsx
electron/main.ts
electron/preload.ts
electron/permission.service.ts
prisma/schema.prisma
prisma/generated/client/schema.prisma
package.json
```

Build:

1. A Stock route/sidebar entry using the existing layout and access pattern. Access requires admin or the existing inventory permission. Enforce the appropriate read permission in the backend too; a hidden button alone is insufficient. Document existing identity-trust limitations honestly and do not weaken permissions.
2. A searchable, paginated list with one row per existing variant ID: product, category, barcode/SKU, recorded size/variant description, recorded stock and minimum quantity.
3. Category and positive/zero/negative recorded-balance filters. Use bounded queries with stable ordering. Any totals must cover the entire filtered result, not only the current page.
4. A clear opening-stock-unverified notice. Show actual recorded negative quantities with that explanation. Do not claim a physical shortage, verified availability or stock value from uncounted data.
5. A movement-history panel or shared Modal with date filtering, timestamp, type, correctly signed quantity, reason, reference and operator when available. Use actual InventoryMovement records; do not infer current stock by summing incomplete legacy movements.
6. Loading, empty, error/retry, refresh, keyboard and light/dark states. Prevent stale search requests from replacing newer results. Local reads must work without cloud access.
7. Products navigation only when the user has catalogue permission. This page does not edit the catalogue or stock.

Keep this change small. **Do not implement** counts, stock adjustments, receipts, fabric/design schema changes, label redesign, CSV import/export, purchases, Accounts, Profit, valuation, forecasts, or a general UI redesign. Do not add decorative buttons for unavailable features. Those are later milestones.

Preserve these business rules:

- Existing bill-level discounts; no mandatory item-level discounts.
- Existing full-original-selling-price exchange credit and net-paid refund workflow.
- Existing saved-sale editing behavior and blocks after refunds/exchanges/voids.
- Existing cash register and removal of Add Cash In.
- Cash, UPI and Split, with Card still controlled by its current disabled setting.
- Stable product/variant IDs and old bill snapshots. Never merge variants because they share a name or price.

Never use `window.confirm`, `window.alert` or `window.prompt`. Reuse the in-app Modal, ConfirmDialog and toasts. Do not send hidden cost-price fields to the page; ST-01 does not need costs.

ST-01 should not need a schema migration. Source/generated Prisma drift already exists: inspect compatibility, don't reset a database or regenerate away existing models. Add narrowly scoped read APIs if needed; don't expose arbitrary generic DB operations. Leave unrelated edits alone and don't commit/push without a request.

Implement meaningful verification using disposable fixtures/databases, not `prisma/pos.db` or production. Cover at least: multiple variants per product; same-price variants; -12 and zero recorded stock; search/filter/pagination totals; movement signs and unknown legacy types; read errors; access denial; absence of cost fields; and no writes from reading/refreshing the page.

Check the available commands and run the relevant ones. The existing options include:

```text
npm run typecheck
npm run verify:smoke
npm run test:refunds
node --test scripts/cash-register-history.test.cjs
node node_modules/vite/bin/vite.js build
```

Record pre-existing failures separately. Do not hide errors or alter refund/exchange/stock calculations to make unrelated checks pass. A successful build does not prove a shop upgrade or hardware integration works.

Finish with:

- What works and the changed files.
- Actual checks run and their results, including the PRD's S1–S17 cases.
- Existing issues or limitations, including permission/data-readiness constraints.
- A short test guide I can follow on the laptop.
- Confirmation that no live shop records were modified.

Finish ST-01 only. Do not claim stock counting is ready and do not start ST-02 without my next request.

---

## Message to request review after Gemini finishes

```text
Review the current changes for ST-01 against docs/development/README.md and
docs/development/STOCK_PAGE_PRD.md. Check the implementation and test evidence,
not only screenshots. Focus on incorrect quantities, hidden writes, permissions,
cost exposure, query performance, fake data, regressions, and scope creep.
Do not edit anything; report actionable findings and release blockers first.
```

## Template for later milestones

```text
Implement only [milestone ID] from the agreed PRD. Inspect current code first;
preserve the existing business rules and unrelated changes. Identify its data
dependencies, settle only necessary unresolved business choices, implement the
smallest complete behavior, and verify the listed acceptance cases with isolated
data. Report actual results and limitations. Do not start the next milestone.
```
