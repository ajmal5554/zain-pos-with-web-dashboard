# Zain POS App Documentation, Scenario Manual, and Codebase Review

Last reviewed: 2026-09-16

## 1. App Summary

Zain POS is an offline-first retail point-of-sale system for a clothing shop. The repository contains three connected applications:

- Desktop POS app: Electron + React + TypeScript + SQLite/Prisma. This is the main billing counter app.
- Cloud/API backend: Express + Prisma. This receives synced desktop data and serves the web dashboard.
- Web dashboard: Vite + React. This gives remote/mobile views for sales, inventory, reports, users, permissions, notifications, and settings.

The main data model is centered around products, variants, customers, sales, payments, stock movements, users, audit logs, exchanges, refunds, settings, printer configuration, and sync queue records.

Relevant code:

- Desktop routes and permissions: `src/App.tsx`
- Desktop database IPC wrapper: `src/lib/db.ts`
- Electron main process and business actions: `electron/main.ts`
- Permission system: `electron/permission.service.ts`
- Database schema: `prisma/schema.prisma`
- API routes: `zain-pos-api/src/routes`
- Dashboard routes: `zain-pos-dashboard/src/App.tsx`

## 2. Main Features

### Desktop POS

- Staff login with active/inactive user checks.
- Role and permission controlled navigation.
- Barcode scan billing and product search billing.
- Cash, card, UPI, and split payment checkout.
- GST-inclusive calculation, CGST/SGST split, and receipt data.
- Direct post-sale edit window from POS after saving a sale.
- Sales history with filtering, searching, reprint, payment update, void, exchange, and refund flows.
- Product and variant management with barcode/SKU, size, color, MRP, selling price, cost price, stock, and min stock.
- Soft deletion of products/variants to preserve sales history.
- Customer management.
- Reports, GST reports, dashboard metrics, activity logs, and forecasting page.
- Printer settings, receipt designer, label designer, test print, and printer connection checks.
- Manual backup, restore, Excel export/import, product import template, and cloud sync settings.
- Offline sync queue for failed cloud sync attempts.

### Web Dashboard

- JWT login.
- Sales dashboard and reporting.
- Inventory, low-stock, and product management.
- Customer, user, permission, settings, activity, notification, and forecasting pages.
- Mobile/PWA-style dashboard support.
- API-backed admin/product mutations with server-side permission checks on sensitive write operations.

## 3. Roles and Permissions

Admins bypass most permission checks. Cashier users rely on permission flags.

Important permission flags:

- `permAddItem`: add products to a sale.
- `permDeleteProduct`: remove items/products depending on context.
- `permVoidSale`: void completed sales.
- `permViewReports`: dashboard/activity/general report access.
- `permViewSales`: sales history access.
- `permViewGstReports`: GST reports access.
- `permManageProducts`: product/category/variant management.
- `permEditSettings`: shop, print, data, sync settings.
- `permEditSales`: edit completed sales, process refunds/exchanges.
- `permManageInventory`: intended stock/inventory management permission.
- `permManageUsers`: user and permission administration.
- `permViewCostPrice`: cost visibility.
- `permChangePayment`: payment correction after sale.
- `permBulkUpdate`: intended bulk operation permission.
- `permBackDateSale`: intended back-dated sale permission.
- `permViewInsights`: forecasting/insights access.
- `maxDiscount`: percentage discount cap for non-admin users in the POS screen.

Desktop route access is defined in `src/App.tsx`. The POS page is available to any authenticated user; restricted pages are wrapped with `PermissionRoute`.

## 4. System Architecture

### Desktop App Flow

1. User logs in through Electron IPC.
2. React stores the logged-in user in Zustand.
3. UI calls `db` methods from `src/lib/db.ts`.
4. `db` calls `window.electronAPI.db.secureQuery`.
5. Electron validates the requested Prisma model/method through the permission matrix in `electron/main.ts`.
6. Electron performs Prisma operations on local SQLite.
7. Sale/refund/exchange actions queue real-time or offline cloud sync through `electron/sync.service.ts`.

### Cloud/Web Flow

1. Dashboard logs in through `/api/auth/login`.
2. API returns a JWT valid for 365 days.
3. Dashboard stores token and user in `localStorage`.
4. API routes use `authMiddleware` to verify the token.
5. Some mutation routes additionally check user permissions, such as product management and user management.

### Sync Flow

