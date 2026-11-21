import { describe, expect, it } from 'vitest';
import { decideUpdateOutcome } from './finalize';

const base = {
  exitCode: 0,
  restartRequired: false,
  installedVersionAfter: '24.08',
  targetVersion: '24.08',
};

describe('decideUpdateOutcome', () => {
  it('succeeds only when the rescan shows the target version', () => {
    expect(decideUpdateOutcome(base)).toEqual({
      state: 'SUCCEEDED',
      verification: 'VERIFIED',
      reason: null,
    });
  });

  it('accepts an equivalent spelling of the target version', () => {
    expect(
      decideUpdateOutcome({ ...base, installedVersionAfter: '24.8', targetVersion: '24.08' }).state,
    ).toBe('SUCCEEDED');
    expect(
      decideUpdateOutcome({
        ...base,
        installedVersionAfter: '7.2.5 (51704)',
        targetVersion: '7.2.5',
      }).state,
    ).toBe('SUCCEEDED');
  });

  it('never reports success from an exit code alone', () => {
    const outcome = decideUpdateOutcome({ ...base, installedVersionAfter: '23.01' });
    expect(outcome.state).toBe('VERIFICATION_FAILED');
    expect(outcome.verification).toBe('FAILED');
    expect(outcome.reason).toContain('23.01');
    expect(outcome.reason).toContain('24.08');
  });

  it('fails when the installer exits non-zero, even if the version looks right', () => {
    const outcome = decideUpdateOutcome({ ...base, exitCode: 1603 });
    expect(outcome.state).toBe('FAILED');
    expect(outcome.verification).toBe('NOT_RUN');
    expect(outcome.reason).toContain('1603');
  });

  it('stops at RESTART_REQUIRED before claiming anything about the version', () => {
    const outcome = decideUpdateOutcome({
      ...base,
      restartRequired: true,
      installedVersionAfter: null,
    });
    expect(outcome.state).toBe('RESTART_REQUIRED');
    expect(outcome.verification).toBe('NOT_RUN');
    expect(outcome.reason).toContain('restart');
  });

  it('cannot verify when the version could not be read at all', () => {
    const outcome = decideUpdateOutcome({ ...base, installedVersionAfter: null });
    expect(outcome.state).toBe('VERIFICATION_FAILED');
    expect(outcome.verification).toBe('FAILED');
  });

  it('cannot verify when the reported version is unreadable', () => {
    const outcome = decideUpdateOutcome({ ...base, installedVersionAfter: 'Unknown' });
    expect(outcome.state).toBe('VERIFICATION_FAILED');
    expect(outcome.reason).toContain('compared');
  });
});
