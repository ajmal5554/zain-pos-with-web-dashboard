import React from 'react';
import { Tag, History, CheckCircle2, Cpu, HardDrive, Globe, Printer } from 'lucide-react';
import packageInfo from '../../../package.json';
import appIcon from '/icon.png';

interface ChangelogItem {
    type: 'feature' | 'improvement' | 'fix';
    title: string;
    description: string;
}

interface Release {
    version: string;
    title: string;
    date: string;
    isCurrent?: boolean;
    changes: ChangelogItem[];
}

const RELEASES: Release[] = [
    {
        version: '3.0.63', title: 'Single-Item Product Management & MRP/Price Column', date: '29 October 2026', isCurrent: true,
        changes: [
            { type: 'feature', title: 'Dedicated MRP / Selling Price Column', description: 'Added a dedicated MRP / Price column in the products table showing the selling price in bold and MRP with strikethrough when discounted, replacing the redundant "Status & Details" column.' },
            { type: 'improvement', title: 'Streamlined Single-Item Architecture', description: 'Removed nested variant options, multi-variant cards, and variant buttons from the product page and modal, unifying product creation and editing into a clean single-item workflow matching retail operations.' },
            { type: 'improvement', title: 'Simplified Product Modal Dialog', description: 'Replaced the complex variant editor with a clean, unified dialog containing item identity, barcode generator, garment specs, and pricing/stock fields.' },
        ],
    },
    {
        version: '3.0.62', title: 'Products Table Clean Attributes & Edge-to-Edge Layout', date: '29 October 2026',
        changes: [
            { type: 'improvement', title: 'Clean Variant Attributes Subline', description: 'Removed duplicate product names, redundant barcode tags, and inline print buttons from the product subline, displaying a clean bullet-separated summary of garment attributes (size, fit, fabric, collar).' },
            { type: 'improvement', title: 'Edge-to-Edge Card Table Layout', description: 'Eliminated default 24px inner card padding on the products table so headers and rows span edge-to-edge with aligned serial numbers and proportional columns that fit cleanly without horizontal scrolling.' },
        ],
    },
    {
        version: '3.0.61', title: 'Products Table Polish, Row Print Action & Modal Sizing', date: '29 October 2026',
        changes: [
            { type: 'improvement', title: 'Products Table Layout & Typography Refinement', description: 'Re-engineered the products table with proportional column widths, clean uppercase headers matching Purchases/Forecasting, centered stock badge pills, and bottom counter footer, eliminating awkward horizontal scroll.' },
            { type: 'feature', title: 'Restored Print Label Button in Table Actions', description: 'Restored the quick Print Barcode Label button directly to the left of the Edit button in the table actions column, allowing one-click sticker generation.' },
            { type: 'improvement', title: 'Resized Product Editor Modal Action Buttons', description: 'Replaced the oversized full-width submit button with a well-proportioned right-aligned "Update Product & Variants" button alongside Cancel.' },
        ],
    },
    {
        version: '3.0.60', title: 'Universal crypto.randomUUID LAN & HTTP Polyfill', date: '29 October 2026',
        changes: [
            { type: 'fix', title: 'Remote LAN Browser crypto.randomUUID Support', description: 'Added a universal RFC4122 v4 UUID polyfill loaded before any application routes or state hooks, resolving the "crypto.randomUUID is not a function" crash when accessing the POS from another computer over HTTP/LAN.' },
        ],
    },
    {
        version: '3.0.59', title: 'Collapsed Sidebar Alignment & Invisible Scrollbar', date: '29 October 2026',
        changes: [
            { type: 'improvement', title: 'Invisible Scrollbar for Collapsed Rail', description: 'Replaced intrusive grey scrollbar in collapsed sidebar mode with clean invisible scrolling, preventing scrollbars from compressing icons or cutting into active pills.' },
            { type: 'improvement', title: 'Bottom Navigation Clearance & Pill Centering', description: 'Added pb-8 bottom padding so Settings is never sliced off by the logout divider, and centered icon pills and the logout button precisely in collapsed state.' },
        ],
    },
    {
        version: '3.0.58', title: 'Sales Forecasting Layout Whitespace & Alignment Balance', date: '29 October 2026',
        changes: [
            { type: 'improvement', title: 'Full-Width Workspace Alignment', description: 'Eliminated artificial container max-width constraints (max-w-7xl) and double padding on the Forecasting page, bringing edge-to-edge layout consistency with Expenses, Profit, and Purchases.' },
            { type: 'improvement', title: 'Tighter Metric Cards & Streamlined Table Padding', description: 'Normalized KPI stat card padding from !p-5 to !p-4 with cleaner footer spacing, and tightened table row padding to standard px-4 py-3 across projections, comparisons, and restocking lists.' },
        ],
    },
    {
        version: '3.0.57', title: 'Purchases Layout Whitespace & Alignment Balance', date: '29 October 2026',
        changes: [
            { type: 'improvement', title: 'Full-Width Workspace Alignment', description: 'Removed excessive inner margins and artificial container width restrictions (max-w-7xl and redundant padding) to align Purchases seamlessly edge-to-edge with all other app modules.' },
            { type: 'improvement', title: 'Compact Stat Cards & Proportional Table Columns', description: 'Streamlined KPI metric card padding and tightened spacing. Assigned proportional column widths to the invoice history table so data spreads naturally without awkward empty space.' },
        ],
    },
    {
        version: '3.0.56', title: 'Purchases Page Layout & Visual Polish', date: '28 October 2026',
        changes: [
            { type: 'improvement', title: 'Unified Toolbar & Action Controls', description: 'Consolidated top actions into a cohesive single-line toolbar with the primary action button, invoice counter pill, search bar, and refresh action.' },
            { type: 'improvement', title: 'Refined Metric Cards & State Visuals', description: 'Streamlined KPI stat card labels, eliminated repetitive suffix text, added subtle search-filtering badges, and normalized zero-balance state color accents.' },
            { type: 'improvement', title: 'Right-Aligned Currency Columns & Grammatical Pagination', description: 'Properly right-aligned all financial figures (Purchase total, Paid, Pending) in table headers and cells, and fixed pluralization in invoice counters.' },
        ],
    },
    {
        version: '3.0.55', title: 'Purchases Modern Redesign', date: '28 October 2026',
        changes: [
            { type: 'improvement', title: 'Modernized Purchases Interface', description: 'Redesigned Purchases page with clean top controls, modern hero KPI stat cards, styled invoice history table, and structured new purchase draft entry matching the design system of Profit, Expenses, and Dashboard.' },
            { type: 'improvement', title: 'Streamlined Invoice Entry & Stock Search', description: 'Organized supplier details, item lookup dropdown with size/barcode tags, and responsive line-item tables with clear price batch notices and live GST/payable summaries.' },
            { type: 'improvement', title: 'Enhanced Invoice Review & Payment Flow', description: 'Polished invoice batch review modal with payment ledger timeline, status badges, and cleaner supplier payment recording.' },
        ],
    },
    {
        version: '3.0.54', title: 'Printer Selection Alignment & Label Dropdown', date: '28 October 2026',
        changes: [
            { type: 'improvement', title: 'Label Printer Windows Dropdown', description: 'Replaced manual text input with a detected Windows printer dropdown for the label printer, matching the receipt printer interface.' },
            { type: 'improvement', title: 'Symmetrical Header Alignment for Refresh Printers', description: 'Realigned the Refresh Printers button into the section header with a status spinner, creating a balanced and clean two-column printer setup.' },
        ],
    },
    {
        version: '3.0.53', title: 'Receipt Rate Column & Subline Dual Styles', date: '28 October 2026',
        changes: [
            { type: 'feature', title: 'Accounting Rate Column Order (Item | Rate | Qty | Amt)', description: 'Placed the optional Rate column directly to the left of Quantity so calculations follow standard left-to-right math (Rate × Qty = Amount).' },
            { type: 'feature', title: 'Optional Rate Subline (2 @ ₹700.00)', description: 'Added a configurable subline style for multi-quantity items, displaying the unit rate beneath the product name when quantity > 1 without consuming extra column width.' },
            { type: 'improvement', title: 'Receipt Designer & Settings Controls', description: 'Added live interactive toggles for both Rate Column and Rate Subline in the Receipt Designer items table options and Printer Settings.' },
        ],
    },
    {
        version: '3.0.52', title: 'Payment Mode Total Quantity Indicator', date: '28 October 2026',
        changes: [
            { type: 'improvement', title: 'Total Quantity in Payment Summary', description: 'Added a live Total Qty and item count indicator beside Discount Applied in the payment summary bar for instant piece-count verification at checkout.' },
        ],
    },
    {
        version: '3.0.51', title: 'Prioritize Legacy Quick-Keys in Suggestions', date: '28 October 2026',
        changes: [
            { type: 'fix', title: 'Popularity-First Suggestion Ranking', description: 'Ranked suggestions strictly by total units sold first, ensuring high-velocity legacy items like Shirt 700 and Pant 1000 appear at the very top of the list.' },
        ],
    },
    {
        version: '3.0.50', title: 'Clean Cart Item Display & Popularity-Ranked Suggestions', date: '28 October 2026',
        changes: [
            { type: 'improvement', title: 'Clean Cart Item Presentation', description: 'Reduced cart item rows to just the clean product name and category badge, removing long attribute clutter while keeping full garment details in hover tooltips.' },
            { type: 'feature', title: 'Popularity-Ranked Suggestions', description: 'Ordered the suggestion list by most-sold units and stock availability, eliminating doom-scrolling and making top-moving items instantly accessible.' },
        ],
    },
    {
        version: '3.0.49', title: 'POS UI Notification Clearance & Scan Placeholder', date: '28 October 2026',
        changes: [
            { type: 'fix', title: 'Notification Clearance Below Title Bar', description: 'Positioned toast notifications safely below the custom window title bar to prevent clipping and header overlap.' },
            { type: 'improvement', title: 'Simplified Barcode Scan Placeholder', description: 'Changed the scan input placeholder to "Scan..." for a cleaner and more concise interface.' },
        ],
    },
    {
        version: '3.0.48', title: 'Receipt Item Categories', date: '28 October 2026',
        changes: [
            { type: 'fix', title: 'Include Category on Printed Item Lines', description: 'POS receipts and sales-history reprints look up categories from variant IDs and print them beside item names, without garment attributes.' },
        ],
    },
    {
        version: '3.0.47', title: 'Receipt Size Without Content Rollback', date: '28 October 2026', 
        changes: [
            { type: 'fix', title: 'Keep Current Receipt Contents', description: 'Undid the unintended old-format content changes while retaining driver-controlled receipt sizing and printer diagnostics.' },
            { type: 'fix', title: 'Simple Receipt Item Names', description: 'Receipt lines omit generated attribute descriptions and variant details. Names remain visible, with category when supplied.' },
        ],
    },
    {
        version: '3.0.46', title: 'Restore Receipt Presentation', date: '28 October 2026', 
        changes: [
            { type: 'fix', title: 'Restore Thermal Driver Paper Settings', description: 'Removed the custom measured receipt page size that introduced scaling and excessive blank feed. Preserves installed thermal driver paper settings, printer selection and error reporting.' },
            { type: 'improvement', title: 'Restore Familiar Receipt Details', description: 'Restored bill/customer placement, date on the next line, compact totals and the NET AMOUNT heading without changing stored sale values.' },
        ],
    },
    {
        version: '3.0.45', title: 'Receipt Preparation Diagnostics', date: '27 October 2026', 
        changes: [
            { type: 'fix', title: 'Report Receipt Preparation Stalls', description: 'Printer discovery, receipt loading and measurement now time out with a specific stage error. Removed an unbounded hidden-window font wait.' },
            { type: 'improvement', title: 'Persistent Test Receipt Result', description: 'Printer settings show test progress and retain the result on screen. The test button is disabled during a job to prevent repeated clicks.' },
        ],
    },
    {
        version: '3.0.44', title: 'Receipt Printer Selection and Diagnostics', date: '27 October 2026', 
        changes: [
            { type: 'fix', title: 'Reliable Receipt Printer Selection', description: 'Choose an installed Windows receipt printer and refresh detection. Missing printers show actionable errors; failed jobs never automatically switch to another device.' },
            { type: 'fix', title: 'Thermal Receipt Tests and Visible Failures', description: 'Test receipts use the same layout, selected printer and thermal width as sales receipts. Print errors appear in POS and sales history; uncertain jobs advise checking the Windows queue before retrying.' },
        ],
    },
    {
        version: '3.0.43', title: 'Web Dashboard Reliability and Access Fixes', date: '27 October 2026', 
        changes: [
            { type: 'fix', title: 'Protect Web Access', description: 'Customer endpoints now require login; inactive accounts cannot authenticate API requests or new live connections. Maintenance access requires an explicitly configured secret.' },
            { type: 'fix', title: 'Reliable Dashboard Figures', description: 'Failed dashboard requests show a retry message rather than zero totals. All Time refreshes correctly, older requests cannot overwrite newer ranges, daily sales use India dates, and top products respect the selected period.' },
            { type: 'fix', title: 'Clearer Web Error States', description: 'Added stock-load error feedback and retry, removed duplicate toast rendering, corrected cloud customer writes, and improved expired-session and unknown-page handling.' },
        ],
    },
    {
        version: '3.0.42', title: 'Sales Forecasting Modern Redesign', date: '26 October 2026',
        changes: [
            { type: 'improvement', title: 'Modernized Sales Forecasting Interface', description: 'Streamlined Sales Forecasting with unboxed top controls, visual KPI hero stat cards, styled Recharts interactive timeline, and clean scenario range tables matching Profit and Dashboard UI.' },
            { type: 'improvement', title: 'Interactive Stock Restocking & Velocity Grid', description: 'Enhanced category velocity cards, styled lead time and buffer day controls, and structured candidate stock table with visual status badges.' },
            { type: 'improvement', title: 'Integrated Audit Alerts & Connected Operations', description: 'Polished data integrity cards, clear exchange reconciliation warnings with specific bill references, and quick navigation shortcuts.' },
        ],
    },
    {
        version: '3.0.41', title: 'Restore Six-Month Sales Planning', date: '26 October 2026',
        changes: [
            { type: 'fix', title: 'Restore the Sales Forecasting Objective', description: 'Restored selectable one-to-six-month sales projections, monthly chart, planning ranges, current-month pace and previous-period/year comparisons. Data limitations now accompany these features instead of replacing them.' },
            { type: 'feature', title: 'Season Alerts and Restocking Directions', description: 'Upcoming season preparation windows and confirmed-date reminders support purchasing plans. Audited item checks include editable supplier lead time and buffer assumptions; category demand remains available for traditional billing.' },
            { type: 'improvement', title: 'Transparent Projection Basis and Reliability', description: 'Completed months train the forecast, with matched-day comparisons and past-only monthly tests. When exchanges are unresolved, clearly labelled billed-sales projections remain available while net sales stay unconfirmed.' },
        ],
    },
    {
        version: '3.0.40', title: 'Expenses Modern Redesign', date: '26 October 2026',
        changes: [
            { type: 'improvement', title: 'Modernized Expenses Interface', description: 'Redesigned Expenses page with hero stat cards, clean filter presets, styled ledger table with status badges, and enhanced modal flows matching the Profit and Dashboard design system.' },
            { type: 'feature', title: 'Integrated Period Presets', description: 'Added quick preset filters for Today, This Month, Last Month, and This Year.' },
            { type: 'improvement', title: 'Enhanced Drawer Review & Audit Visibility', description: 'Clear visual status badges for pending drawer outflows, linked register cash entries, and audit history timeline in details view.' },
        ],
    },
    {
        version: '3.0.39', title: 'Practical Business Insights', date: '26 October 2026',
        changes: [
            { type: 'fix', title: 'Use Net Sales and Completed Days', description: 'Sales outlook now respects actual bill dates, dated refunds and reconciled exchange credit. Today’s partial sales, future bills, historical imports and clearly labelled demo bills are excluded from training.' },
            { type: 'improvement', title: 'Short Outlook with Visible Evidence', description: 'Replaced speculative monthly projections and confidence claims with a seven-day estimate, rolling test errors and clear reasons when a forecast is unavailable. Failed loads and refreshes no longer leave stale results.' },
            { type: 'improvement', title: 'Audited Size and Barcode Stock Watch', description: 'Generic stock is excluded from replenishment checks. Recent tracked sales and returns drive cautious stock reviews; sparse demand, new audits and invalid counts remain visible. Removed invented purchase budgets and unsupported promotion advice.' },
        ],
    },
    {
        version: '3.0.38', title: 'Profit & Analysis Modern Redesign', date: '26 October 2026',
        changes: [
            { type: 'improvement', title: 'Modernized Profit & Analysis UI', description: 'Redesigned Profit & Business Analysis with hero stat cards, visual financial waterfall flow, and structured cohort breakdowns matching Dashboard, POS, and Reports UI.' },
            { type: 'feature', title: 'Interactive Date Presets & Quick Month Picker', description: 'Added quick date range pills (Today, Yesterday, This Week, This Month, Last Month, This Quarter, This FY) and one-click month selection.' },
            { type: 'feature', title: 'Profit & Sales Mix CSV Export', description: 'Export complete cohort summaries, financial reconciliation checks, and top products volume to spreadsheet.' },
            { type: 'improvement', title: 'Actionable Audit & Reconciliation Alerts', description: 'Clear visual status alerts for missing purchase batch costs, unresolved exchange links, and pending drawer reviews with direct navigation.' },
        ],
    },
    {
        version: '3.0.37', title: 'Purchase GST and Invoice Round-off', date: '26 October 2026',
        changes: [
            { type: 'feature', title: 'Record Supplier Invoice GST Separately', description: 'Enter item rates before GST, optional supplier GSTIN and HSN, invoice CGST/SGST or IGST, and signed round-off. Supplier payments and pending balances use the complete invoice total.' },
            { type: 'improvement', title: 'Keep ITC Pending Accountant Review', description: 'GST is recorded without claiming input credit. Stock costs include tax provisionally; earlier purchases and unresolved saved requests keep their original format.' },
            { type: 'fix', title: 'Preserve Tax in Purchase Corrections', description: 'Corrections retain the separate tax breakdown and original invoice history. Stock, saved costs, tax details and payments save together without duplicate receipt entries.' },
        ],
    },
    {
        version: '3.0.36', title: 'Exchange Profit Reconciliation', date: '25 October 2026',
        changes: [
            { type: 'feature', title: 'Exchange Bills in Profit Analysis', description: 'Reconciled exchanges reverse the full credit granted on returned goods and count each replacement bill once. Original discounts and saved receipt costs remain intact.' },
            { type: 'improvement', title: 'Separate Surplus Customer Credit', description: 'Profit analysis shows surplus credit issued separately from revenue. New exchanges save their agreed values atomically; older exchanges require matching saved audit and payment records.' },
            { type: 'fix', title: 'Withhold Inconsistent Exchange Totals', description: 'Missing links, changed replacement payments or unmatched exchange records keep profit unavailable rather than inflate sales.' },
        ],
    },
    {
        version: '3.0.35', title: 'Profit and Business Analysis', date: '25 October 2026',
        changes: [
            { type: 'feature', title: 'Owner Profit Overview', description: 'Review dated bills, refunds, saved receipt costs, business expenses and top products together. Amounts remain provisional including GST until purchase tax treatment is reviewed.' },
            { type: 'improvement', title: 'Show Incomplete Profit Clearly', description: 'Missing costs, exchange credit, unreviewed expenses and later returns prevent misleading profit totals. Current product costs never replace the costs saved with a sale.' },
        ],
    },
    {
        version: '3.0.34', title: 'Business Expenses and Drawer Review', date: '25 October 2026',
        changes: [
            { type: 'feature', title: 'Record Business Expenses', description: 'Record rent, electricity, wages, transport and other spending paid by shop cash, UPI, bank or personal cash. Search by date and export a monthly CSV for your accountant.' },
            { type: 'feature', title: 'Review Existing Drawer Payments Once', description: 'Eligible drawer outflows appear for review and reuse their original cash movement. Owner withdrawals, float changes and linked supplier payments stay outside expense totals.' },
            { type: 'fix', title: 'Keep Expense and Cash Records Together', description: 'New drawer expenses create one linked outflow. Classification and exclusions keep cash unchanged; mistaken open-drawer entries can be voided with an auditable reversal. Closed register balances are preserved.' },
        ],
    },
    {
        version: '3.0.33', title: 'Receipt Costs Recorded with Sales', date: '25 October 2026', 
        changes: [
            { type: 'feature', title: 'Oldest Receipt Costs First', description: 'Sales allocate stock costs from available receipt batches in receipt order. Later purchases and price-only bill edits cannot reprice an earlier sale.' },
            { type: 'feature', title: 'Costs Follow Returns and Sale Changes', description: 'Refunds, exchanges, voids and quantity edits preserve the original sale cost. Held returns are kept outside saleable stock and their costs remain visible separately.' },
            { type: 'improvement', title: 'Known and Unknown Costs Stay Separate', description: 'Sales History shows saved costs to authorized users. Opening stock, older sales and unexplained stock additions never become invented zero-cost profit.' },
            { type: 'fix', title: 'Protect Consumed Purchase Batches', description: 'Supplier returns take unsold units from the selected receipt. Purchase corrections cannot overwrite a partly consumed batch cost or use another delivery to reverse missing goods.' },
        ],
    },
    {
        version: '3.0.32', title: 'Purchase Corrections and Supplier Returns', date: '25 October 2026',
        changes: [
            { type: 'feature', title: 'Correct or Cancel Recorded Purchases', description: 'Correct invoice quantities, costs and details with a dated reason, or cancel remaining goods. Stock and supplier balances update together while the original invoice stays in history.' },
            { type: 'feature', title: 'Return Goods and Track Supplier Credits', description: 'Return selected invoice quantities and enter the credit agreed with the supplier. Previously returned quantities and available stock are checked before saving.' },
            { type: 'feature', title: 'Record Supplier Refunds Received', description: 'Overpaid invoices show money owed by the supplier. Record an actual refund separately; refunds into the shop drawer create a linked cash-in entry.' },
        ],
    },
    {
        version: '3.0.31',
        title: 'Distinct Purchases Navigation Icon',
        date: '25 October 2026',

        changes: [
            {
                type: 'improvement',
                title: 'Dedicated Delivery Truck Icon for Purchases',
                description: 'Updated the Purchases navigation item in the sidebar and the Purchases page header to a dedicated Truck icon representing incoming supplier deliveries and stock intake, distinguishing it from GST Reports.',
            },
        ],
    },
    {
        version: '3.0.30', title: 'Purchases and Receipt Costs', date: '25 October 2026',
        changes: [
            { type: 'feature', title: 'Receive New Supplier Invoices', description: 'Record invoice dates, named batches, quantities, costs, discounts and charges. Create new item codes with zero stock in the rack form, then receive the delivery once through Purchases.' },
            { type: 'feature', title: 'Supplier Payments and Pending Balances', description: 'Review purchase invoices and record partial or later payments. Shop drawer payments also create a linked cash outflow; personal cash stays separate.' },
            { type: 'feature', title: 'Separate Price Batches', description: 'Changed selling prices or MRPs receive a new short barcode while earlier stock keeps its price. Cost-only changes preserve the barcode and record costs on the purchase receipt. Opening audits remain separate; sale-by-sale profit allocation is not yet included.' },
        ],
    },
    {
        version: '3.0.29',
        title: 'Sticker Code and Template Designer Repair',
        date: '25 October 2026',

        changes: [
            { type: 'fix', title: 'Restore the Code Beneath the Barcode', description: 'Recognizes the original template missing its code row and restores the actual product barcode number. Old fixed sample-code rows become dynamic product-code rows.' },
            { type: 'improvement', title: 'Accurate Designer and Sticker Previews', description: 'The designer and print dialog share the same real barcode preview, physical label dimensions, fonts, padding and content scale. Clipping warnings and Fit content to height help keep the code and price visible.' },
            { type: 'fix', title: 'Safer Template Editing and Saving', description: 'Added a Product Code element, spacer-height editing, validated template imports, in-app notifications and atomic layout/calibration saves. Failed loads and stale edits cannot overwrite saved printer settings.' },
        ],
    },
    {
        version: '3.0.28',
        title: 'Restore Compact Sticker Layout',
        date: '25 October 2026',
        changes: [
            { type: 'fix', title: 'Original Single-Line Sticker Name', description: 'Restored the product-name line in sticker previews and printed labels. Full garment attributes no longer wrap onto extra lines and crowd the barcode and price. Saved label dimensions, layout blocks and printer calibration are preserved.' },
        ],
    },
    {
        version: '3.0.27',
        title: 'Customizable Rack Audit',
        date: '17 October 2026',
        changes: [
            { type: 'feature', title: 'Count Stock Like the Audit App', description: 'Choose a category, brand and garment attributes using selectable buttons, then count multiple sizes with plus/minus controls. Keep the style and price ready for the next rack.' },
            { type: 'feature', title: 'Customize Categories, Attributes and Sizes', description: 'Add categories, category-specific brands, attribute types, selectable options and named size scales. Setup is saved in the POS database and custom attributes stay attached to stock items.' },
            { type: 'improvement', title: 'Match the Complete Garment Identity', description: 'Repeated rack entries add to an existing barcode only when category, brand, size, MRP and every saved attribute match. Different details remain separate, and sizes entered together share a style.' },
            { type: 'feature', title: 'Quick Inventory Count Corrections', description: 'Use plus/minus beside stock quantities, with checks for intervening sales and safe retries. Inventory filters include available category-specific and custom attributes.' },
            { type: 'improvement', title: 'Remember Rack Entry and Suggest Prices', description: 'The rack form remembers unfinished entry on this device, suggests frequently used category prices and keeps size counts separate from style selections.' },
        ],
    },
    {
        version: '3.0.26',
        title: 'Direct Stock Entry and Excel Inventory',
        date: '17 October 2026',
        changes: [
            { type: 'feature', title: 'Add Stock Manually or from Excel', description: 'Stock now has Inventory, Add manually and Excel upload. Review editable names, garment attributes and quantities, then save directly to inventory without the count-draft and label activation steps.' },
            { type: 'feature', title: 'Name Each Stock Batch', description: 'Give manual entries and Excel imports an optional batch name. The batch is recorded with each item and its stock movement.' },
            { type: 'improvement', title: 'Readable Names and Separate Barcodes', description: 'Use names such as Crazy Heart Plain - XL. Matching names do not merge different garments; each stock row has its own short barcode and attributes.' },
            { type: 'fix', title: 'Edit Counts from Inventory', description: 'Edit count opens a physical count correction on the Stock page. Corrections detect intervening sales, repeated saves do not duplicate stock, and previously imported Excel rows are skipped.' },
        ],
    },
    {
        version: '3.0.25',
        title: 'Stock Import and Inventory Fixes',
        date: '17 October 2026',
        changes: [
            { type: 'fix', title: 'Finish Adding Audited Stock', description: 'Saved counts now lead directly to Add to inventory. Changed counts are saved and checked before continuing, and one clear confirmation replaces the separate physical-check controls.' },
            { type: 'fix', title: 'See Which Audit Items Are Already Saved', description: 'Excel rows show whether setup is unfinished, cancelled or already added. Resume the saved item instead of accidentally trying to create it again.' },
            { type: 'fix', title: 'Support Missing Categories and No-Size Items', description: 'Review and create an audit category from the stock form. Accessories and other items without sizes can be imported without inventing a clothing size.' },
            { type: 'fix', title: 'Protect Counts and Uncertain Stock Requests', description: 'Closing edited counts asks before discarding them. Retrying a lost stock response keeps the same request so receipts and imports are not accidentally added twice.' },
            { type: 'fix', title: 'Accurate Item Review and List Details', description: 'Stock review detects changed category, price and audit attributes correctly. Inventory shows selling price separately from MRP, and invalid movement date ranges are stopped before loading.' },
            { type: 'fix', title: 'Customer Call Compatibility', description: 'Corrected customer activity-log calls and POS customer-name lookup to use the available database methods.' },
        ],
    },
    {
        version: '3.0.24',
        title: 'Customer Input Length Constraints & Phone Guarding',
        date: '14 October 2026',
        changes: [
            {
                type: 'fix',
                title: 'Strict Phone Number & Name Length Guards',
                description: 'Restricted POS customer input and Quick Add to 10 digits for standard phone numbers (or max 13 with + country code) and 50 characters for names, preventing overflow.'
            },
            {
                type: 'improvement',
                title: 'Clean Phone Lookups Without Mid-Typing Flickering',
                description: 'Customer phone badges and state are cleanly assigned on customer selection or Enter rather than prematurely updating on every mid-typing keystroke.'
            },
            {
                type: 'improvement',
                title: 'Customer Directory Field Constraints',
                description: 'Enforced field-level length limits across full name (50), phone (14), email (80), GSTIN (15), and address (200).'
            }
        ],
    },
    {
        version: '3.0.23',
        title: 'POS Customer Auto-Sync & Directory Registration',
        date: '14 October 2026',
        changes: [
            {
                type: 'feature',
                title: 'Seamless POS Customer Directory Registration',
                description: 'Entering a customer in the POS billing screen (by name alone, phone alone, or both) automatically creates/syncs their profile directly into the Customers CRM directory.'
            },
            {
                type: 'improvement',
                title: 'Past Sales Customer Discovery',
                description: 'The Customers page automatically identifies and displays all historical customers billed across past sales so no customer history is missed.'
            },
            {
                type: 'improvement',
                title: 'Flexible Customer Identification',
                description: 'Full support for name-only customers, phone-only customers, and combined name + phone inputs directly from the keyboard without popup interruptions.'
            }
        ],
    },
    {
        version: '3.0.22',
        title: 'Customer Modification Audit Logging & Activity Log Visibility',
        date: '14 October 2026',
        changes: [
            {
                type: 'improvement',
                title: 'Comprehensive Customer Change Auditing',
                description: 'Updating customer name or phone on a finalized sale is explicitly tracked in audit logs with before/after customer snapshots and detailed change summaries.'
            },
            {
                type: 'improvement',
                title: 'Activity Log Visual Customer Diff',
                description: 'The Activity page and breakdown modal now clearly display customer modifications alongside item and total amount changes.'
            },
            {
                type: 'feature',
                title: 'Customer Directory CRM Audit Trail',
                description: 'Creating, updating, and removing customers in the Customers directory is now recorded in the Activity Log with operator attribution.'
            }
        ],
    },
    {
        version: '3.0.21',
        title: 'POS Optional Customer Name & Direct Phone Billing',
        date: '14 October 2026',
        changes: [
            {
                type: 'improvement',
                title: 'Customer Name is Completely Optional',
                description: 'Cashiers can enter just a phone number and press Enter to bill immediately without being forced to enter a customer name or interrupted by popup modals.'
            },
            {
                type: 'improvement',
                title: 'Seamless Phone Registration',
                description: 'Customers can be registered with only a phone number; names default automatically to Customer <Phone> if left blank.'
            }
        ],
    },
    {
        version: '3.0.20',
        title: 'POS Customer Search & Real-time Suggestions',
        date: '14 October 2026',
        changes: [
            {
                type: 'feature',
                title: 'Real-time Customer Autocomplete in POS',
                description: 'Search and link customers instantly on the POS billing screen by typing either customer name or phone number with real-time dropdown suggestions.'
            },
            {
                type: 'feature',
                title: 'Quick Register New Customer',
                description: 'Quickly register and select a new customer on the spot directly from the POS header autocomplete without navigating away from the billing register.'
            },
            {
                type: 'improvement',
                title: 'Walk-in Customer Default & Instant Reset',
                description: 'Keeps Walk-in Customer as default on every new bill, with full keyboard navigation (arrows/enter) and a one-click reset.'
            },
            {
                type: 'improvement',
                title: 'Receipt Customer Phone Support',
                description: 'Customer contact phone numbers are now cleanly rendered on printed tax receipts alongside customer name.'
            }
        ],
    },
    {
        version: '3.0.19',
        title: 'Simpler Stock Page',
        date: '14 October 2026',
        changes: [
            { type: 'improvement', title: 'Two Clear Stock Tabs', description: 'Stock now contains only Inventory and Excel upload. The traditional product list stays in Products; nested audit and prepared-item tabs have been removed.' },
            { type: 'improvement', title: 'Readable Audit Names', description: 'New audited items suggest a simple brand and design name, such as Crazy Heart Checks, with sizes and unique barcodes kept separately.' },
            { type: 'improvement', title: 'Continue Unfinished Imports', description: 'Resume counts and labels through one button under Excel upload. Shop wording such as Save counts and Ready for billing replaces draft and activation terminology.' },
        ],
    },
    {
        version: '3.0.18',
        title: 'Inventory and Gradual Relabelling',
        date: '14 October 2026',
        changes: [
            { type: 'feature', title: 'Inventory by Style or Size', description: 'Review verified stock with brand, fabric, pattern, quality and size filters. Old billing items remain separate, with unverified balances excluded from tracked totals and MRP valuation.' },
            { type: 'feature', title: 'Prepare and Activate Counted Batches', description: 'Select one actual style from the saved Excel audit, create short new barcodes, print labels and activate freshly checked pieces after holding them aside. Later batches add to current stock without overwriting sales.' },
            { type: 'feature', title: 'Reasoned Stock Corrections', description: 'Record stock received, damaged pieces or a physical recount with a reason and movement history. Recounts stop if stock changed during review.' },
            { type: 'fix', title: 'Prevent Overselling Tracked Items', description: 'Checkout, bill updates and exchanges reject insufficient tracked stock. Old generic barcodes retain their existing billing behaviour during conversion.' },
            { type: 'improvement', title: 'Identify Stock Returned on Old Bills', description: 'Keep old-label returns unverified, identify the matching tracked barcode, or hold damaged and unidentified garments outside saleable stock. Original bill values and return limits are preserved.' },
            { type: 'fix', title: 'Print the Actual Label Code', description: 'New default label layouts display the saved item barcode beneath its bars instead of a fixed sample number. Existing custom layouts and printer settings are preserved.' },
        ],
    },
    {
        version: '3.0.17',
        title: 'Customer Directory & Purchase History 360',
        date: '14 October 2026',
        changes: [
            {
                type: 'fix',
                title: 'Compliant In-App UI Dialogs & Toasts',
                description: 'Eliminated native browser alert dialogs on the Customers page, adopting responsive in-app toasts and styled ConfirmDialog components.'
            },
            {
                type: 'feature',
                title: 'Customer 360 & Purchase History',
                description: 'Inspect full customer purchase histories, lifetime revenue, repeat order counts, and launch new sales directly from customer profiles.'
            },
            {
                type: 'feature',
                title: 'Filters, Metrics & Excel Export',
                description: 'Analyze store customer metrics (repeat buyers, GSTIN registrations, lifetime spend) and export records to Excel (.xlsx).'
            },
            {
                type: 'improvement',
                title: 'Customer Profile Editing & Duplicate Prevention',
                description: 'Create and update customers with real-time phone duplication warnings, uppercase GSTIN normalization, and safe deletion.'
            }
        ]
    },
    {
        version: '3.0.16',
        title: 'Excel Stock Audit Upload',
        date: '14 October 2026',
        changes: [
            {
                type: 'feature',
                title: 'Upload Audit Counts from Excel',
                description: 'Stock → Excel Audit accepts your audit workbook, previews its item details and counts, and saves a separate review snapshot on this computer.'
            },
            {
                type: 'improvement',
                title: 'Replace Audit Snapshots without Duplicating Counts',
                description: 'A newer upload replaces the previous audit snapshot after confirmation. Blank counts stay uncounted, zero stays zero, and invalid files preserve the previous upload.'
            },
            {
                type: 'improvement',
                title: 'Removed the Neon Audit Connection',
                description: 'Removed database connection fields and automatic audit pulls. Excel uploads work offline and leave shop products, stock, sales and count drafts unchanged.'
            }
        ]
    },
    {
        version: '3.0.15',
        title: 'Neon Audit Schema Compatibility',
        date: '12 October 2026',
        changes: [
            {
                type: 'fix',
                title: 'Connect the Audit Catalogue',
                description: 'Neon audits without a Product name column can use their linked category name. Size, barcode, brand, fabric, pattern, sleeve, MRP and selected variant quantity remain available for review.'
            },
            {
                type: 'improvement',
                title: 'Read Additional Garment Details',
                description: 'Supported garment fields in customMeta are read with the same protections as attributes. Costs and private metadata stay excluded, and separate variants keep their original identities.'
            }
        ]
    },
    {
        version: '3.0.14',
        title: 'Historical Import Reverted',
        date: '12 October 2026',
        changes: [
            {
                type: 'fix',
                title: 'Restored Sales History and AI Forecaster',
                description: 'Removed the old-software archive screens and import functionality. Sales History and AI Forecaster return to their existing app records and views.'
            }
        ]
    },
    {
        version: '3.0.11',
        title: 'Live Neon Audit Connection',
        date: 'October 2026',
        changes: [
            {
                type: 'feature',
                title: 'Connect an Audit Database in Settings',
                description: 'Enter a Neon PostgreSQL connection string in the desktop app, choose the audit quantity column and automatically pull product details and counts.'
            },
            {
                type: 'feature',
                title: 'Separate Audit Review in Stock',
                description: 'Search incoming audit observations in Stock → Neon Audit. Pulling data does not change shop stock, existing products, bills or stock-count drafts.'
            },
            {
                type: 'improvement',
                title: 'Read-Only Access and Saved Offline Data',
                description: 'Neon is queried in read-only transactions. Connection details are encrypted on the computer, and failed refreshes preserve the last complete audit snapshot.'
            }
        ]
    },
    {
        version: '3.0.10',
        title: 'Stock-Count Draft Reliability',
        date: 'October 2026',
        changes: [
            {
                type: 'fix',
                title: 'Safe Draft Editing and Search',
                description: 'Failed loads and delayed responses can no longer overwrite another draft. Prepared-item searches keep results matched to the current query.'
            },
            {
                type: 'fix',
                title: 'Preserved Counted Item Details',
                description: 'Count edits preserve the original item details and show catalogue changes for review, including sizes, descriptions and prices.'
            },
            {
                type: 'fix',
                title: 'Correct Count Times and Reliable Retries',
                description: 'Reopening a draft preserves its observed count time. Save and cancellation retries recover safely after a lost response without duplicating records.'
            }
        ]
    },
    {
        version: '3.0.9',
        title: 'Durable Stock-Count Drafts (ST-03A)',
        date: 'October 2026',
        changes: [
            {
                type: 'feature',
                title: 'Durable Stock-Count Drafts',
                description: 'Added Count Drafts view in Stock with local database persistence, revision tracking, durable operation replay, and terminal cancellation. Record observed physical batches without altering live stock or activation.'
            },
            {
                type: 'feature',
                title: 'Prepared Variant Picker & Identity Snapshot',
                description: 'Search and link prepared variants with distinct readable details even when prices or names match, capturing descriptive and barcode snapshots with catalogue difference review alerts.'
            },
            {
                type: 'improvement',
                title: 'In-App Safe Dialogs & Backend Permissions',
                description: 'Enforced trusted backend session authentication with inventory permissions across all draft reads and writes; integrated in-app ConfirmDialog for terminal draft cancellation.'
            }
        ]
    },
    {
        version: '3.0.8',
        title: 'Window Title Bar & Modal Backdrop Stacking',
        date: 'October 2026',
        changes: [
            {
                type: 'fix',
                title: 'Clean Title Bar Divider Under Modals',
                description: 'Elevated window title bar stacking order above modal backdrop overlays so the title bar background cleanly extends to its bottom divider line without being cut off.'
            }
        ]
    },
    {
        version: '3.0.7',
        title: 'Activity Log Formatting & Cash Drawer Audits',
        date: 'October 2026',
        changes: [
            {
                type: 'fix',
                title: 'Activity Log Human-Readable Parsing',
                description: 'Eliminated raw JSON string dumps in activity logs; parsed cash register reopen, close, cancel, and entry operations into clear plain-English narratives.'
            },
            {
                type: 'improvement',
                title: 'Structured Financial Audit Breakdown',
                description: 'Added modal inspection cards for cash register closing counts, expected vs. actual balances, and expandable raw payload viewer.'
            }
        ]
    },
    {
        version: '3.0.6',
        title: 'Stock Overview, Variant Matrix & Shift Management',
        date: 'October 2026',
        changes: [
            {
                type: 'feature',
                title: 'Stock & Inventory Overview',
                description: 'Dedicated inventory management page with balance filters (Positive, Zero, Negative), valuation summary, and detailed movement history.'
            },
            {
                type: 'feature',
                title: 'Multi-Variant Matrix & Garment Attributes',
                description: 'Full variant editing supporting fabric, sleeve, fit, color, and size with distinct barcodes and label preview.'
            },
            {
                type: 'feature',
                title: 'Stock Preparation Safeguards',
                description: 'Explicit preparation state prevents uncounted variants from being accidentally billed or sold before physical stock conversion.'
            },
            {
                type: 'feature',
                title: 'Cash Drawer & Shift History',
                description: 'Register shift management with opening float tracking, cash-in/out logging, drawer closing, and historical session logs.'
            },
            {
                type: 'improvement',
                title: 'Clean Thermal Receipt Modal',
                description: 'Fast, high-contrast thermal receipt card modal mounted via portal with instant 0ms cached rendering matching desktop ESC/POS printouts.'
            },
            {
                type: 'fix',
                title: 'Desktop Window Controls & Mobile Theming',
                description: 'Custom frameless title bar window controls with Electron state sync and theme-synchronized mobile status bars.'
            }
        ]
    },
    {
        version: '3.0.5',
        title: 'Smart Sales Search & Reports Polish',
        date: 'September 2026',
        changes: [
            {
                type: 'feature',
                title: 'Smart Sales History Search',
                description: 'Search across all-time history for item names, variants, barcodes, SKUs, and prices with instant matched-item badges in table rows.'
            },
            {
                type: 'feature',
                title: 'Transaction Type Filters',
                description: 'Filter sales history by Regular Sales, Exchange Replacement bills, Returns/Refunds, and Voided invoices.'
            },
            {
                type: 'improvement',
                title: 'Sidebar Animation',
                description: 'Optimized sidebar expand and collapse transitions with zero UI layout jitter.'
            },
            {
                type: 'improvement',
                title: 'GST Report Summary Cards',
                description: 'Clean, uniform summary cards matching the application theme without side stripes.'
            },
            {
                type: 'fix',
                title: 'Search Date Scope',
                description: 'Defaults to full database search with quick toggle to restrict within the active date range.'
            }
        ]
    },
    {
        version: '3.0.4',
        title: 'Thermal Receipts & Mobile Theming',
        date: 'September 2026',
        changes: [
            {
                type: 'feature',
                title: 'Clean Thermal Receipt View',
                description: 'Digital thermal receipt card matching physical ESC/POS desktop prints with instant print preview.'
            },
            {
                type: 'improvement',
                title: 'Fast Invoice Loading',
                description: 'Instant receipt modal rendering for smoother bill lookup.'
            },
            {
                type: 'fix',
                title: 'Mobile Status Bar',
                description: 'Synchronized dynamic theme colors across Android notification and status bars.'
            }
        ]
    },
    {
        version: '3.0.3',
        title: 'Adaptive App Icons & Android Push',
        date: 'September 2026',
        changes: [
            {
                type: 'feature',
                title: 'Sale Alerts & Sound',
                description: 'Cash register chime audio and push notifications for new sales.'
            },
            {
                type: 'feature',
                title: 'Adaptive App Icons',
                description: 'Themed monochrome and maskable icons for Android and Nothing OS.'
            },
            {
                type: 'improvement',
                title: 'Push Payload Delivery',
                description: 'Optimized push notification formatting and high-urgency delivery.'
            }
        ]
    },
    {
        version: '3.0.2',
        title: 'Real-Time WebSockets & Activity Logs',
        date: 'July 2026',
        changes: [
            {
                type: 'feature',
                title: 'WebSocket Live Sync',
                description: 'Auto-reconnecting WebSockets with ping keepalive for real-time sales and voids notifications.'
            },
            {
                type: 'feature',
                title: 'Activity & Audit Logging',
                description: 'Live security and transaction audit logs synced between POS terminal and dashboard.'
            },
            {
                type: 'fix',
                title: 'Void Sale Sync',
                description: 'Fixed real-time status-change detection for voided sales and exchanges.'
            }
        ]
    },
    {
        version: '3.0.1',
        title: 'GST Reports & Data Export Engine',
        date: 'July 2026',
        changes: [
            {
                type: 'feature',
                title: 'PDF & Excel Export',
                description: 'One-click export for comprehensive GST reports with tax slab breakdowns.'
            },
            {
                type: 'improvement',
                title: 'Month & Date Filters',
                description: 'Integrated specialized month picker and fast date range navigation.'
            },
            {
                type: 'fix',
                title: 'Tax Turnover Calculation',
                description: 'Correct separation of completed, replaced, and cancelled bills in reports.'
            }
        ]
    },
    {
        version: '3.0.0',
        title: 'Cloud Architecture & Secure IPC',
        date: 'July 2026',
        changes: [
            {
                type: 'feature',
                title: 'Cloud PostgreSQL Backend',
                description: 'Migrated cloud API database from SQLite to PostgreSQL for multi-device sync.'
            },
            {
                type: 'feature',
                title: 'Secure Electron IPC',
                description: 'Hardened inter-process communication with role-based validation.'
            },
            {
                type: 'improvement',
                title: 'Unified Sales Navigation',
                description: 'Combined Bills and Sales interfaces into a single high-performance page.'
            }
        ]
    },
    {
        version: '2.5.0',
        title: 'Sync Secret & Clock Drift Protection',
        date: 'April 2026',
        changes: [
            {
                type: 'feature',
                title: 'Cloud Sync Secret',
                description: 'Configurable secret key authentication in desktop settings for API verification.'
            },
            {
                type: 'fix',
                title: 'Timestamp Guards',
                description: 'Protected sales records against invalid system timestamps and offline clock drift.'
            }
        ]
    },
    {
        version: '2.0.0',
        title: 'Initial POS & Web Dashboard Release',
        date: 'March 2026',
        changes: [
            {
                type: 'feature',
                title: 'Offline POS Foundation',
                description: 'Desktop point-of-sale with local SQLite, thermal receipt printing, and barcode scanning.'
            },
            {
                type: 'feature',
                title: 'Product & Variant Management',
                description: 'Multi-size, multi-color clothing variants, inventory tracking, and low-stock alerts.'
            },
            {
                type: 'feature',
                title: 'Web Cloud Dashboard',
                description: 'Remote dashboard for tracking daily revenue, top products, and store performance.'
            }
        ]
    }
];