1. Desktop keeps local data as source of operation.
2. Settings provide `CLOUD_API_URL` and `CLOUD_SYNC_SECRET`.
3. New sales, exchanges, and refunds attempt immediate sync.
4. Failed sync attempts are stored in `SyncQueue`.
5. Manual or scheduled sync can drain pending queue and verify cloud state.

## 5. Step-by-Step Tutorials

### Scenario A: Start the Shop Day

1. Open the desktop POS app.
2. Log in with an active staff account.
3. Confirm the network indicator if cloud sync is required.
4. Go to Settings > Print and test the receipt printer if this is the first billing session of the day.
5. Go to POS.
6. Confirm the bill number preview is visible.
7. Scan one known product or search for it to confirm products load.
8. Clear the test cart if needed.

Expected result: the cashier is ready to bill; products are searchable; printer and sync state are known.

### Scenario B: Create a Normal Sale

1. Open POS.
2. Scan a barcode or search by item name/barcode/SKU.
3. Add each product variant to the cart.
4. Adjust quantities if needed.
5. Confirm customer name or keep Walk-in Customer.
6. Click checkout/payment.
7. Apply a bill discount only if approved by shop policy.
8. Choose Cash, Card, UPI, or Split.
9. For Cash, enter the received amount and verify change.
10. For Card/UPI, confirm the amount matches the final total.
11. For Split, enter amounts for each payment method until the total is fully covered.
12. Complete sale.
13. Print the receipt if required.

Expected result: a sale is created, stock decreases, payment rows are created, and cloud sync is attempted.

### Scenario C: Edit a Sale Immediately After Saving

1. Complete a sale in POS.
2. Stay on the POS screen; do not start a new sale unless the current sale is final.
3. Modify items, quantities, customer, discount, or payment as needed.
4. Save the updated sale.
5. Reprint the corrected receipt if needed.

Management detail: this is a powerful correction workflow. It changes the original sale rows and stock deltas, then logs an activity entry when persisted values changed.

### Scenario D: Correct Payment Mode Later

1. Go to Sales.
2. Search by bill number, customer, item, or staff.
3. Open the sale.
4. Choose the payment update action.
5. Select the new payment method or split values.
6. Save.

Expected result: invoice payment rows are replaced, the sale payment method is updated, and an audit log is created if there was an actual payment change.

Permission required: admin, `permChangePayment`, or `permEditSales` for exchange-generated sale corrections.

### Scenario E: Void a Sale

1. Go to Sales.
2. Find the incorrect sale.
3. Choose Void.
4. Enter a clear reason.
5. Confirm.

Expected result: sale status becomes `VOIDED`, stock is returned, inventory movements are created, and activity is logged.

Management rule: void is best for immediate cancellation. If the customer took goods and came back later, use Refund or Exchange instead.

### Scenario F: Process a Refund

1. Go to Sales.
2. Open the original invoice.
3. Choose Refund.
4. Select refundable items and quantities.
5. Enter a mandatory refund reason.
6. Select refund payment mode(s).
7. Confirm refund and restock.

Expected result: original bill remains as history, a Refund record is created, stock is increased, and refund activity is logged.

### Scenario G: Process an Exchange

1. Go to Sales.
2. Open the original invoice.
3. Choose Exchange.
4. Select returned item(s) and quantities.
5. Select replacement item(s).
6. Review returned value, replacement value, difference amount, payable amount, and store credit note if any.
7. Choose replacement payment mode if money is collected.
8. Confirm exchange.

Expected result:

- Original sale remains immutable except an exchange note is appended to remarks.
- An Exchange record is created.
- Returned stock increases.
- Replacement stock decreases.
- A replacement sale is created for replacement items.
- The replacement bill can include `EXCHANGE_CREDIT` payment.

### Scenario H: Add a New Product

1. Go to Products.
2. Click Add Product.
3. Enter product name, category, HSN, and tax rate.
4. Add one or more variants with size, color, MRP, selling price, cost price, stock, min stock, SKU, and barcode.
5. Generate a barcode if needed.
6. Save.
7. Print labels for each variant if needed.

Expected result: product and variants are active and immediately usable in POS.

### Scenario I: Update Product Stock or Price

1. Go to Products.
2. Search for the product or barcode.
3. Edit the product.
4. Update variant stock, MRP, selling price, cost price, or min stock.
5. Save.

Management detail: current desktop product updates directly modify variant stock without creating an inventory movement. For audit-grade stock management, prefer a dedicated adjustment workflow.

### Scenario J: Delete/Deactivate a Product

1. Go to Products.
2. Search and choose delete.
3. Confirm deletion.

Expected result: product and variants are marked inactive, not physically removed, so old sales can still display item names.

