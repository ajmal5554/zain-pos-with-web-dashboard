# Zain POS API

Backend API for the hosted web dashboard and desktop sync.

## What It Serves

- dashboard login
- sales, invoices, inventory, reports, activity
- remote admin pages: users, permissions, settings
- GST report endpoint
- desktop cloud sync endpoints

## Local Setup

1. Install dependencies:
```powershell
npm install
```

2. Create env file:
```powershell
copy .env.example .env
```

3. Set required values in `.env`:
- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `CLOUD_SYNC_SECRET`
- `CORS_ORIGIN`

4. Generate Prisma client and apply schema:
```powershell
npm run prisma:generate
npm run migrate
```

5. Start development server:
```powershell
npm run dev
```

API runs at `http://localhost:3001` by default.

## Production Env

Use [`zain-pos-api/.env.production.example`](c:/Users/admin/Downloads/zain-POS-with-web-main/zain-POS-with-web-main/zain-pos-api/.env.production.example) as the template.

Required production values:
- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `CLOUD_SYNC_SECRET`
- `CORS_ORIGIN`
- `MAINTENANCE_SECRET`

## Build And Run

```powershell
npm install
npm run build
npm start
```

## Deployment Notes

- The API needs PostgreSQL.
- The dashboard host must be included in `CORS_ORIGIN`.
- The desktop app must use the same `CLOUD_SYNC_SECRET` as the API.
- `postinstall` currently runs Prisma generate and `db push`, so your host must have valid database env vars at install/deploy time.

## Main Route Groups

- `POST /api/auth/login`
- `GET /api/sales/*`
- `GET /api/inventory/*`
- `GET /api/invoices/*`
- `GET /api/reports/*`
- `GET/POST/PATCH/PUT /api/admin/*`
- `GET /api/activity`
- `GET/PATCH /api/notifications/*`
- `POST /api/sync/*`

## Hosting Pattern

Typical setup:
1. Host PostgreSQL on Railway, Render, Neon, Supabase, or similar.
2. Host this API on Railway, Render, Fly.io, or a VPS.
3. Set `CORS_ORIGIN` to your dashboard URL.
4. Point the dashboard `VITE_API_URL` to the hosted API.
