/**
 * CSV building, with the two hazards that actually matter.
 *
 * 1. **Formula injection.** A spreadsheet treats a cell starting with =, +, -, @, TAB or CR as a
 *    formula. Application names and publisher strings come from WinGet, which means they come from
 *    whatever the installed software decided to call itself, so a value like
 *    `=HYPERLINK("http://evil","click")` would execute when the file is opened in Excel. Every such
 *    value is prefixed with an apostrophe, which spreadsheets treat as "this is text".
 *
 * 2. **Quoting.** A comma, quote, newline or semicolon in a value would break the columns, so those
 *    values are quoted and their quotes doubled, which is what RFC 4180 asks for.
 */

export type CsvValue = string | number | boolean | null | undefined;

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => CsvValue;
};

const NEEDS_QUOTES = /[",\n\r;]/;
// A leading formula character, optionally after spaces that Excel ignores.
const FORMULA_START = /^[\s]*[=+\-@\t\r]/;

function text(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/** One cell, neutralised and quoted. Exported for testing because this is the security boundary. */
export function csvCell(value: CsvValue): string {
  const raw = text(value);

  // Neutralise a formula before quoting: the apostrophe must be inside the quotes.
  const safe = FORMULA_START.test(raw) ? `'${raw}` : raw;

  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * A full CSV document.
 *
 * Starts with a UTF-8 BOM: without it Excel reads the file as the local code page and mangles
 * non-ASCII publisher names. Lines end with CRLF, which is what RFC 4180 specifies.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(','));
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