export const VersionInfo: React.FC = () => {
    return (
        <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Version & System Details (5 cols) */}
                <div className="lg:col-span-5 space-y-6">
                    {/* Application Details Card */}
                    <div className="p-6 bg-blue-50/30 dark:bg-blue-900/5 rounded-xl border border-blue-100 dark:border-blue-900/30 space-y-5">
                        <div className="flex items-center gap-3">
                            <img src={appIcon} alt="Zain POS" className="w-11 h-11 rounded-xl shadow-sm object-contain flex-shrink-0" />
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 dark:text-white">Application Details</h3>
                                <p className="text-sm text-gray-500 italic">Zain Gents Palace POS</p>
                            </div>
                        </div>

                        <div className="space-y-3 pt-2 text-sm">
                            <div className="flex items-center justify-between py-2 border-b border-blue-100 dark:border-blue-900/30">
                                <span className="text-gray-500 dark:text-gray-400">Software Version</span>
                                <span className="font-bold text-base text-blue-600 dark:text-blue-400">
                                    v{packageInfo.version}
                                </span>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-blue-100 dark:border-blue-900/30">
                                <span className="text-gray-500 dark:text-gray-400">Release Date</span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">
                                    September 2026
                                </span>
                            </div>

                            <div className="flex items-center justify-between py-2">
                                <span className="text-gray-500 dark:text-gray-400">System Edition</span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">
                                    Retail POS Desktop
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* System Specifications Card */}
                    <div className="p-6 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200/80 dark:border-gray-700 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gray-700 dark:bg-gray-600 rounded-lg text-white">
                                <Cpu className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 dark:text-white">System Environment</h3>
                                <p className="text-sm text-gray-500 italic">Desktop Architecture</p>
                            </div>
                        </div>

                        <div className="space-y-3 pt-2 text-sm">
                            <div className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                                <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                    <Cpu className="w-4 h-4 text-gray-400" />
                                    Runtime
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">Desktop Electron</span>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                                <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                    <HardDrive className="w-4 h-4 text-gray-400" />
                                    Database
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">SQLite (Offline-First)</span>
                            </div>

                            <div className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                                <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                    <Globe className="w-4 h-4 text-gray-400" />
                                    Cloud Sync
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">Delta Sync (REST)</span>
                            </div>

                            <div className="flex items-center justify-between py-2">
                                <span className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                    <Printer className="w-4 h-4 text-gray-400" />
                                    Print Engine
                                </span>
                                <span className="font-medium text-gray-800 dark:text-gray-200">ESC/POS Thermal</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Release History Timeline (7 cols) */}
                <div className="lg:col-span-7 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <History className="w-5 h-5 text-blue-500" />
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                Release History & Changelog
                            </h3>
                        </div>
                        <span className="text-xs text-gray-500">
                            {RELEASES.length} Releases Tracked
                        </span>
                    </div>

                    <div className="space-y-4">
                        {RELEASES.map((release) => (
                            <div
                                key={release.version}
                                className={`p-5 rounded-xl border space-y-3 transition-all ${
                                    release.isCurrent
                                        ? 'bg-blue-50/20 dark:bg-blue-950/10 border-blue-200 dark:border-blue-900/40'
                                        : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200/80 dark:border-gray-700'
                                }`}
                            >
                                {/* Version Header */}
                                <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2.5">
                                    <div className="flex items-center gap-2.5">
                                        <span className="font-bold text-base text-gray-900 dark:text-white">
                                            v{release.version}
                                        </span>
                                        <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                                            — {release.title}
                                        </span>
                                        {release.isCurrent && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                                                Current
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                                        {release.date}
                                    </span>
                                </div>

                                {/* Changes List */}
                                <div className="space-y-2 pt-1">
                                    {release.changes.map((item, idx) => (
                                        <div key={idx} className="flex items-start gap-2.5 text-xs">
                                            <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                                                    item.type === 'feature'
                                                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                                        : item.type === 'improvement'
                                                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                                        : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                                }`}
                                            >
                                                {item.type === 'feature' ? 'New' : item.type === 'improvement' ? 'Update' : 'Fix'}
                                            </span>
                                            <div className="text-gray-700 dark:text-gray-300 leading-relaxed">
                                                <span className="font-semibold text-gray-800 dark:text-gray-200">{item.title}:</span>{' '}
                                                {item.description}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
