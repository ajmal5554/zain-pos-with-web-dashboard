# Refund workflow — release 1A

Implemented in source; not packaged or installed on the shop PC by this change.

## Staff workflow

- Open a bill in Sales and choose Refund.
- Select the pieces being returned. Previously exchanged/refunded pieces are excluded.
- Returning the full untouched bill, or all remaining pieces after refunds only, calculates the remaining payment automatically. A single original piece therefore refunds its net payment automatically.
- For a partial return, enter **Discount originally given on returned item(s)**. Enter 0 explicitly if there was no discount. This is the combined original discount for the selected pieces, not a new discount or a percentage.
- Choose the actual refund method, Cash or UPI, enter the reason, and confirm. The recorded payment is exactly the displayed refund amount.
- The current permission remains `permEditSales` (or admin). Wider permission/session repairs belong to release 1B.

Examples: one ₹700 shirt with ₹100 off refunds ₹600 automatically. From a multi-item bill, a ₹700 shirt with a staff-confirmed ₹50 discount refunds ₹650. If the first ₹650 refund is from a ₹1,600 two-piece bill, the final remaining piece refunds ₹950 automatically.

## Preserved behavior

Normal checkout still uses one bill discount. No automatic equal/proportional allocation is imposed on historical bills. Exchange credit remains the original billed selling price before discounts; exchanging a ₹700 item for ₹725 still collects ₹25. Original invoice amounts are not rewritten.

## Protection and records

The main process re-reads invoice history inside the refund transaction, recomputes amounts, validates remaining quantities and discount/payment limits, and rejects duplicate variant entries. Exchange quantity validation uses the same remaining-return checks without changing exchange pricing.

RefundItem amounts store the net refund for each selected variant. A combined confirmed discount is distributed across selected lines in paise so their amounts reconcile exactly. Audit details store that allocation, the confirmed total discount, and whether the amount was automatic or staff-confirmed. This allocation records the current refund decision; it does not prove historical item-level bargaining.

A request ID recorded atomically in the audit log prevents an identical retry from creating a second refund or restocking again. Buttons are disabled while submitting. This does not provide a durable pending-request recovery UI across app restarts. Refund stock changes are marked pending sync.

## Cases requiring review

- A replacement funded with exchange/store credit is not automatically converted into a cash refund. The new guard checks the fresh-payment limit; cases exceeding it are stopped for review. Linked return of exchange credit needs a separate policy/workflow.
- After exchanges, remaining item discounts still need confirmation. The app does not invent how the old bill discount was distributed to exchanged pieces.
- Historical bills where recorded refunds differ from cash actually handed over are not repaired here. Review those records separately.
- An original bill containing the same variant at different unit prices is stopped for review because current return records identify variants, not original sale lines.

## Verification

Run `npm run typecheck` and `npm run test:refunds`.

The regression suite tests the shared calculation and executes the real refund/exchange transaction handlers against a disposable SQLite database with synthetic products and users. Cloud upload is stubbed. Tests cover actual paid amounts, explicit partial discounts, multi-piece lines, remaining discount/payment limits, invalid quantities/payments, paise allocation, repeated requests, restocking/sync marking, split-paid invoices, and unchanged exchange credit.

The temporary database matches `prisma/generated/client/schema.prisma`, the runtime client's schema. A pre-existing mismatch was discovered: it includes fields such as `permManageCashDrawer` absent from `prisma/schema.prisma`. Neither schema nor generated client was changed. Reconcile this drift before a production build/migration; do not blindly push either schema to the shop database.

Live UI interaction, physical cash operations, printing, and cloud reporting were not tested. Cross-app report reconciliation and sync reliability remain release 1C work. No shop database or historical invoice was modified by implementation or tests.

## Follow-up: stale POS cart after a return

POS now fetches the saved invoice's current status before restoring its session. If it has a refund/exchange, was voided, or is an exchange-credit replacement, the stale session/cart is cleared and POS prepares a new bill. A database-read failure blocks restoration with a retry option. Ordinary bills retain their draft corrections; an intentionally empty draft is not silently refilled. Changes made elsewhere cause the latest invoice to be reloaded.

The checkout X remains a **Back to items** control for ordinary saved bills. Bulk Clear is disabled on saved bills; New Sale remains on checkout only, as requested. Individual corrections remain available before starting another sale. This patch does not implement the full persisted New Sale finalization lifecycle planned for release 1B.

The update transaction independently rejects refunded/exchanged/voided/replacement invoices and inactive users, and now rolls back on errors. Regression tests cover these backend checks, restoration of stale/ordinary/empty drafts, database-read failure, and rollback after a failed stock update. Automated restoration tests execute the actual POS load function with synthetic storage/IPC, not a live Electron UI.
