# Expenses and drawer review

## Scope and access

Expenses records business spending by expense date, category, amount, description/reference and payment source. Active cash-register permission or admin access is required. Dedicated Electron IPC checks the fresh signed-in session; renderer user IDs cannot authorize a request.

This is a spending register, not a net-profit or GST-input-credit report. Amounts are recorded including tax as paid, and CSV exports mark tax treatment as not reviewed. Supplier invoices, owner withdrawals, opening float and float adjustments are not operating expenses here. Purchase charges already included in stock cost must not be entered again.

## New expenses

Open Expenses → Add expense. Categories include rent, electricity, wages, transport, local fees, maintenance, supplies, communication, refreshments and other business expense.

- Shop cash drawer creates one linked CASH_OUT in today's single open register. New drawer payments must be dated today. If an earlier payment already exists, review its drawer entry instead.
- UPI, bank and personal/outside-drawer cash record spending without changing drawer cash. These record payments already made; the app does not transfer money or update a bank account.
- Confirmed saves use durable operation IDs. Lost responses freeze the form; retry uses the same payload and operation ID. Concurrent/repeated confirmation cannot create another expense or cash movement.

## Existing drawer entries

Unlinked CASH_OUT rows in EXPENSE, FREIGHT or MUNICIPALITY appear automatically as Needs review. They are a read-time projection, not copied into a second cash ledger. Linked PurchasePayment rows are excluded even if older records used the generic EXPENSE category. OWNER_WITHDRAWAL, CHANGE_FLOAT, TOP_UP, supplier-payment/refund categories and customer refunds do not enter this review list.

Review selects either a business category or exclusion, with a reason. Confirmation creates an expense classification referencing the original drawer transaction; it never creates a new outflow. Freight may already be a purchase cost, and broad tax/municipality notes need review rather than automatically affecting profit. Unreviewed rows are shown separately and are not included in recorded business-expense totals.

## Corrections and audit

Change opens three actions:

- Include/change business category: preserves the payment and original amount.
- Exclude from expenses: removes the amount from business-expense totals without changing cash. An excluded entry can later be classified again, with another audit reason.
- Void a mistaken entry: for a recording error, not an actual expense refund. Non-drawer entries become void without touching cash. An expense linked to today's open drawer gets one equal CASH_IN reversal and becomes void. Original outflow, reversal and reasons stay in history.

Closed-register cash entries cannot be voided through this page because that would change a reconciled period. They can be excluded/reclassified without changing the counted cash movement. Wrong amounts require void-and-reenter where allowed. Actual expense refunds, invoice attachments, tax allocation and changes to a closed register's cash are not included in this release.

Cash Register deletion refuses both the original and reversal transaction of an expense. Expense creation and actions share the register operation queue with closing. Database transactions keep the expense, cash linkage, audit history and replay result together; a late failure rolls everything back.

## Reports

Date, status, payment-source and text filters apply to the full dataset; table pages contain 50 rows. Summary cards show confirmed expense amounts and unreviewed drawer amounts separately. Excluded and void entries remain visible but contribute zero to confirmed expenses.

Export CSV uses the current filters across all pages, up to 10,000 rows. It includes date, category, amount INR, description, source, status, whether the entry contributes to recorded expenses, and tax-treatment status. Formula-like descriptions are escaped before spreadsheet export. No files are automatically sent to the accountant.

## Storage and tests

Additive local SQLite sidecars: ShopExpense, ShopExpenseAudit, ShopExpenseOperation and ShopExpenseLock. New and reviewed entries have a unique drawerTxId. Queries combine these records with unclassified original drawer rows and suppress linked duplicates. Local expense sync to the web dashboard is not implemented.

`npm run test:expenses`

Tests use disposable SQLite and the actual renderer service, preload bridge, secured expense handlers and cash-deletion guard. Coverage includes classification without duplicate cash, supplier/owner/float exclusions, noncash expenses, save replay, transaction rollback, open-register reversal, closed-register preservation, CSV safety, pagination, reconnect, permission revocation and UI recovery of uncertain requests. The live POS database is not used.
