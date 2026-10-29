# ST-03A review fixes

Implemented 10 October 2026, app version 3.0.10. This records the fixes to the reviewed working-tree implementation, not approval to activate stock or install on the shop PC.

## What changed

- Opening a draft clears the prior form immediately. Failed reads cannot enable saving or cancellation. Editor, user/session and request guards discard late responses after closing, switching drafts, starting another draft or changing user.
- Saves and cancellations capture one immutable payload and operation ID. Fields and editor switches remain locked until the request is reconciled. Retries send exactly that request; a successful response is followed by a read of the latest intended draft, preserving newer edits and terminal cancellation.
- Explicit initial write rejections permit correcting the preserved form through **Edit rejected request**, with a fresh operation ID on the next attempt. Transport failures remain uncertain, including browser bridge failures. A later rejection does not erase uncertainty from an earlier attempt. **Retry pending** or **Review latest saved draft** resolves it.
- Editing counts/notes retains the original saved item snapshots, line IDs and creation times. Existing line IDs cannot be reassigned to another variant. Existing unavailable lines retain their evidence and can be reviewed; newly added lines must still identify active prepared variants.
- Catalogue comparisons include name, codes, description, size, recorded colour, selling price, preparation status and all nine structured garment attributes. The editor shows saved and current catalogue details. A nullable attribute snapshot column is added without replacing old evidence with current catalogue values.
- The date/time control uses India time independently of the computer timezone. An unchanged time retains the original ISO value, including seconds and milliseconds.
- Prepared-variant searches invalidate earlier results as soon as the query or editor changes, including during the debounce interval.

## Changed source and checks

Source: `electron/stock-draft.service.ts`, `src/components/stock/CountDraftsView.tsx`, `src/lib/stockDraftDateTime.ts`, `src/services/stock-draft.service.ts`, `src/lib/browserBridge.ts`. Version/changelog: `package.json`, `package-lock.json`, `src/components/settings/VersionInfo.tsx`.

Focused tests: `scripts/stock-draft-st03a.test.cjs`, `scripts/stock-draft-ui.test.cjs`, `scripts/stock-draft-ipc.test.cjs`.

| Check | Result |
| --- | --- |
| `npm run test:drafts` | 40 passed: 18 backend, 13 component/service behavior, 9 authorization/transport cases |
| `npm run test:st02` | 76 passed, 1 explicit backend skip for a print-callback case covered by the UI suite |
| `npm run test:stock` | 40 passed |
| Refund and Cash Register regressions | 22 passed |
| `npm run typecheck` | Passed |
| `npm run verify:smoke` | Passed |
| `node node_modules/vite/bin/vite.js build` | Renderer, Electron main and preload bundles compiled; existing tooling/chunk-size warnings remain |

Backend tests use disposable SQLite databases. They include a real failure after the header, deletion and first replacement line have changed, verifying complete rollback and safe retry of the identical operation. Component tests execute the actual TSX and frontend adapter with isolated hooks, deferred IPC and timers; these are behavioral tests, not a real desktop visual/keyboard test. Authorization tests exercise actual Electron route registrations and the HTTP handler with injected users/services. Browser transport tests use simulated responses.

No live shop database, audit workbook or production cloud was used. No installer was packaged.

Physical printer/scanner checks and desktop visual/keyboard checks remain manual.

## Owner check before moving on

1. In Stock → Count Drafts, save a small test batch with two distinguishable prepared variants. Leave one count blank and set the other to zero. Close/restart the app and reopen it; the two states and observed time should remain intact.
2. Edit a count, save and reopen. Confirm the intended line changed and the recorded stock overview did not.
3. Change a prepared test variant's size or description in Products, then reopen the draft. Its original details should remain visible with a review warning and the current catalogue details.
4. Cancel a separate test draft. Reopen it and confirm it is read-only. Existing sales and Cash Register figures should remain unchanged.

Previously overwritten snapshots or shifted times cannot be reconstructed automatically; verify any older test drafts against the original record. Old rows with no structured attribute snapshot keep that information unknown.

Counts remain local draft observations. Stock posting/activation, relabelling rollout and laptop-to-shop data transfer are still later work. ST-02A remains deferred.