### Scenario K: Configure Printers

1. Go to Settings > Print.
2. Enter receipt printer and label printer names exactly as Windows lists them.
3. Save printer settings.
4. Test connection.
5. Print a test receipt and test label.

Expected result: app can silently print to configured devices.

### Scenario L: Backup and Restore

1. Go to Settings > Data.
2. Use Backup before large imports, restore attempts, or major product edits.
3. To restore, choose Restore and select a valid `.db` backup.
4. Confirm the destructive restore prompt.
5. Restart if prompted.

Expected result: app verifies backup integrity before restore and creates a pre-restore backup where possible.

### Scenario M: Configure Cloud Sync

1. Go to Settings > Sync.
2. Enter API URL.
3. Enter cloud sync secret.
4. Choose sync interval or keep manual.
5. Save.
6. Click Sync Now.

Expected result: local sales/products/refunds/exchanges are pushed to the API where configured.

### Scenario N: Manage Users and Permissions

1. Log in as admin or a user with `permManageUsers`.
2. Go to Users to create, update, deactivate, or reset passwords.
3. Go to Permissions to toggle staff privileges and discount cap.
4. Review Activity after permission changes.

Recommended practice: use least privilege. Cashiers should only receive the permissions required for daily counter work.

## 6. Scenario Management Rules

### Sale Correction Policy

- Wrong payment only: use Payment Update.
- Wrong items immediately after sale: use POS direct edit if still in the correction window.
- Sale should not exist: use Void if no refund/exchange happened.
- Customer returned goods: use Refund.
- Customer swapped goods: use Exchange.

### Inventory Policy

- Every completed sale decreases stock.
- Every void returns stock.
- Every refund returns stock.
- Every exchange return increases stock.
- Every exchange replacement decreases stock.
- Product edit stock changes are currently direct stock overwrites; treat them as admin-level corrections.

### Audit Policy

- Routine sale creation is intentionally not logged as Activity because Sales History is the operational record.
- Security/business-sensitive actions should appear in Activity: payment update, sale update, void, exchange, refund, user changes, settings changes, remote product/user changes.

### Backup Policy

- Take a manual backup before import/restore/product bulk changes.
- Keep durable backups outside the app install path.
- Do not rely on the bundled database as a live backup.

## 7. Bugs, Loopholes, and Practical Risks Found

### High Severity

1. Checkout is not protected by the centralized secure IPC wrapper.

Code reference: `electron/main.ts:1749`.

Impact: `sales:checkout` trusts `saleData.userId` and does not re-check that the user is active, has `permAddItem`, or is within discount limits. The POS screen checks `permAddItem` at `src/pages/POS.tsx:592` and `src/pages/POS.tsx:623`, but renderer checks are bypassable in an Electron environment.

Recommended fix: convert checkout to `createSecureIpcHandler`, require active user plus `permAddItem`, re-fetch user permissions in main process, and enforce `maxDiscount` server-side.

2. Stock can go negative during checkout, sale edits, and exchanges.

Code references: `electron/main.ts:1822`, `electron/main.ts:2085`, `electron/main.ts:2672`.

Impact: decrement operations do not verify available stock before reducing inventory. A cashier can sell or exchange more items than available, especially with stale product data or concurrent actions.

Recommended fix: inside the same transaction, fetch each variant stock and reject if requested quantity exceeds available stock, unless an explicit admin override permission exists.

3. Refund backend does not subtract quantities already returned through exchanges.

Code references: exchange validation subtracts previous refunds and exchanges at `electron/main.ts:2527`; refund validation only subtracts previous refunds at `electron/main.ts:3001`.

Impact: the UI prepares refund quantities by subtracting exchanges (`src/pages/Sales.tsx:421`), but the backend does not enforce it. A crafted or stale request could refund an item quantity that was already exchanged.

Recommended fix: include exchanges in the refund query and subtract exchanged returned quantities before allowing refund quantities.

4. Several powerful data operations are not permission-gated.

Code references: `electron/main.ts:3451` export all, `electron/main.ts:3540` product import, `electron/main.ts:3665` import all, `electron/main.ts:4080` backup, and `electron/main.ts:4124` restore.

Impact: these handlers are direct `ipcMain.handle` calls rather than secure permission handlers. UI page access requires `permEditSettings`, but the main process should enforce this too.

Recommended fix: wrap data import/export/backup/restore handlers in secure IPC permission checks, at minimum `permEditSettings` or admin-only for restore/import-all.

### Medium Severity

