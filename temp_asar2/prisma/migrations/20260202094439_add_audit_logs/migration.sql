/*
  Warnings:

  - You are about to drop the column `customerId` on the `Sale` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billNo" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "subtotal" REAL NOT NULL,
    "discount" REAL NOT NULL DEFAULT 0,
    "discountPercent" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL,
    "cgst" REAL NOT NULL,
    "sgst" REAL NOT NULL,
    "grandTotal" REAL NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "paidAmount" REAL NOT NULL,
    "changeAmount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "remarks" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Sale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Sale" ("billNo", "cgst", "changeAmount", "createdAt", "customerName", "discount", "discountPercent", "grandTotal", "id", "paidAmount", "paymentMethod", "remarks", "sgst", "subtotal", "taxAmount", "updatedAt", "userId") SELECT "billNo", "cgst", "changeAmount", "createdAt", "customerName", "discount", "discountPercent", "grandTotal", "id", "paidAmount", "paymentMethod", "remarks", "sgst", "subtotal", "taxAmount", "updatedAt", "userId" FROM "Sale";
DROP TABLE "Sale";
ALTER TABLE "new_Sale" RENAME TO "Sale";
CREATE TABLE "new_SaleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantInfo" TEXT,
    "quantity" INTEGER NOT NULL,
    "mrp" REAL NOT NULL,
    "sellingPrice" REAL NOT NULL,
    "discount" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL,
    "taxAmount" REAL NOT NULL,
    "total" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SaleItem" ("createdAt", "discount", "id", "mrp", "productName", "quantity", "saleId", "sellingPrice", "taxAmount", "taxRate", "total", "variantId", "variantInfo") SELECT "createdAt", "discount", "id", "mrp", "productName", "quantity", "saleId", "sellingPrice", "taxAmount", "taxRate", "total", "variantId", "variantInfo" FROM "SaleItem";
DROP TABLE "SaleItem";
ALTER TABLE "new_SaleItem" RENAME TO "SaleItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
