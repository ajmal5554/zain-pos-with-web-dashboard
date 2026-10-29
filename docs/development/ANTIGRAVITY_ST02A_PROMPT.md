# Paste into Antigravity: ST-02A catalogue usability

Deferred by the owner on 9 October 2026. Do not start this task unless the owner resumes it. The current next brief is [ANTIGRAVITY_ST03A_PROMPT.md](ANTIGRAVITY_ST03A_PROMPT.md), which uses existing catalogue tools for draft counts only.

Open this repository in Antigravity/Gemini and paste the message below. The detailed PRD is in the same repository; attach it as context if the agent cannot read workspace files.

---

Implement **ST-02A: simple product names, category fields and small labels** in this existing Zain POS repository.

Read first:

```text
AGENTS.md
docs/development/README.md
docs/development/ST02A_CATALOGUE_USABILITY_PRD.md
docs/development/STOCK_PAGE_PRD.md
docs/development/ST02_REVIEW_FIXES.md
```

ST-01, ST-02 and the subsequent review fixes already exist. Inspect actual source and uncommitted changes; preserve them. Give a short assessment/plan, then implement and verify **ST-02A only**. Do not rebuild completed work or stop at a design proposal. Resolve routine technical choices yourself; ask only about a material business rule the PRD does not settle.

My decisions:

- Simple names are fine. New items can be called `Shirt` with price separately, so staff see Shirt and Rs.700. Several variants can share that name/price. Do not force names like `SH CH XL FS CK CO`.
- Preserve existing literal names such as `Shirt 700`, IDs, barcodes and historical bills. No automatic renaming, regrouping or merging. Price is not identity.
- Relevant attributes distinguish actual garments. Each distinct combination has its own stable variant ID/code; identical pieces share the code. Do not automatically create a second variant. Missing quality/model details are not proof of a duplicate.
- Forms must fit the category. Use the provisional profiles in the PRD with explicit category/profile association; unknown categories get a concise fallback. Colour is not required, fabric differs from quality, hidden metadata must survive. Extend backend identity protection to new physical metadata keys; do not assume existing guards cover them. No elaborate rule designer.
- For NEW automatic reservations use a durable six-digit numeric allocator. Keep every existing/reserved code unchanged, preserve leading zeros and check every relevant writer for reservation collisions. Keep concurrency, restart/retry, permissions and assigned-code immutability safe. Independent laptop/shop databases do not share an allocator; portable transfer is later work.
- My label is 32 × 18 mm. Keep the familiar shop name, compact item title, barcode, exact digits and bold price. Full descriptions belong in the app. Preserve saved printer calibration/settings and custom text. Fix hard-coded sample digits in defaults consistently without rewriting arbitrary saved text.

Preserve the current all-variant editor, fast Edit modal/no page flash, stale-response protection, exact revision checks, durable save replay, stock-free updates, trusted backend identity, hidden-cost/metadata preservation, prepared-item guards, detailed new sale snapshots and catalogue sync capability/revision gates. Extend current descriptions/selections only as needed for the relevant new category details; preserve historical snapshots. Do not change refund/exchange calculations or financial workflows, bill-level discounts, saved-sale editing or Cash Register.

This is development on my personal laptop. Work only on development files and disposable test databases. Do not import my real audit workbook, allocate its seven unspecified later sales, post counts, activate stock, retire old generic barcodes, relabel selling stock, copy my laptop database over the shop PC, deploy cloud changes or package an installer. ST-03 counts and ST-04 stock operations come after review. F-00 startup/upgrade preservation remains a separate production gate.

Follow all acceptance cases A1–A16 in the PRD. Add focused behavior tests for the changed code and run the existing relevant checks listed there. Report exact results and unavailable checks. Screen previews or mocked printer tests do not establish actual printer/scanner success.

Follow AGENTS.md: use in-app dialogs/toasts, bump the app version from its current value, and add a current Version Info release for the implemented changes. Preserve unrelated edits.

When done, provide changed files, what changed, acceptance/test evidence, remaining issues and a short owner test. Stop after ST-02A for review.

---

After Gemini finishes, return to Codex with:

> Gemini finished ST-02A. Review the current changes against `docs/development/ST02A_CATALOGUE_USABILITY_PRD.md`. Don't edit anything.
