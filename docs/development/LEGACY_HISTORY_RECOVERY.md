# Recovered MaxSell history — initial assessment

Inspected 12 October 2026. Owner selected **old sales and purchase history for business analysis**. This is an inspection and recovery plan, not a completed import.

## Evidence from the four original files

All four files were opened read-only. Each starts with the Microsoft Tape Format `TAPE` signature and contains `Microsoft SQL Server`, database identifiers and original MDF/LDF paths in its header. This identifies the backup format; it does not prove that the full backup is valid, unencrypted, restorable or contains particular transaction tables.

| File in `C:\Users\admin\Downloads` | Bytes | Database identifier seen in raw header | SHA-256 |
| --- | ---: | --- | --- |
| `Maxsll22_zaindp_02_04_2024.bak` | 61,381,120 | `Maxsll22_zaindp` | `411c51804830cd708c6476ab3d942dc5b2754465cd5c9bfc360ed579d832d4f1` |
| `MaxSell24Dp_ZAIN_GENTS_PALACE_02_04_2025.bak` | 61,381,120 | `Maxsll22_zaindp`; newer physical filename also present | `d911d3badfd4c9a204119700ecf8e33ce529829c4d1b3427330cb8078e5256ff` |
| `MaxSell24_ZAIN_GENTS_PALACE_02_04_2025.bak` | 67,251,712 | `Maxsll22_zain`; newer physical filename also present | `a15e4d84c593004be9aee8c6e0961db66ca4da8adc7dd52a78755eced533f9e9` |
| `Maxsll22_zain_02_04_2024.bak` | 70,361,600 | `Maxsll22_zain` | `cb2375d63bd2dbb5eb3f698e2c0d5863fe6b52a50d2c9fd4dadf284d8707a5ae` |

The files are not byte-for-byte duplicates. Headers suggest two related database families, but do not establish what `DP` means, how their transactions overlap, which is authoritative, or their actual transaction date ranges. Dates embedded in filenames and recovered file modification times are not reliable evidence of backup contents. No sales, purchase, customer or supplier records have yet been read.

At initial inspection, no SQL Server service, `sqlcmd`, `SqlLocalDB` command or installed-instance registry entry was found. The application has an `mssql` client dependency, which is not a SQL Server database engine. This paragraph records the initial state; recovery proceeded after the owner's installation approval below.

## Recovery completed after approval — 12 October 2026

The owner approved installing the recovery component on the personal laptop. Microsoft-signed SQL Server 2022 Express LocalDB was installed, and a dedicated `ZainLegacyRecovery20261012` instance was created. Actual headers identify full database backups made with SQL Server **2008 R2 (10.50.1600)** on 2 April 2024 and 2 April 2025. All four passed `RESTORE VERIFYONLY`; restored copies passed explicit `DBCC CHECKDB` with zero allocation/consistency errors and were set read-only with trustworthy mode off. Original backup hashes were checked before restoration/export.

Recovered: **4,417 saved sales**, **129 unsaved records**, and **₹48,30,418 recorded saved totals** across the two main books. DP sales tables are empty. Posted purchase tables are empty in all four; two older purchase-log snapshots refer to one voucher and remain unverified evidence. Actual payment splits and sufficient transaction costs are unavailable, so reliable profit is not calculated.

A portable package was prepared and tested in an isolated temporary archive. No installed-app archive or current POS database was changed. On 12 October 2026, the owner requested reverting the historical-data feature. Version 3.0.14 removes its app screens, imports, startup service and IPC channels. Original backups and private recovery exports are preserved; this document records the completed recovery only.

## Recovery before importing

1. Obtain permission before installing the required Microsoft SQL Server recovery component on the laptop. If an existing suitable SQL Server is available elsewhere, use a separate recovery instance instead. Determine backup engine versions before choosing a compatible restoration path.
2. Preserve originals and record the hashes above. Use SQL Server `RESTORE HEADERONLY`, `RESTORE FILELISTONLY` and backup verification to establish actual backup dates, database/backup-set identities, full versus differential/log type, engine version, encryption and required files. Header inspection alone is not integrity verification.
3. Restore to uniquely named, disposable recovery databases with separate data/log paths. Never restore over a current database or use `WITH REPLACE` on a pre-existing database. Keep application jobs and the old POS disconnected from these recovery databases. Restoration writes only to the recovery environment, not to the backup originals or current POS.
4. Inspect the recovered schemas and document actual table/column meanings. Summarize sales and purchases by source, document type, date range, document count and amount. Preserve returns, cancellations, discounts, taxes and unknown payment modes as recorded; do not invent values.
5. Compare the two years and the DP/non-DP databases. Matching invoice numbers alone cannot establish duplicates across different books/years. Detect exact duplicates and conflicting versions with source identities, document keys and content comparisons. Keep unresolved records in staging.
6. Produce a reviewable reconciliation report showing accepted, duplicate, conflicting and unrecognized records, with totals before any integration into the app. Determine purchase/cost availability from actual recovered records; a backup filename does not guarantee purchases are present.

Microsoft references: [backup header information](https://learn.microsoft.com/en-us/sql/relational-databases/backup-restore/backup-history-and-header-information-sql-server), [RESTORE HEADERONLY](https://learn.microsoft.com/en-us/sql/t-sql/statements/restore-statements-headeronly-transact-sql).

## Existing import scripts are not the recovery route

Read-only source review found:

- `scripts/inspect-backup.ts` runs only `RESTORE FILELISTONLY`, points to a different old backup, and requires an existing SQL Server connection.
- `scripts/migrate-from-maxsell.ts` expects already restored SQL Server tables and guessed field names. It imports products/customers, copies old stock and has no verified sales/purchase recovery workflow.
- `scripts/import-sales-full.ts` reads an Excel report, uses approximate name matching, selects the first matching variant, and assigns default cash/zero-discount values. It does not provide reliable source deduplication or safe historical isolation.
- `scripts/final-import.ts` deletes sales/items and creates simulated sales. **Do not run it as part of this recovery.**

No existing migration scripts were run, and no current POS or Neon database was opened or modified for this recovery. The subsequent isolated history feature has been reverted at the owner's request.
