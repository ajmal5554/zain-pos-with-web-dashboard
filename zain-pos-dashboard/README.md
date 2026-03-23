# Zain POS Web Dashboard

Hosted admin dashboard for monitoring and controlling the POS remotely.

## Current Functional Areas

- dashboard overview
- sales
- inventory
- products
- invoices
- GST reports
- forecasting
- users
- permissions
- settings
- activity

## Local Setup

1. Install dependencies:
```powershell
npm install
```

2. Create env file:
```powershell
copy .env.example .env
```

3. Set API URL:
```env
VITE_API_URL=http://localhost:3001
```

4. Start dev server:
```powershell
npm run dev
```

## Demo Mode

For local UI work without backend auth, the login page supports demo mode in development.

## Production Build

```powershell
npm run build
```

Build output is in `dist/`.

## Production Env

Use [`zain-pos-dashboard/.env.production.example`](c:/Users/admin/Downloads/zain-POS-with-web-main/zain-POS-with-web-main/zain-pos-dashboard/.env.production.example) as the template.

Required value:
- `VITE_API_URL=https://your-api-domain.example.com`

## Hosting Options

This app is a static Vite frontend. It can be hosted on:
- Vercel
- Netlify
- Cloudflare Pages
- Nginx / Apache / S3 + CDN

`vercel.json` is already present for SPA rewrites.

## Vercel Example

1. Import `zain-pos-dashboard` into Vercel.
2. Set build command:
```text
npm run build
```
3. Set output directory:
```text
dist
```
4. Add env var:
```text
VITE_API_URL=https://your-api-domain.example.com
```

## Important Runtime Notes

- The dashboard talks only to the hosted API, not the local desktop database.
- Remote control works only for features the API exposes.
- For live business data, the desktop POS must sync to the hosted API.
