import { describe, expect, it } from 'vitest';
import {
  agentJobSchema,
  displayVersionSchema,
  packageIdSchema,
  targetVersionSchema,
} from './identifiers';

describe('packageIdSchema', () => {
  it.each([
    'Microsoft.VisualStudioCode',
    'Notepad++.Notepad++',
    '7zip.7zip',
    'Microsoft.VCRedist.2015+.x64',
    'Git.Git',
  ])('accepts %s', (id) => {
    expect(packageIdSchema.safeParse(id).success).toBe(true);
  });

  it.each([
    '',
    'a',
    'foo bar',
    'a;calc',
    'a&&calc',
    'a|b',
    '$(calc)',
    '`calc`',
    '"quoted"',
    "it's",
    '..\\..\\windows',
    'C:\\Windows\\System32\\cmd.exe',
    'a/b',
    'a..b',
    '.leading',
    '-leading',
    'Git.Git\nwhoami',
    'Git.Git\r\n',
    'Git.Git --ignore-security-hash',
    'a'.repeat(129),
  ])('rejects %j', (id) => {
    expect(packageIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('targetVersionSchema', () => {
  it.each(['24.08', '2.45.1', '1.91.1-beta.2', '8.7.5'])('accepts %s', (v) => {
    expect(targetVersionSchema.safeParse(v).success).toBe(true);
  });

  it.each(['', '1.0 && calc', '1.0;rm', '"1.0"', '1..0', '1.0 beta', 'a'.repeat(65)])(
    'rejects %j',
    (v) => {
      expect(targetVersionSchema.safeParse(v).success).toBe(false);
    },
  );
});

describe('displayVersionSchema', () => {
  it('allows readable inventory versions', () => {
    expect(displayVersionSchema.safeParse('2024.1 (build 5)').success).toBe(true);
  });
  it('rejects control characters', () => {
    expect(displayVersionSchema.safeParse('1.0\u0000').success).toBe(false);
    expect(displayVersionSchema.safeParse('1.0\n2.0').success).toBe(false);
  });
});

describe('agentJobSchema', () => {
  const jobId = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';

  it('accepts a scan job', () => {
    expect(agentJobSchema.safeParse({ kind: 'scan', jobId }).success).toBe(true);
  });

  it('accepts an upgrade job', () => {
    const job = {
      kind: 'upgrade',
      jobId,
      packageId: 'Git.Git',
      targetVersion: '2.45.1',
      source: 'winget',
    };
    expect(agentJobSchema.safeParse(job).success).toBe(true);
  });

  it('rejects unknown operations', () => {
    expect(
      agentJobSchema.safeParse({
        kind: 'uninstall',
        jobId,
        packageId: 'Git.Git',
      }).success,
    ).toBe(false);
    expect(agentJobSchema.safeParse({ kind: 'exec', jobId, command: 'calc.exe' }).success).toBe(
      false,
    );
  });

  it('rejects extra fields such as arbitrary arguments', () => {
    const job = {
      kind: 'upgrade',
      jobId,
      packageId: 'Git.Git',
      targetVersion: '2.45.1',
      source: 'winget',
      args: '--force',
    };
    expect(agentJobSchema.safeParse(job).success).toBe(false);
  });

  it('rejects other package sources', () => {
    const job = {
      kind: 'upgrade',
      jobId,
      packageId: 'Git.Git',
      targetVersion: '2.45.1',
      source: 'https://evil.example',
    };
    expect(agentJobSchema.safeParse(job).success).toBe(false);
  });

  it('rejects an injected package id', () => {
    const job = {
      kind: 'upgrade',
      jobId,
      packageId: 'Git.Git && calc',
      targetVersion: '2.45.1',
      source: 'winget',
    };
    expect(agentJobSchema.safeParse(job).success).toBe(false);
  });
});
