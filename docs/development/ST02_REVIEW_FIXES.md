# ST-02 review fixes — 9 October 2026

Status: implemented and verified for development testing. Stock conversion and shop rollout are separate milestones.

## What changed

- Catalogue and generic database IPC now use a password-established sender session for these operations. The browser development bridge uses an opaque token held in memory. Permissions refresh from the database, logout/reload revokes credentials, and nested responses mask restricted costs/passwords. Direct or nested generic catalogue writes cannot bypass the dedicated save workflow.
- Products handles failed, malformed and stale reads with useful retry states. Saves carry a stable request ID and exact product revision. Durable replay prevents duplicate products/variants after a lost response; competing edits reject stale revisions atomically.
- Existing variant updates never assign stock. A checkout that commits while a catalogue save is waiting retains its quantity change. New conversion variants start at zero in preparation; the preparation status is read-only and backend-owned. Posting checks block unknown/partially upgraded preparation state.
- Barcode generation reserves a unique code for each draft in the database, including concurrent operators. Assigned barcodes and SKUs remain unchanged. Inactive records also reserve their codes. Leading zeros remain strings.
- Omitted garment details, unknown metadata and hidden costs survive compatible saves. Referenced product/variant identities cannot be repurposed into different garments. Physical distinctions require a new prepared record.
- Products, POS, replacement selection, labels and new exchange bill snapshots use shared garment descriptions. Existing sale/receipt snapshots retain their original descriptions. Refund/exchange amounts and the shop's saved-sale editing policy are unchanged.
- Label printing requires a saved variant and sticker permission, validates the saved product revision, waits for saved printer settings, accepts 1–100 whole copies, escapes entered HTML and prevents overlapping jobs. Printing does not activate stock or record a count.
- Outgoing catalogue sync includes garment details, preparation state, metadata and complete descriptions. A cloud server must advertise and acknowledge catalogue metadata version 1 before those records can be marked synchronized. Older servers leave these products pending locally while eligible legacy products and sales continue syncing. Paging prevents pending products from blocking later eligible products. An upload acknowledges only its exact revisions, preserving concurrent local changes.

## Files and schema

Core backend: `electron/catalogue.service.ts`, `electron/catalogue-sync.service.ts`, `electron/session-auth.service.ts`, `electron/main.ts`, `electron/sync.service.ts`, `electron/devBridge.cjs`, `electron/preload.ts`.

UI/bridge: `src/pages/Products.tsx`, `src/pages/POS.tsx`, `src/pages/Sales.tsx`, `src/components/sales/ReplacementProductPicker.tsx`, `src/components/ui/StickerPrintModal.tsx`, `src/lib/catalogueDescription.ts`, `src/lib/browserBridge.ts`, `src/store/authStore.ts`.

Additive catalogue storage retains the garment sidecar and preparation column. `CatalogueSaveRequest`, `CatalogueBarcodeReservation` and `CatalogueWriteLock` support durable replay and serialized code/revision claims. No Prisma regeneration or destructive migration was performed for these review fixes.

Tests: `scripts/stock-st02.test.cjs`, `scripts/catalogue-auth.test.cjs`, `scripts/catalogue-ipc.test.cjs`, `scripts/catalogue-ui.test.cjs`, `scripts/catalogue-sync.test.cjs`, and the new exchange-description case in `scripts/refund-regression.test.cjs`. `npm run test:st02` runs all five ST-02 suites.

## Verification actually run

| Check | Result |
| --- | --- |
| `npm run test:st02` | 71 passed, 0 failed, 1 explicit handoff skip |
| `npm run test:stock` | 40 passed |
| `npm run test:refunds` | 19 passed |
| `node --test scripts/cash-register-history.test.cjs` | 3 passed |
| `npm run typecheck` | Passed for renderer and Electron |
| `npm run verify:smoke` | Passed |
| `node node_modules/vite/bin/vite.js build` | Renderer, main and preload bundles built successfully |
| Targeted `git diff --check` | Passed; only Windows line-ending notices |

Total: 133 automated tests passed. The SQLite suite explicitly hands C7 print callback coverage to the UI suite; its skipped entry is not a hardware pass. Physical printer/scanner behavior remains untested. The build reported existing chunk-size/tooling warnings and did not package an installer.

The tests use disposable SQLite databases or injected in-memory Prisma/IPC/HTTP/printer fixtures. They execute the relevant source handlers and callbacks. Cloud tests use the actual local serializer and sync services with simulated server responses; they do not establish production server compatibility.

## Acceptance evidence

| Cases | Evidence / limit |
| --- | --- |
| C1–C4 | Stable variant IDs, exact retry across a fresh SQLite connection, distinct qualities and preserved legacy bills |
| C5–C6 | Inactive duplicates, concurrent reservations/claims, rollback and leading-zero persistence; physical scanning pending |
| C7 | Actual UI copy/print/failure callbacks and IPC permission/revision checks; physical printing/cancellation pending |
| C8 | Actual checkout, exchange and saved-bill update preparation guards plus selection callbacks |
| C9 | Real checkout overlaps a waiting catalogue transaction without losing stock |
| C10 | Actual catalogue/HTTP/IPC authorization, cost masking and forged-write rejection |
| C11 | Exact stale revision rejection, separate-connection competing edits and reference protection |
| C12 | Durable replay, metadata-preserving saves and actual local sync serialization/acknowledgement tests; production cloud update pending |
| C13 | Disposable existing-schema additive upgrade, preservation checks and fail-closed incomplete schemas; packaged shop upgrade pending F-00 |
| C14 | Shared formatting, whitespace handling and escaped label generation; physical long-label fit pending |

## Owner test on the development laptop

1. Restart the development app and log in. Open Products; confirm legacy products still load.
2. Add a test prepared product with two variants differing in size, quality or style reference. Generate each barcode, save, reopen and verify the codes/details remain distinct. Preparation should have no activation switch.
3. Open the same saved product twice, save one edit, then try saving the older edit. Expect a stale-edit message requiring reload.
4. In POS, search/scan a prepared code: expect a conversion-pending warning. An existing legacy code should remain billable. Use development data for any test sale.
5. Print labels from the saved variant: preview five copies, confirm the description/code, test printer failure/retry and verify stock is unchanged. Do not apply these preparation labels to selling stock yet.
6. If testing permissions, log in as staff without Manage Products or Print Sticker and confirm those operations are denied. Restricted cost values should not be shown.

## Dependencies and deployment

- ST-03 still owns fresh counts, held conversion batches and once-only activation. No audited quantities or seven unspecified shirt sales were allocated; no real labels were applied.
- New catalogue metadata remains local/pending against the existing cloud until a compatible server implementation is prepared and tested. No cloud files, deployment or production data were changed.
- F-00 safe installed-database upgrade/restore behavior remains a release prerequisite. The scoped catalogue authorization fixes do not claim to repair every legacy IPC handler.
- No live shop database was opened by these tests. No shop update, database transfer, installer packaging or rollout was performed.
