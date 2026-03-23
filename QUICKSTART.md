# 🚀 Quick Start Guide - Zain POS

## Installation (5 Minutes)

### Step 1: Install Dependencies

Open PowerShell in the project folder and run:

```powershell
cd "C:\Users\LENOVO\Desktop\zain pos"
npm install
```

Wait for all packages to download (~2-3 minutes).

### Step 2: Setup Database

```powershell
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
```

This creates the database and adds sample data.

### Step 3: Run the Application

```powershell
npm run electron:dev
```

The application will open automatically!

## First Login

Use these credentials:

**Username:** `admin`  
**Password:** `admin123`

## Quick Tour

### 1. Dashboard
- View today's sales
- Check low stock items
- See top products

### 2. Add a Product

1. Click **Products** in sidebar
2. Click **Add Product**
3. Fill in:
   - Name: "Test Shirt"
   - Category: "Shirts"
   - Size: "M"
   - MRP: 1000
   - Selling Price: 850
   - Stock: 10
4. Click **Create Product**
5. Barcode is generated automatically!

### 3. Make a Sale

1. Click **POS** in sidebar
2. Click on the product you just added (or scan barcode)
3. Product appears in cart
4. Click **Checkout**
5. Select payment method: **Cash**
6. Enter paid amount: 1000
7. Click **Complete Sale**
8. Receipt will print (if printer is connected)

### 4. View Sales

1. Click **Sales** in sidebar
2. See your sale listed
3. Click eye icon to view details

## Build .exe Installer

When ready for production:

```powershell
npm run electron:build
```

Installer will be in `release/` folder.

## Keyboard Shortcuts

- **F2** - Go to POS
- **F3** - Go to Products
- **Ctrl+P** - Print receipt
- **Esc** - Close modal

## Common Tasks

### Add More Products

Products → Add Product → Fill form → Create

### Print Barcode Label

Products → Click printer icon next to product

### View Reports

Reports → Click "Daily Sales Report" or "Monthly Sales Report"

### Change Settings

Settings → Update shop info → Save

## Troubleshooting

### "npm not found"

Install Node.js from: https://nodejs.org/

### Database error

```powershell
npx prisma migrate reset
npx prisma db seed
```

### Port already in use

Close other Electron apps or change port in `vite.config.ts`

## Next Steps

1. ✅ Test the application
2. ✅ Add your real products
3. ✅ Setup hardware (printers, scanner)
4. ✅ Train your staff
5. ✅ Build .exe and install on shop computer

## Support

Need help? Contact:
- 📞 9037106449
- 📞 7907026827

---

**Enjoy your new POS system! 🎉**
