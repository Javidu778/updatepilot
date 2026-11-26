# UpdatePilot: Exports

Status: Implemented in Week 5 (FR-11)
Code: `apps/api/src/routes/exports.ts`, `apps/api/src/exports/csv.ts`, `apps/web/src/components/DownloadCsv.tsx`
Related: [`docs/inventory-api.md`](inventory-api.md), [`docs/insights.md`](insights.md), [`docs/threat-model.md`](threat-model.md)

Two CSV files: the inventory, and the update history.

## 1. Endpoints

| Method | Path                               | Returns                                                        |
| ------ | ---------------------------------- | -------------------------------------------------------------- |
| GET    | `/api/v1/exports/applications.csv` | The inventory, honouring the same filters and sort as the list |
| GET    | `/api/v1/exports/updates.csv`      | Every update job with its outcome and verification             |

Both need a session, send `Cache-Control: no-store`, and are rate limited to **20 exports per user per
hour**. Each export writes an `EXPORT_CREATED` audit event with the kind, the row count and whether the
result was truncated.

Response headers worth knowing:

| Header                    | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `Content-Disposition`     | `attachment; filename="updatepilot-inventory-2026-11-26.csv"` |
| `X-UpdatePilot-Rows`      | How many data rows are in the file                            |
| `X-UpdatePilot-Truncated` | `true` when the 20 000-row cap was hit                        |

## 2. What is in the files

**Inventory**: device, application, publisher, installed and available version, package id, source,
architecture, match status, update status, last seen, removed, sample-data flag. The columns match the
inventory table, so the file explains what the screen showed.

**Updates**: requested and finished time, device, application, package id, from and to version, state,
verification result, verified version, exit code, restart flag, and the stored reason.

## 3. The one security decision in this feature

Application names and publishers are **attacker-controlled text**: they come from whatever the
installed software decided to call itself, and they end up in somebody's spreadsheet. A cell beginning
with `=`, `+`, `-`, `@`, TAB or CR is treated by Excel as a formula, so a publisher string could run a
command when the file is opened.

Every such cell is prefixed with an apostrophe (inside its quotes), which spreadsheets read as "this is
text". The rule lives in `apps/api/src/exports/csv.ts` and is covered by tests with real payloads such
as `=HYPERLINK("http://evil.example","click")`.

Values are quoted when they contain a comma, quote, newline or semicolon, with quotes doubled, and the
file starts with a UTF-8 BOM so Excel does not mangle non-ASCII publisher names. Lines end with CRLF.

## 4. Limits

- 20 000 rows per file. A larger inventory is truncated, and the header says so.
- 20 exports per user per hour.
- The export is built in memory, so it is sized for a single person's inventory, not a fleet.
- No PDF, no scheduled export, no email delivery.

## 5. Tests

| Suite                                        | Covers                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/api/src/exports/csv.test.ts`           | Formula neutralising, quoting, BOM, CRLF, empty file                                   |
| `apps/api/src/routes/exports.routes.test.ts` | Both files, filter parity with the list, the audit event, isolation between users, 401 |
