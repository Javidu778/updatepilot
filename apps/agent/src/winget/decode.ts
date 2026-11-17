/**
 * WinGet output is messy in three specific ways, all seen in the wild:
 *   - when piped it can be UTF-16LE (with a BOM) instead of UTF-8;
 *   - it can still contain ANSI colour codes;
 *   - it uses CRLF line endings on Windows.
 *
 * Every row of the parser below depends on this being normalised first.
 */

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;

/** A UTF-16LE pipe is half NUL bytes; UTF-8 text is almost never NUL-heavy. */
export function decodeWingetOutput(output: Buffer | string): string {
  if (typeof output === 'string') return normalize(output);

  const bytes = output;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return normalize(bytes.subarray(2).toString('utf16le'));
  }
  if (bytes.length >= 2 && bytes[0] === 0xef && bytes[1] === 0xbb) {
    return normalize(bytes.subarray(3).toString('utf8'));
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, 400));
  let zeros = 0;
  for (const byte of sample) if (byte === 0) zeros += 1;
  if (zeros > sample.length / 4) return normalize(bytes.toString('utf16le'));

  return normalize(bytes.toString('utf8'));
}

function normalize(text: string): string {
  return text
    .replace(/\uFEFF/g, '')
    .replace(ANSI, '')
    .replace(/\r\n?/g, '\n');
}