5. Sale read handlers expose data without explicit main-process auth.

Code reference: `electron/main.ts:2001`.

Impact: `sales:getSaleById` accepts a sale ID without user validation. UI access is gated elsewhere, but the handler should still require an active user and `permViewSales` or contextual permission.

Recommended fix: include `userId` and wrap with a permission check.

6. Discount cap is UI-enforced but not reliably business-enforced.

Code references: UI check at `src/pages/POS.tsx:770`; checkout handler at `electron/main.ts:1749`.

Impact: a non-admin with a discount cap can be blocked in the UI, but the main process still accepts arbitrary sale totals if called directly.

Recommended fix: compute subtotal/discount from trusted item data in main process and compare against the database user's `maxDiscount`.

7. Bill number generation only scans the most recent 1000 bills.

Code reference: `electron/main.ts:286`.

Impact: if an older imported bill has a higher numeric bill number but is outside the latest 1000 rows by `createdAt`, the next generated bill number can collide or go backwards.

Recommended fix: query the maximum numeric bill number more directly, or maintain a dedicated bill sequence table.

8. Desktop Sales date filtering uses `createdAt`, while other reporting paths use effective sale date.

Code references: desktop Sales filters at `src/pages/Sales.tsx:212`, `src/pages/Sales.tsx:214`, `src/pages/Sales.tsx:216`, `src/pages/Sales.tsx:218`; API reports use `actualSaleDate` fallback logic.

Impact: imported or back-dated sales can appear in different date buckets between Sales and Reports/API.

Recommended fix: update desktop Sales filtering to use the same `actualSaleDate ?? createdAt` logic, likely using an `OR` filter like the API.

9. Web dashboard route protection is login-only.

Code reference: `zain-pos-dashboard/src/App.tsx:39` and `zain-pos-dashboard/src/App.tsx:46`.

Impact: users can navigate to pages their role should not use, then hit API-level 403s or see partial UI. This is not the primary security boundary, but it is confusing and can leak feature presence.

Recommended fix: mirror permission-aware route guards in the dashboard frontend.

10. JWT token lifetime is very long.

Code reference: `zain-pos-api/src/routes/auth.ts:49`.

Impact: dashboard tokens last 365 days. If a device is lost, access can remain valid until password rotation or token secret rotation.

Recommended fix: shorten token life, add refresh tokens or session revocation, and force logout on inactive/deactivated users by checking current user state in middleware.

### Low Severity / Operational Notes

11. Plain password fallback exists for legacy accounts.

Code reference: `zain-pos-api/src/routes/auth.ts:27`.

Impact: it auto-upgrades matching plain text passwords to bcrypt, which is useful for migration, but this fallback should be removed after all legacy data is upgraded.

12. Web dashboard read endpoints are broadly available to any authenticated user.

Code references: API routes apply `authMiddleware`, for example `zain-pos-api/src/routes/sales.ts:8`, `zain-pos-api/src/routes/reports.ts:8`, `zain-pos-api/src/routes/inventory.ts:8`. Product write routes add permission checks at `zain-pos-api/src/routes/inventory.ts:15`.

Impact: any authenticated dashboard user may read sales/reports/inventory unless additional route-level permission checks are added.

Recommended fix: enforce `permViewSales`, `permViewReports`, `permViewGstReports`, and `permManageProducts`/inventory read policy in API read routes.

13. Product update can overwrite stock without inventory movement.

Code reference: product edit flow updates variant stock directly in `src/pages/Products.tsx` and via secure query.

Impact: stock corrections are not always traceable as inventory movements.

Recommended fix: create a dedicated stock adjustment workflow that records movement reason, reference, old stock, new stock, and actor.

## 8. Verification Performed

- Reviewed project structure, desktop app routes, state stores, Prisma schema, Electron handlers, permission service, POS/Sales/Products/Settings pages, API auth/sales/inventory/reports/admin routes, sync service, and dashboard routing/auth.
- Ran desktop/Electron typecheck successfully:

```bash
npm run typecheck
```

Result: passed.

## 9. Recommended Next Implementation Priorities

1. Secure `sales:checkout` in the main process and enforce active user, `permAddItem`, and discount cap.
2. Add transaction-level stock availability checks for checkout, update sale, and exchange.
3. Fix refund validation to subtract prior exchanged quantities.
4. Permission-gate import/export/backup/restore IPC handlers.
5. Align desktop Sales date filtering with report effective-date logic.
6. Add API permission checks for dashboard read routes.
7. Shorten dashboard JWT lifetime and add current-user active checks in middleware.
