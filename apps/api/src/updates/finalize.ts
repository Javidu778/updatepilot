import { isSameVersion, type JobState, type VerificationResult } from '@updatepilot/shared';

/**
 * The server decides how an update ended. The agent only reports facts: exit code, whether the
 * installer asked for a restart, and the version it found when it rescanned.
 *
 * The rule that matters: SUCCEEDED is never taken from an exit code alone. It requires a rescan
 * that shows the target version, because an installer can exit 0 and change nothing.
 */
export type UpdateOutcomeInput = {
  exitCode: number;
  restartRequired: boolean;
  installedVersionAfter: string | null;
  targetVersion: string;
};

export type UpdateOutcome = {
  state: JobState;
  verification: VerificationResult;
  /** Plain-language reason stored as errorSummary. Null on success. */
  reason: string | null;
};

export function decideUpdateOutcome(input: UpdateOutcomeInput): UpdateOutcome {
  // Restart first: 3010 and 1641 are success codes that also mean "restart needed", so checking the
  // exit code first would report a successful install as FAILED.
  if (input.restartRequired) {
    return {
      state: 'RESTART_REQUIRED',
      verification: 'NOT_RUN',
      reason: 'The installer asked for a restart before the version can be checked.',
    };
  }

  if (input.exitCode !== 0) {
    return {
      state: 'FAILED',
      verification: 'NOT_RUN',
      reason: `WinGet exited with code ${input.exitCode}.`,
    };
  }

  if (!input.installedVersionAfter) {
    return {
      state: 'VERIFICATION_FAILED',
      verification: 'FAILED',
      reason: 'The version could not be read after the update.',
    };
  }

  const same = isSameVersion(input.installedVersionAfter, input.targetVersion);
  if (same === true) return { state: 'SUCCEEDED', verification: 'VERIFIED', reason: null };

  if (same === null) {
    return {
      state: 'VERIFICATION_FAILED',
      verification: 'FAILED',
      reason: 'The version after the update could not be compared with the target version.',
    };
  }

  return {
    state: 'VERIFICATION_FAILED',
    verification: 'FAILED',
    reason: `The installed version is ${input.installedVersionAfter}, not the expected ${input.targetVersion}.`,
  };
}
