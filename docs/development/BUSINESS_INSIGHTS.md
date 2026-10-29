# Sales Forecasting scope — restored in 3.0.41

## User-approved objective

This remains a SALES FORECASTING AND BUSINESS PLANNING page. Preserve selectable 1–6 month forecasts, restocking directions, season alerts, and period/year comparisons. Reliability fixes must accompany those features. Changing the objective or removing a major feature requires the user's approval. The earlier seven-day-only replacement did not meet this objective.

## Data and projection basis

The trusted `insights:get` read endpoint loads up to two years of recorded sales with active insight permission checks. Use actualSaleDate, falling back to createdAt, in Asia/Kolkata. Today, future bills, voided bills, historical imports and clearly labelled demo bills remain excluded. No data or schema changes happen during reads.

Net turnover includes dated refunds and reconciled full exchange credit reversals; replacement bills count once. When those records cannot reconcile, retain the forecasting feature with a prominently labelled BILLED-SALES projection before returns and exchange reversals. It includes replacement bill values and must never be called net revenue, cash receipts or profit. Net figures remain unavailable, with the affected bills listed. Category demand and audited stock checks still work independently.

## One to six future months

The current month is partial and shown separately. Training uses complete calendar months only, with explicit zero-record months retained and flagged. Values are converted to daily rates before modelling to account for month length. With at least two full months, use recent three-month rates. With six or more months, select among recent average, bounded damped trend, and last-completed-month pace using past-only rolling next-month errors (at least three tests, at most six).

If there are not two complete months, at least 14 recorded calendar days can provide a clearly labelled early daily run-rate projection. A model with no usable positive activity keeps all six future rows present with unavailable estimates. There is no invented 5% growth fallback. Current MTD pace is not treated as a full observed month in monthly training.

Seasonality needs 24 complete months with some recorded bills in each. Detrend/seasonality uncertainty remains; normalized seasonal factors are bounded 0.7–1.3. Deseasonalize the baseline before applying the target month's factor, preventing double counting. Short histories do not claim an annual seasonal uplift.

Future rows show forecast, planning scenario range, last year's corresponding month when recorded, and the estimated change against that observed value. These ranges are NOT calibrated confidence intervals. The planning spread uses the largest of recent rate variability, next-month backtest MAE, and a minimum percentage of the estimate (50% for early daily-rate, 30% for unvalidated monthly, 15% with monthly tests), widening by square-root horizon. Next-month backtests do not prove six-month accuracy. Forecasts remain GST-inclusive recorded value, not accounting profit.

## Comparisons

MTD vs previous month and MTD vs previous year compare the same number of completed days, capped at the shorter month's length. The last two completed months are also compared. Missing previous coverage and nonpositive percentage denominators yield unavailable comparisons, not invented zero history. Missing-day records cannot prove the shop was open or closed.

## Seasons and restocking

Show fixed Christmas/New Year selling periods plus clearly labelled summer, Vishu and Onam preparation windows. Those windows are not exact festival dates or measured sales boosts. Ramadan/Eid and specific festival dates can be entered as confirmed reminders through an in-app modal, stored per login on this device. Reminders do not alter forecasts, prices or stock. Removal uses ConfirmDialog. Source context for fixed 2026 Christmas: https://kerala.gov.in/assets/public_uploads/public_holiday_2026.pdf . Exact future religious dates are not guessed.

Use recorded net category units over 28 completed days, including traditional billing, to identify ranges to inspect. Quantified replenishment uses active audited barcodes only, with observation/low-demand/count warnings intact. Editable supplier lead time and extra buffer determine review quantity: ceil(net units / 28 × (lead days + buffer days)) − recorded stock, floored at zero. The reorder filter responds to those inputs. Search and filters expose the full audited list, displaying up to 30 matches at a time.

This is a review scenario, not an automatic order: pending deliveries, supplier minimums, missed sales during stockouts, physical count accuracy and cash availability are not known. No arbitrary purchase cost, budget or profit-safe discount is invented. Links lead to Stock, Purchases, Sales and Profit for actual follow-up.

## Verification

Tests cover six-month/year rollover, month lengths, partial/future exclusions, matched-day comparisons, insufficient history, neutral seasonality with short records, explicit billed-basis fallback, horizon controls, restock assumptions, calendar windows, reminder persistence and deletion, permission changes, stale request rejection, and existing refund/exchange rules. Test databases and read-only snapshots keep shop data unchanged.
