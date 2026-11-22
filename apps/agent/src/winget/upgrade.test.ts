import { describe, expect, it } from 'vitest';
import {
  buildUpgradeArgs,
  isRestartExitCode,
  sanitizeVersion,
  summarizeFailure,
  type UpgradeRun,
} from './upgrade';

const job = {
  packageId: '7zip.7zip',
  targetVersion: '24.08',
  source: 'winget' as const,
};

describe('buildUpgradeArgs', () => {
  it('builds exactly the fixed argument list', () => {
    expect(buildUpgradeArgs(job)).toEqual([
      'upgrade',
      '--id',
      '7zip.7zip',
      '--exact',
      '--source',
      'winget',
      '--version',
      '24.08',
      '--disable-interactivity',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ]);
  });

  it('always pins the exact package and version', () => {
    const args = buildUpgradeArgs(job);
    expect(args).toContain('--exact');
    expect(args[args.indexOf('--version') + 1]).toBe('24.08');
  });

  it('never contains a flag that would skip a safety check', () => {
    const args = buildUpgradeArgs(job).join(' ');
    for (const forbidden of ['--ignore-security-hash', '--force', '--skip', '--unsafe']) {
      expect(args).not.toContain(forbidden);
    }
  });

  it('rejects a package id that tries to be a command', () => {
    for (const packageId of [
      '7zip.7zip; calc.exe',
      '7zip 7zip',
      '7zip/7zip',
      '$(calc)',
      '7zip..7zip',
    ]) {
      expect(() => buildUpgradeArgs({ ...job, packageId })).toThrow();
    }
  });

  it('rejects a version that is not a version', () => {
    for (const targetVersion of ['24.08 && calc', '24.08;calc', '..', '']) {
      expect(() => buildUpgradeArgs({ ...job, targetVersion })).toThrow();
    }
  });

  it('rejects any source other than winget', () => {
    expect(() => buildUpgradeArgs({ ...job, source: 'msstore' as never })).toThrow();
  });
});

describe('isRestartExitCode', () => {
  it('knows the Windows Installer restart codes', () => {
    expect(isRestartExitCode(3010)).toBe(true);
    expect(isRestartExitCode(1641)).toBe(true);
  });

  it('does not treat success or ordinary failures as a restart', () => {
    expect(isRestartExitCode(0)).toBe(false);
    expect(isRestartExitCode(1603)).toBe(false);
  });
});

describe('sanitizeVersion', () => {
  it('keeps a normal version', () => {
    expect(sanitizeVersion('24.08')).toBe('24.08');
    expect(sanitizeVersion('5.17.11 (34827)')).toBe('5.17.11 (34827)');
  });

  it('strips control characters and trims', () => {
    expect(sanitizeVersion('  24.08\u0000 ')).toBe('24.08');
  });

  it('returns null for nothing useful', () => {
    expect(sanitizeVersion(null)).toBeNull();
    expect(sanitizeVersion('   ')).toBeNull();
  });
});

describe('summarizeFailure', () => {
  const run = (overrides: Partial<UpgradeRun> = {}): UpgradeRun => ({
    exitCode: 0,
    timedOut: false,
    stdout: '',
    stderr: '',
    ...overrides,
  });

  it('says nothing when the installer succeeded', () => {
    expect(summarizeFailure(run())).toBeNull();
  });

  it('reports a timeout in plain words', () => {
    expect(summarizeFailure(run({ exitCode: -1, timedOut: true }))).toContain('timed out');
  });

  it('includes the exit code when WinGet said nothing', () => {
    expect(summarizeFailure(run({ exitCode: 1603 }))).toContain('1603');
  });

  it('keeps the summary short and on one line', () => {
    const summary = summarizeFailure(run({ exitCode: 1, stderr: 'x'.repeat(5000) }));
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(1000);
    expect(summary).not.toContain('\n');
  });
});
