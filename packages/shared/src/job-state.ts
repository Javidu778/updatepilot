import type { JobKind, JobState, VerificationResult } from './enums';

/**
 * Allowed job state transitions. See docs/job-states.md.
 *
 * Rules:
 *  - A transition not listed here is invalid and must be rejected (HTTP 409).
 *  - Terminal states never change.
 *  - The API applies transitions with a compare-and-set in the database
 *    (UPDATE ... WHERE id = ? AND state = <expected>), so two requests
 *    cannot both win.
 */

type Table = Record<JobState, readonly JobState[]>;

const SCAN_TRANSITIONS: Table = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'INTERRUPTED'],
  VERIFYING: [],
  SUCCEEDED: [],
  FAILED: [],
  RESTART_REQUIRED: [],
  CANCELLED: [],
  INTERRUPTED: [],
  VERIFICATION_FAILED: [],
};

const UPDATE_TRANSITIONS: Table = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['VERIFYING', 'RESTART_REQUIRED', 'FAILED', 'INTERRUPTED'],
  VERIFYING: ['SUCCEEDED', 'VERIFICATION_FAILED', 'INTERRUPTED'],
  // After a restart, the agent rescans and the job moves to VERIFYING again.
  RESTART_REQUIRED: ['VERIFYING', 'INTERRUPTED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  INTERRUPTED: [],
  VERIFICATION_FAILED: [],
};

const TABLES: Record<JobKind, Table> = {
  scan: SCAN_TRANSITIONS,
  update: UPDATE_TRANSITIONS,
};

export function allowedTransitions(kind: JobKind, from: JobState): readonly JobState[] {
  return TABLES[kind][from];
}

export function canTransition(kind: JobKind, from: JobState, to: JobState): boolean {
  return TABLES[kind][from].includes(to);
}

export function isTerminal(kind: JobKind, state: JobState): boolean {
  return TABLES[kind][state].length === 0;
}

/** States in which an update job still blocks a new update for the same application. */
export const ACTIVE_UPDATE_STATES: readonly JobState[] = [
  'QUEUED',
  'RUNNING',
  'VERIFYING',
  'RESTART_REQUIRED',
];

export class InvalidTransitionError extends Error {
  constructor(
    public readonly kind: JobKind,
    public readonly from: JobState,
    public readonly to: JobState,
  ) {
    super(`Invalid ${kind} job transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(kind: JobKind, from: JobState, to: JobState): void {
  if (!canTransition(kind, from, to)) {
    throw new InvalidTransitionError(kind, from, to);
  }
}

// ---------------------------------------------------------------------------
// Deciding the outcome of an update from what the agent reports
// ---------------------------------------------------------------------------

export type UpdateOutcomeInput = {
  /** Exit code of the package manager process. */
  exitCode: number;
  /** True when the agent saw a restart-required exit code or flag. */
  restartRequired: boolean;
  /** Version found by the agent's rescan after the update, or null if it could not be read. */
  installedVersionAfter: string | null;
  /** The version the user confirmed. */
  targetVersion: string;
};

export type UpdateOutcome = {
  state: Extract<JobState, 'SUCCEEDED' | 'RESTART_REQUIRED' | 'FAILED' | 'VERIFICATION_FAILED'>;
  verification: VerificationResult;
};

/**
 * Success is reported ONLY when the rescan shows the target version.
 * Equality is used for now; Week 4 replaces it with the version comparison
 * module so that a newer version than the target also counts as verified.
 */
export function decideUpdateOutcome(input: UpdateOutcomeInput): UpdateOutcome {
  const versionMatches =
    input.installedVersionAfter !== null && input.installedVersionAfter === input.targetVersion;

  if (versionMatches && (input.exitCode === 0 || input.restartRequired)) {
    return { state: 'SUCCEEDED', verification: 'VERIFIED' };
  }
  if (input.restartRequired) {
    return { state: 'RESTART_REQUIRED', verification: 'NOT_RUN' };
  }
  if (input.exitCode !== 0) {
    return { state: 'FAILED', verification: 'NOT_RUN' };
  }
  // The installer reported success, but the rescan does not show the target version.
  return { state: 'VERIFICATION_FAILED', verification: 'FAILED' };
}
