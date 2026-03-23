# Zain POS - Project Memory

## Project Overview
- **Type**: Electron desktop POS + Express cloud API + React web dashboard
- **Stack**: React + TypeScript + Vite + Electron + Prisma (SQLite desktop, PostgreSQL cloud) + TailwindCSS
- **Location**: `c:\Users\admin\Downloads\zain-POS-with-web-main\zain-POS-with-web-main`

## Key Architecture
- `electron/main.ts` — 2200+ lines, ALL IPC handlers (needs splitting)
- `src/pages/POS.tsx` — 1200+ lines, main billing screen
- `src/store/authStore.ts` — Zustand auth store with full User type (all 17 permissions)
- `src/services/auth.service.ts` — bcrypt login/create
- `electron/logger.ts` — structured logger (created in session)
- `zain-pos-api/` — Express API for cloud sync/dashboard
- `zain-pos-dashboard/` — React web dashboard (mobile-friendly)

## Fixes Applied (March 2026 Session)
### Backup & Restore
- WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`) before all backups
- `flushDatabaseForBackup()` and `verifyBackupIntegrity()` helpers added
- Pre-restore safety backup created before any restore
- WAL/SHM files handled in backup/restore
- Immediate backup on auto-backup enable

### Security
- bcrypt hashing added to: `users:create`, `users:update`, `ensureDefaultAdmin`, user creation at startup
- `db:query` now has model/method whitelist to prevent arbitrary DB access
- Input validation helpers: `validateSaleData()`, `validateProductData()`, `sanitizeString()`
- `as any` casts removed from permission checks (use proper User type)

### UI/Responsiveness
- POS.tsx billing table columns reduced + overflow-x-auto added
- Modal.tsx: proper flex layout with scrollable content area
- Modal CSS: `overflow-hidden` on container, `overflow-y-auto` on content
- Web dashboard: safe area padding support, larger mobile nav labels

### React
- `ErrorBoundary` component created (`src/components/ui/ErrorBoundary.tsx`)
- All pages in App.tsx wrapped with `<PageBoundary>` for per-page error isolation
- `PermissionRoute` properly typed with `UserPermKey` (no more `as any`)
- Duplicate `function App()` was added by editor — removed

### Database Schema
- Cloud schema (`zain-pos-api/prisma/schema.prisma`) updated to match desktop:
  - Added: Exchange, ExchangeItem, ExchangePayment, Refund, RefundItem, RefundPayment
  - Added: InvoicePayment, SyncQueue
  - Added: All 17+ permission fields to User model
  - Added: Sale.exchanges and Sale.refunds relations

### Logger
- `electron/logger.ts` created — `logger.debug/info/warn/error(context, message, error?)`
- Production: only WARN + ERROR shown; Dev: all levels shown

## Key User Preferences
- Default admin credentials: admin / admin123 (now hashed in DB)
- App targets Indian retail (GST, ₹ currency, CGST/SGST split)
- Shop name: ZAIN GENTS PALACE

## Remaining Work (Not Done)
- Split `electron/main.ts` into modules (too risky without tests)
- No unit tests (zero test coverage)
- 200+ remaining `any` types in pages
- Cloud API has no rate limiting
