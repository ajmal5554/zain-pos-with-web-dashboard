-- GST Calculation Fix Migration
-- This script recalculates CGST and SGST for all existing sales
-- using the correct tax-inclusive formula: Tax = (AfterDiscount × Rate) / (100 + Rate)

-- Created: 2026-04-03
-- Updated: Fixed to handle sale-level discounts properly
-- Purpose: Fix historical sales that calculated GST before applying discount

BEGIN TRANSACTION;

-- Step 1: Update Sale table with corrected CGST, SGST, and taxAmount
-- Since all discounts are at sale level, we calculate from (subtotal - discount)
UPDATE Sale
SET 
    taxAmount = ROUND((subtotal - discount) * 5.0 / 105.0, 2),
    cgst = ROUND((subtotal - discount) * 5.0 / 105.0 / 2.0, 2),
    sgst = ROUND((subtotal - discount) * 5.0 / 105.0 / 2.0, 2),
    updatedAt = CURRENT_TIMESTAMP
WHERE status = 'COMPLETED';

-- Step 2: Update SaleItem table (even though item discounts are 0, update for consistency)
-- Each item contributes proportionally to the total tax
UPDATE SaleItem
SET taxAmount = ROUND((sellingPrice * quantity - discount) * taxRate / (100.0 + taxRate), 2)
WHERE id IN (
    SELECT si.id 
    FROM SaleItem si
    JOIN Sale s ON si.saleId = s.id
    WHERE s.status = 'COMPLETED'
);

COMMIT;

-- Verification queries (run these AFTER the migration):
-- 
-- 1. Check a specific bill:
-- SELECT 
--     billNo, subtotal, discount, 
--     (subtotal - discount) as afterDiscount,
--     taxAmount, cgst, sgst,
--     (cgst + sgst) as calculated_total_tax,
--     ROUND((subtotal - discount) * 5 / 105, 2) as expected_tax
-- FROM Sale 
-- WHERE billNo = '1304';
--
-- 2. Verify all sales have correct split:
-- SELECT COUNT(*) FROM Sale WHERE ABS(cgst - sgst) > 0.01;
-- (Should return 0 - all sales should have equal CGST and SGST)
--
-- 3. Verify tax calculation:
-- SELECT 
--     billNo,
--     ROUND(taxAmount, 2) as stored_tax,
--     ROUND(cgst + sgst, 2) as sum_cgst_sgst,
--     CASE 
--         WHEN ABS(taxAmount - (cgst + sgst)) < 0.02 THEN 'OK'
--         ELSE 'MISMATCH'
--     END as status
-- FROM Sale
-- WHERE status = 'COMPLETED';
