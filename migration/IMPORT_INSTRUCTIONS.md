# 📊 How to Import Your MaxSell Data

## Quick Steps

### 1. Export from MaxSell (On Shop Computer)

1. **Open MaxSell POS** on your shop desktop
2. **Export Price List**:
   - Go to Reports or Tools menu
   - Find "Export" or "Price List" option
   - Export to Excel (.xlsx or .xls)
   - Save as `pricelist.xlsx` or `products.xlsx`

3. **Export Categories** (if available):
   - Export item categories
   - Save as `categories.xlsx`

### 2. Transfer Files to Laptop

1. Copy the Excel file(s) to a USB drive
2. On your laptop, paste into:
   ```
   C:\Users\LENOVO\Desktop\zain pos\migration\
   ```

### 3. Run Import Script

1. **Open PowerShell** in the project folder
2. **Run the import command**:
   ```powershell
   npm run import
   ```

3. **Wait for completion** - You'll see:
   - Categories being created
   - Products being imported
   - Import summary report

### 4. Verify Data

1. **Open the POS app** (if not already running):
   ```powershell
   npm run electron:dev
   ```

2. **Login**: admin / admin123

3. **Go to Products page** and verify:
   - All products imported
   - Prices are correct
   - Stock levels match
   - Categories assigned properly

---

## What the Script Does

The import script automatically:

✅ **Detects column names** - Works with various MaxSell export formats
✅ **Creates categories** - Extracts and creates product categories
✅ **Imports products** - Adds all products with prices and stock
✅ **Generates barcodes** - Creates barcodes if not present
✅ **Creates variants** - Sets up product variants (Standard size by default)
✅ **Generates report** - Creates detailed import summary

---

## Column Names Supported

The script intelligently detects these column names:

**Product Information:**
- Product Name / Item Name / Name / ITEM_NAME
- Product Code / Item Code / Code / SKU
- Category / Category_Name / Item_Category / CATEGORY

**Pricing:**
- MRP / Price / Selling_Price / Rate
- Selling Price / Sale_Price
- Purchase Price / Cost

**Stock:**
- Stock / Quantity / Stock_Quantity / Qty

**Other:**
- Barcode / Bar_Code
- HSN_Code / HSN
- GST / GST_Rate / GST %
- Size
- Color

---

## Example Excel Format

Your Excel file should look something like this:

| Product Code | Product Name | Category | MRP | Selling Price | Stock | Barcode |
|--------------|--------------|----------|-----|---------------|-------|---------|
| SH001 | Formal Shirt | Shirts | 1200 | 1000 | 50 | 123456789 |
| PN001 | Denim Jeans | Pants | 1500 | 1200 | 30 | 987654321 |
| TS001 | Cotton T-Shirt | T-Shirts | 500 | 400 | 100 | 456789123 |

**Note:** Column names can vary - the script will detect them automatically!

---

## Troubleshooting

### ❌ "No Excel files found"
- Make sure you copied the Excel file to the `migration` folder
- Check the file extension is `.xlsx` or `.xls`

### ❌ "No data found in Excel files"
- Open the Excel file and check if it has data
- Make sure the first row has column headers
- Ensure data starts from row 2

### ❌ Import errors
- Check the `migration/import-report.txt` file for details
- Common issues:
  - Missing product names
  - Invalid prices (non-numeric values)
  - Duplicate product codes

---

## After Import

1. ✅ **Verify products** in the Products page
2. ✅ **Check prices** are correct
3. ✅ **Update stock** if needed
4. ✅ **Print barcode labels** for products
5. ✅ **Test POS** with a few sample sales
6. ✅ **Configure settings** (shop info, printers)
7. ✅ **Train staff** on the new system

---

## Need Help?

If you encounter any issues:
1. Check `migration/import-report.txt` for error details
2. Verify your Excel file format
3. Make sure product names are present in the Excel file
4. Contact support with the error message

---

## 🎉 Ready to Import!

Once you have the Excel file in the migration folder, just run:

```powershell
npm run import
```

The script will handle everything automatically!
