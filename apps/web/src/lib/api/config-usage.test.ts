import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One place decides where the API lives.
 *
 * This guard exists because ApiStatus.tsx kept its own copy of the old fallback
 * (`process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'`). When the app moved to a same-origin
 * proxy, every page followed except that badge, which then reported "API unreachable" on a deployment
 * that was working. A single reader is the only way to keep that from happening again.
 */
const SRC = join(process.cwd(), 'src');
const ALLOWED = join(SRC, 'lib', 'api', 'config.ts');
const PATTERN = 'process.env.NEXT_PUBLIC_API_URL';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('API URL resolution', () => {
  it('is read from exactly one file', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => path !== ALLOWED)
      // This file contains the pattern as a string literal, so it would match itself.
      .filter((path) => !path.endsWith('config-usage.test.ts'))
      .filter((path) => readFileSync(path, 'utf8').includes(PATTERN))
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });
});
