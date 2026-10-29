# Paste into Antigravity: ST-03A stock-count drafts

Current next milestone, 9 October 2026. The owner has deferred ST-02A. This task uses existing catalogue tools and codes; it does not redesign names, category fields, barcode generation or labels.

Open this repository in Antigravity/Gemini and paste the message below.

---

Implement **ST-03A: durable stock-count drafts** in the existing Zain POS repository.

Read first:

```text
AGENTS.md
docs/development/README.md
docs/development/STOCK_PAGE_PRD.md
docs/development/ST02_REVIEW_FIXES.md
```

ST-01, ST-02 and their fixes already exist. ST-02A is deferred by my decision. Inspect actual source/uncommitted changes, preserve them, give a short assessment and plan, then implement and verify **ST-03A only**. Use the ST-03A subsection of the stock PRD as the contract. Do not implement all of ST-03 in this task.

## What I need now

Add a concise Count drafts view within Stock using the existing app layout, permissions and in-app components. Support creating, saving, reopening, editing and cancelling a draft. Do not build another Products page.

Each draft represents one identified physical batch, such as a rack section being audited, rather than every garment sharing an old generic barcode. Store locally in the database, not just component state/localStorage:

- Stable draft ID; operation kind fixed to `CONVERSION_ADDITION`; Draft/Cancelled status.
- Batch description, creator/last editor, created/updated times, observed count time when supplied, optional source legacy code/reference and notes.
- Lines linked to stable saved prepared variant IDs, with a backend-captured descriptive/code snapshot, count or explicit uncounted value, and optional line notes.
- A revision for competing edits and durable operation IDs for safe create/save/cancel retries.

Reuse existing prepared specific variants. Search/pick by barcode and readable recorded details, showing distinct identities even when names/prices match. Do not create catalogue records inside the count screen or treat an existing shared generic item as an identified new variant. Offer existing Products navigation when authorized. An unavailable/changed referenced garment must be shown for review, never silently substituted by name/price.

Permit an incomplete draft to be saved. A missing count is different from explicit zero. Validate supplied counts as non-negative whole pieces in the backend; reject negative/fractional/non-finite values. Zero means no pieces counted on that line, not a verified baseline. Avoid duplicate variant lines in one draft; let the operator edit that line's batch quantity. Missing identity/count information stays clearly incomplete, without inventing a barcode or variant. A new draft may be empty; require a real saved variant when adding an identified line.

Show **Draft only — not applied to stock** and a separate observed batch count. Do not label draft totals as verified stock, current availability or complete opening stock. Save success must say the draft was saved. There is no Apply/Activate/Finalize action in this milestone and no nonfunctional placeholder button.

Cancelling is a persistent terminal draft state with in-app confirmation. Preserve the draft/lines for review; do not delete audit evidence or permit a stale edit/retry to revive it. Backend validates current status and revision. Bind each operation ID to its normalized payload and reject reuse with different content. A retry of an already successful operation returns its original result, without duplicating the draft/lines or overwriting newer edits; an old replay response must not replace newer/cancelled UI state.

## Business boundaries

No draft operation changes ProductVariant stock, preparation/tracking status, InventoryMovement, bills, refund/exchange records, payments or Cash Register records. Complete baseline/recount, final posting and stock activation are later work. Existing billing and legacy barcodes keep working.

The partial audit workbook is a dated reference. Seven later shirt sales have no exact specification; do not allocate them to variants or automatically subtract them. Counts may become stale while sales continue. Record when they were observed and explain that fresh verification/reconciliation will be required before a later posting. Saving a draft does not certify that the pieces are held or ready for activation.

Development is on my personal laptop. Drafts saved there stay there. A later installer does not transfer drafts/catalogue data to the shop PC; use later reviewed ST-05 transfer or re-enter/recheck counts on that PC. Do not restore/copy the laptop database over shop sales. Keep this milestone local and offline-capable; do not sync drafts to an incompatible cloud or advertise them as posted stock.

Before actual tracked-stock rollout we still need finalization, old-bill return-stock mapping, an agreed insufficient-stock policy, basic receipts/adjustments, usable print/scan validation and F-00 upgrade/data preservation. Those do not block building drafts; do not implement them silently in this task. Do not instruct me to relabel selling stock yet.

## Implementation and verification

Reuse the trusted backend session/token boundary and inventory permission: admin or `permManageInventory`. Enforce it on every draft read/write, not only navigation. Do not trust a supplied renderer user ID, expose costs, or add arbitrary generic DB write access. Keep list/detail reads bounded, use stable pagination and loading/error/retry, and ignore stale UI responses.

Persist header/lines/revision and successful operation replay atomically. Inject failures and test restart/timeout/concurrent edits using disposable databases. Keep schema changes additive and compatible with the actual runtime client; no destructive schema commands or blind Prisma regeneration. Preserve catalogue save replay, barcode reservations, exact revision checks, stock-free updates, preparation guards, metadata/cost preservation, fast Edit behavior and sync gates.

Satisfy D1–D12 in the ST-03A PRD. Add focused tests that execute the real draft services/handlers and relevant UI behavior. Then run relevant existing regressions:

```text
npm run test:st02
npm run test:stock
npm run test:refunds
node --test scripts/cash-register-history.test.cjs
npm run typecheck
npm run verify:smoke
node node_modules/vite/bin/vite.js build
```

Use isolated synthetic fixtures. Do not run tests/imports against `prisma/pos.db`, shop user-data databases, the real audit workbook or production cloud. Do not package an installer, deploy cloud changes or build ST-03B/ST-04/ST-05. Follow AGENTS.md for in-app dialogs/toasts, an app version bump from its current value and a new current Version Info entry for the implementation.

Finish with changed files, exact verification results/skips, remaining issues and this simple owner test: save a draft containing two distinguishable prepared variants, restart/reopen, edit a count, leave one count blank versus zero, cancel a separate draft and confirm existing recorded stock and billing are unchanged. Stop for review.

---

After Gemini finishes, return to Codex with:

> Gemini finished ST-03A. Review the current changes against the ST-03A section of `docs/development/STOCK_PAGE_PRD.md`. Don't edit anything.
