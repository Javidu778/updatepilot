import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('writes a plain value untouched', () => {
    expect(csvCell('7-Zip')).toBe('7-Zip');
    expect(csvCell(24.08)).toBe('24.08');
    expect(csvCell(true)).toBe('yes');
    expect(csvCell(false)).toBe('no');
  });

  it('writes nothing for a missing value', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a value that would break the columns', () => {
    expect(csvCell('Igor Pavlov, Ltd')).toBe('"Igor Pavlov, Ltd"');
    expect(csvCell('a "quoted" name')).toBe('"a ""quoted"" name"');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
    expect(csvCell('semi;colon')).toBe('"semi;colon"');
  });

  it('neutralises a value a spreadsheet would treat as a formula', () => {
    // A package publisher is attacker-controlled text: it must never execute on open.
    for (const dangerous of [
      '=HYPERLINK("http://evil.example","click")',
      '+1+1',
      '-2+3',
      '@SUM(A1)',
      '\t=calc',
    ]) {
      const cell = csvCell(dangerous);
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });

  it('does not mangle a value that merely contains an operator', () => {
    expect(csvCell('Visual C++ 2015-2022')).toBe('Visual C++ 2015-2022');
    expect(csvCell('1.2.3-beta')).toBe('1.2.3-beta');
  });
});

describe('toCsv', () => {
  const columns = [
    { header: 'Application', value: (row: { name: string; version: string }) => row.name },
    { header: 'Version', value: (row: { name: string; version: string }) => row.version },
  ];

  it('starts with a BOM so Excel reads UTF-8', () => {
    expect(toCsv([], columns).startsWith('\uFEFF')).toBe(true);
  });

  it('always writes the header row, even with no data', () => {
    expect(toCsv([], columns)).toBe('\uFEFFApplication,Version\r\n');
  });

  it('writes CRLF line endings', () => {
    const csv = toCsv([{ name: 'Git', version: '2.56.1' }], columns);
    expect(csv).toBe('\uFEFFApplication,Version\r\nGit,2.56.1\r\n');
  });

  it('keeps a value with a comma inside one column', () => {
    const csv = toCsv([{ name: 'Igor Pavlov, Ltd', version: '24.08' }], columns);
    expect(csv.split('\r\n')[1]).toBe('"Igor Pavlov, Ltd",24.08');
  });
});
