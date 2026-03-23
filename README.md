# Zain POS - Point of Sale System

A complete, offline-first desktop Point of Sale application built with Electron, React, TypeScript, and SQLite for clothing retail businesses.

## Features

### 🛒 Core POS Features
- **Fast Billing Interface** - Barcode scanning and quick product selection
- **Multiple Payment Methods** - Cash, Card, and UPI support
- **GST Invoicing** - Automatic CGST/SGST calculation and tax invoices
- **Receipt Printing** - Professional thermal receipt printing on Epson printers
- **Customer Management** - Track customer information and purchase history

### 📦 Inventory Management
- **Product Management** - Add products with multiple variants (size, color)
- **Barcode Generation** - Automatic EAN-13 barcode generation
- **Label Printing** - Print barcode labels on TSC printers
- **Stock Tracking** - Real-time inventory updates and low stock alerts
- **Variant Management** - Handle multiple sizes and colors per product

### 📊 Reports & Analytics
- **Dashboard** - Real-time sales overview and key metrics
- **Daily Sales Reports** - Detailed daily sales summaries
- **Monthly Reports** - Monthly sales trends and analysis
- **Top Products** - Best-selling product analytics
- **Payment Breakdown** - Sales by payment method
- **Tax Reports** - GST summary reports

### 👥 User Management
- **Role-Based Access** - Admin and Cashier roles
- **User Authentication** - Secure login system
- **Activity Tracking** - Track sales by user

### 🖨️ Hardware Integration
- **Epson Thermal Printer** - Receipt/invoice printing
- **TSC Label Printer** - Barcode sticker printing
- **USB Barcode Scanner** - Fast product scanning

### 🎨 Modern UI
- **Dark Mode** - Eye-friendly dark theme support
- **Responsive Design** - Works on different screen sizes
- **Premium Aesthetics** - Modern, professional interface
- **Fast Performance** - Optimized for quick operations

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Desktop Framework**: Electron
- **Database**: SQLite with Prisma ORM
- **Styling**: TailwindCSS
- **State Management**: Zustand
- **Build Tool**: Vite
- **Charts**: Recharts
- **Barcode**: JsBarcode

## Installation

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Windows 10/11

### Setup Steps

1. **Install Dependencies**
   ```bash
   cd "C:\Users\LENOVO\Desktop\zain pos"
   npm install
   ```

2. **Initialize Database**
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   npx prisma db seed
   ```

3. **Run in Development Mode**
   ```bash
   npm run electron:dev
   ```

4. **Build for Production (.exe)**
   ```bash
   npm run electron:build
   ```

   The installer will be created in the `release` folder.

## Default Credentials

After seeding the database, use these credentials to login:

**Admin Account:**
- Username: `admin`
- Password: `admin123`

**Cashier Account:**
- Username: `cashier`
- Password: `cashier123`

## Hardware Setup

### Epson Receipt Printer

1. Install Epson printer drivers from the manufacturer's website
2. Connect the printer via USB
3. Set the printer as default or configure in Settings
4. Test printing from the Settings page

### TSC Label Printer

1. Install TSC printer drivers
2. Connect via USB
3. Configure label size (default: 40mm x 30mm)
4. Test label printing from Products page

### Barcode Scanner

1. Connect USB barcode scanner
2. Configure scanner to add Enter key after scan (if needed)
3. Scanner will work automatically in POS screen
4. Focus will be on barcode input field

## Usage Guide

### 1. Product Management

1. Go to **Products** page
2. Click **Add Product**
3. Fill in product details:
   - Product name
   - Category
   - HSN code (for GST)
   - Tax rate
4. Add variant details:
   - Size and color
   - MRP, selling price, cost price
   - Initial stock quantity
5. Barcode is generated automatically
6. Click **Create Product**
7. Print barcode labels using the Print button

### 2. Point of Sale (Billing)

1. Go to **POS** page
2. Scan barcode or search for products
3. Products are added to cart
4. Adjust quantities using +/- buttons
5. Click **Checkout**
6. Select payment method
7. Enter paid amount
8. Click **Complete Sale**
9. Receipt prints automatically

### 3. Sales History

1. Go to **Sales** page
2. View all past transactions
3. Search by bill number or customer
4. View details or reprint receipts

### 4. Reports

1. Go to **Reports** page
2. Generate daily or monthly reports
3. View sales summaries
4. Export data (PDF/Excel)

### 5. Settings

1. Go to **Settings** page (Admin only)
2. Update shop information
3. Configure printers
4. Manage database backups

## Database Schema

### Main Tables

- **User** - User accounts (Admin/Cashier)
- **Product** - Product master data
- **ProductVariant** - Product variants (size, color, stock)
- **Category** - Product categories
- **Customer** - Customer information
- **Sale** - Sales transactions
- **SaleItem** - Sale line items
- **InventoryMovement** - Stock movement tracking
- **Setting** - Application settings
- **PrinterConfig** - Printer configurations

## Project Structure

```
zain-pos/
├── electron/              # Electron main process
│   ├── main.ts           # Main process entry
│   └── preload.ts        # Preload script
├── prisma/               # Database
│   ├── schema.prisma     # Database schema
│   └── seed.ts           # Seed data
├── src/
│   ├── components/       # React components
│   │   ├── Layout/       # Layout components
│   │   └── ui/           # Reusable UI components
│   ├── pages/            # Page components
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── POS.tsx
│   │   ├── Products.tsx
│   │   ├── Customers.tsx
│   │   ├── Sales.tsx
│   │   ├── Reports.tsx
│   │   └── Settings.tsx
│   ├── services/         # Business logic
│   │   ├── auth.service.ts
│   │   ├── barcode.service.ts
│   │   ├── print.service.ts
│   │   └── reports.service.ts
│   ├── store/            # State management
│   │   ├── authStore.ts
│   │   └── cartStore.ts
│   ├── lib/              # Utilities
│   │   └── db.ts         # Database wrapper
│   ├── types/            # TypeScript types
│   ├── App.tsx           # Main app component
│   ├── main.tsx          # React entry point
│   └── index.css         # Global styles
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## Troubleshooting

### Database Issues

If you encounter database errors:
```bash
npx prisma migrate reset
npx prisma db seed
```

### Build Issues

If the build fails:
1. Delete `node_modules` and `package-lock.json`
2. Run `npm install` again
3. Try building again

### Printer Not Working

1. Check printer is connected and powered on
2. Verify drivers are installed
3. Test print from Windows settings
4. Check printer name in Settings page

## Backup & Restore

### Manual Backup

The database file is located at:
```
prisma/pos.db
```

Copy this file to backup your data.

### Restore

Replace the `pos.db` file with your backup.

## Support

For issues or questions:
- Email: support@zaingentspalace.com
- Phone: 9037106449, 7907026827

## License

© 2026 Zain Gents Palace. All rights reserved.

---

**Built with ❤️ for Zain Gents Palace**
