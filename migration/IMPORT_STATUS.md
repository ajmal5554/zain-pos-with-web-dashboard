# ✅ Import Scripts - Ready to Use

## Status: All Fixed! 🎉

Both import scripts have been updated and are now fully functional with no TypeScript errors.

---

## 📁 Available Import Methods

### 1. Excel Import (Recommended)
**File:** `scripts/import-from-excel.ts`  
**Command:** `npm run import`

**Use when:**
- You can export price list from MaxSell to Excel (.xlsx or .xls)
- Easiest and most common method

**Features:**
- ✅ Auto-detects various column name formats
- ✅ Handles multiple Excel files at once
- ✅ Creates categories automatically
- ✅ Generates detailed import report
- ✅ Smart default category for uncategorized items

---

### 2. CSV Import (Alternative)
**File:** `scripts/import-from-csv.ts`

**Use when:**
- You have CSV exports from MaxSell
- Requires files named: `products.csv` and optionally `customers.csv`

---

## 🔧 What Was Fixed

All scripts now correctly match the Prisma schema:

| Issue | Fixed To |
|-------|----------|
| `Category.description` | Removed (doesn't exist in schema) |
| `categoryId` type | Changed from `number` to `string` (UUIDs) |
| `Product.sku` | Removed from Product model (only in ProductVariant) |
| `hsnCode` | Changed to `hsn` |
| `gstRate` | Changed to `taxRate` |
| `purchasePrice` | Changed to `costPrice` |
| Missing category handling | Added `getOrCreateDefaultCategory()` helper |

---

## 📊 How to Use

### Step 1: Export from MaxSell
On your shop computer:
1. Open MaxSell POS
2. Go to Reports → Export
3. Export **Price List** to Excel
4. Save as `pricelist.xlsx` or `products.xlsx`

### Step 2: Transfer Files
1. Copy Excel file to USB drive
2. On laptop, paste into: `C:\Users\LENOVO\Desktop\zain pos\migration\`

### Step 3: Run Import
```powershell
cd "C:\Users\LENOVO\Desktop\zain pos"
npm run import
```

### Step 4: Verify
1. Open POS app: `npm run electron:dev`
2. Login: admin / admin123
3. Go to Products page
4. Verify all products imported correctly

---

## 📄 Import Report

After import completes, check:
- `migration/import-report.txt` - Detailed summary with any errors

---

## 🎯 What Gets Imported

From MaxSell → New POS:

| MaxSell Data | → | New POS Table | Field |
|--------------|---|---------------|-------|
| Product Name | → | Product | name |
| Category | → | Category | name |
| HSN Code | → | Product | hsn |
| GST % | → | Product | taxRate |
| MRP | → | ProductVariant | mrp |
| Selling Price | → | ProductVariant | sellingPrice |
| Purchase Price | → | ProductVariant | costPrice |
| Stock | → | ProductVariant | stock |
| Barcode | → | ProductVariant | barcode |
| Size | → | ProductVariant | size |
| Color | → | ProductVariant | color |

---

## ⚠️ Important Notes

1. **Unique Barcodes:** Each product variant must have a unique barcode
2. **Categories:** Products without categories go to "Uncategorized"
3. **Product Names:** Used to detect duplicates (not SKU)
4. **Default Size:** Products without size get "Standard"
5. **Stock Levels:** Imported as-is from Excel

---

## 🐛 Troubleshooting

### "No Excel files found"
- Ensure file is in `migration` folder
- Check file extension is `.xlsx` or `.xls`

### "No data found"
- Open Excel file and verify it has data
- Ensure first row has column headers

### Import errors
- Check `migration/import-report.txt` for details
- Common issues:
  - Missing product names
  - Invalid prices (non-numeric)
  - Duplicate barcodes

---

## ✅ All Set!

Your import scripts are ready to use. Just export from MaxSell and run `npm run import`!
