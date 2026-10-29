# Profit and Business Analysis

Owner-only desktop, read-only report. Selects completed, nonhistorical bills by actualSaleDate (fallback createdAt), with Asia/Kolkata date boundaries. Maximum range: 367 calendar dates. All returns attached to those bills are included as currently recorded. This is invoice-cohort analysis, not event-period accounting; later returns block operating balance. Editing an earlier bill changes its report.

Amounts include GST. Gross profit is provisional net bill value less remaining saved FIFO costs and known held-return costs. Current catalogue costs are never used. Missing coverage/unknown costs or unknown held losses block gross profit. Expenses use expenseDate, ACTIVE only; unclassified drawer payments block operating balance. Supplier payments, owner withdrawals, float and excluded/voided expenses are not operating expenses. Unrecorded spending/losses cannot be detected.

## Exchanges (3.0.36)

For each selected original bill, subtract the full selling-price credit granted on exchanged pieces, independently of its original bill discount. Count each selected replacement bill's discounted grandTotal once. EXCHANGE_CREDIT is tender, not fresh money and not a second sale. The original bill remains unchanged. Remaining FIFO cost already reverses returned goods; known held-return losses are still deducted separately.

New exchanges write an ExchangeRevenue sidecar row inside the existing exchange transaction. It stores original/replacement IDs, returned credit, discounted replacement value, applied credit, surplus and fresh payment in integer paise. A later failed stock or audit write rolls back this row too. Report reads never create or repair sidecars. Older exchanges require a unique version-2 structured audit linked to the exact Exchange Ref on the replacement bill. Amounts, quantities, original unit prices, exchange difference, payment totals and active bill statuses must reconcile. Unmatched or inconsistent records block net sales and profit. Older audit deletion may therefore make an exchange unreportable.

Surplus credit issued = returned credit minus replacement value, floored at zero. It is a customer obligation, not revenue, and is shown separately. This is issued credit against selected original bills, NOT an outstanding voucher ledger or a redemption feature. The full returned credit is reversed so surplus is not counted as revenue. Existing cash refund limits on replacement bills are preserved.

The cohort/date limitation still applies: a later exchange changes the earlier original-bill cohort, and its replacement belongs to its own bill date. Cross-period operating balance remains withheld where later returns make expenses incomparable. The report is not an event-period financial statement.

Product ranking uses original SaleItem total, before bill discounts and returns, grouped by saved product name. It is sales mix, not product margin. No GST-adjusted accounting profit, automatic promotions or forecasts yet. Live database remains unchanged by report reads; absent sidecar tables stay absent.
