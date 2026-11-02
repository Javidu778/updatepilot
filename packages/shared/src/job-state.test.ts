import { describe, expect, it } from 'vitest';
import { JOB_STATES, type JobState } from './enums';
import {
  InvalidTransitionError,
  allowedTransitions,
  assertTransition,
  canTransition,
  decideUpdateOutcome,
  isTerminal,
} from './job-state';

describe('update job transitions', () => {
  it('follows the happy path', () => {
    expect(canTransition('update', 'QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('update', 'RUNNING', 'VERIFYING')).toBe(true);
    expect(canTransition('update', 'VERIFYING', 'SUCCEEDED')).toBe(true);
  });

  it('never reports success without verification', () => {
    expect(canTransition('update', 'RUNNING', 'SUCCEEDED')).toBe(false);
    expect(canTransition('update', 'QUEUED', 'SUCCEEDED')).toBe(false);
  });

  it('allows verification after a restart', () => {
    expect(canTransition('update', 'RUNNING', 'RESTART_REQUIRED')).toBe(true);
    expect(canTransition('update', 'RESTART_REQUIRED', 'VERIFYING')).toBe(true);
  });

  it('only allows cancelling a job that has not started', () => {
    expect(canTransition('update', 'QUEUED', 'CANCELLED')).toBe(true);
    expect(canTransition('update', 'RUNNING', 'CANCELLED')).toBe(false);
  });

  it('allows interruption while running or verifying', () => {
    expect(canTransition('update', 'RUNNING', 'INTERRUPTED')).toBe(true);
    expect(canTransition('update', 'VERIFYING', 'INTERRUPTED')).toBe(true);
  });

  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'VERIFICATION_FAILED'] as JobState[])(
    '%s is terminal',
    (state) => {
      expect(isTerminal('update', state)).toBe(true);
      expect(allowedTransitions('update', state)).toHaveLength(0);
    },
  );

  it('does not let a terminal job change state', () => {
    for (const to of JOB_STATES) {
      expect(canTransition('update', 'SUCCEEDED', to)).toBe(false);
    }
  });

  it('throws a typed error for an invalid transition', () => {
    expect(() => assertTransition('update', 'SUCCEEDED', 'RUNNING')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertTransition('update', 'QUEUED', 'RUNNING')).not.toThrow();
  });
});

describe('scan job transitions', () => {
  it('goes from queued to running to succeeded', () => {
    expect(canTransition('scan', 'QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('scan', 'RUNNING', 'SUCCEEDED')).toBe(true);
  });

  it('has no verifying or restart states', () => {
    expect(canTransition('scan', 'RUNNING', 'VERIFYING')).toBe(false);
    expect(canTransition('scan', 'RUNNING', 'RESTART_REQUIRED')).toBe(false);
  });
});

describe('decideUpdateOutcome', () => {
  const base = {
    exitCode: 0,
    restartRequired: false,
    installedVersionAfter: '24.08',
    targetVersion: '24.08',
  };

  it('succeeds only when the rescan shows the target version', () => {
    expect(decideUpdateOutcome(base)).toEqual({
      state: 'SUCCEEDED',
      verification: 'VERIFIED',
    });
  });

  it('fails verification when the installer succeeded but the version did not change', () => {
    expect(decideUpdateOutcome({ ...base, installedVersionAfter: '23.01' })).toEqual({
      state: 'VERIFICATION_FAILED',
      verification: 'FAILED',
    });
  });

  it('fails verification when the version could not be read', () => {
    expect(decideUpdateOutcome({ ...base, installedVersionAfter: null }).state).toBe(
      'VERIFICATION_FAILED',
    );
  });

  it('reports failure for a non-zero exit code', () => {
    expect(
      decideUpdateOutcome({
        ...base,
        exitCode: 1603,
        installedVersionAfter: '23.01',
      }),
    ).toEqual({
      state: 'FAILED',
      verification: 'NOT_RUN',
    });
  });

  it('never reports success for a non-zero exit code with an unchanged version', () => {
    expect(
      decideUpdateOutcome({
        ...base,
        exitCode: 1,
        installedVersionAfter: '23.01',
      }).state,
    ).not.toBe('SUCCEEDED');
  });

  it('asks for a restart when one is required and the version is not yet visible', () => {
    expect(
      decideUpdateOutcome({
        ...base,
        exitCode: 3010,
        restartRequired: true,
        installedVersionAfter: '23.01',
      }),
    ).toEqual({
      state: 'RESTART_REQUIRED',
      verification: 'NOT_RUN',
    });
  });

  it('verifies success when a restart was flagged but the new version is already visible', () => {
    expect(decideUpdateOutcome({ ...base, exitCode: 3010, restartRequired: true }).state).toBe(
      'SUCCEEDED',
    );
  });
});
