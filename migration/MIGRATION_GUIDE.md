# MaxSell Data Migration Guide

## Overview

You have two MaxSell backup files:
- `Maxsll22_zain_02_02_2024_13_15_39_PM.bak` (65 MB)
- `Maxsll22_zaindp_02_02_2024_13_15_40_PM.bak` (58 MB)

These are SQL Server database backups from February 2, 2024.

## Migration Options

### ⭐ Option 1: CSV Export (Recommended - Easiest)

**Why this is easier:**
- No need to install SQL Server
- Works directly on your shop computer
- Faster and simpler

**Steps:**

1. **On your shop desktop (where MaxSell is installed):**
   - Open MaxSell POS
   - Go to **Reports** → **Export Data** (or similar menu)
   - Export these files:
     - Products → `products.csv`
     - Customers → `customers.csv`
     - Categories → `categories.csv`
   - Copy files to USB drive
   - Transfer to laptop

2. **On your laptop:**
   - I'll create a CSV import script
   - Import all data automatically
   - Verify everything

---

### Option 2: Direct .bak Restore (Advanced)

**Requirements:**
- Install SQL Server Express (free, ~500MB download)
- Restore the backup files
- Run migration script

**Steps:**

#### Step 1: Install SQL Server Express

```powershell
# Download SQL Server Express from:
# https://www.microsoft.com/en-us/sql-server/sql-server-downloads

# Or use winget:
winget install Microsoft.SQLServer.2022.Express
```

#### Step 2: Restore Backup

**Option A: Using SQL Server Management Studio (SSMS)**
1. Install SSMS (free)
2. Connect to `localhost\SQLEXPRESS`
3. Right-click Databases → Restore Database
4. Select the `.bak` file
5. Restore as `Maxsll22_zain`

**Option B: Using Command Line**
```powershell
sqlcmd -S localhost\SQLEXPRESS -Q "RESTORE DATABASE Maxsll22_zain FROM DISK='C:\Users\LENOVO\Desktop\zain pos\migration\Maxsll22_zain_02_02_2024_13_15_39_PM.bak' WITH REPLACE"
```

#### Step 3: Run Migration Script

```powershell
cd "C:\Users\LENOVO\Desktop\zain pos"
npx ts-node scripts/migrate-from-maxsell.ts
```

---

### Option 3: Manual Excel Import (Fallback)

If CSV export is not available in MaxSell:

1. **On shop computer:**
   - Open MaxSell database (if accessible)
   - Copy product data to Excel
   - Copy customer data to Excel
   - Save as `.xlsx` files

2. **Transfer to laptop and import**

---

## Recommended Approach

I recommend **Option 1 (CSV Export)** because:
- ✅ No software installation needed
- ✅ Works on your existing setup
- ✅ Faster and simpler
- ✅ Less error-prone

## What Data Will Be Imported?

From MaxSell to Zain POS:

| MaxSell Data | → | New POS Table |
|--------------|---|---------------|
| Products | → | Product + ProductVariant |
| Categories | → | Category |
| Customers | → | Customer |
| Stock Levels | → | ProductVariant.stock |
| Prices (MRP, Selling) | → | ProductVariant.mrp, sellingPrice |
| Barcodes | → | ProductVariant.barcode |
| HSN Codes | → | Product.hsnCode |
| GST Rates | → | Product.gstRate |

## Next Steps

**Please choose your preferred option:**

1. **CSV Export** - Go to shop, export from MaxSell, bring files back
2. **Direct Restore** - I'll guide you through installing SQL Server
3. **Manual Entry** - Use the new POS to add products manually

Let me know which option works best for you!
