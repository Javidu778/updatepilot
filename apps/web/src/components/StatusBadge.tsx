import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  CircleHelp,
  Clock,
  Loader,
  MinusCircle,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import type { ConnectionState, JobState, MatchStatus, UpdateStatus } from '@updatepilot/shared';
import type { ReactNode } from 'react';

/**
 * The one badge mapping for the whole app, from docs/design-system.md section 6.
 * Every badge carries an icon, a text label and a colour token: colour is never the only signal.
 */

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type BadgeDefinition = { label: string; tone: BadgeTone; icon: LucideIcon };

const UPDATE_STATUS: Record<UpdateStatus, BadgeDefinition> = {
  UP_TO_DATE: { label: 'Up to date', tone: 'success', icon: CheckCircle2 },
  UPDATE_AVAILABLE: { label: 'Update available', tone: 'warning', icon: ArrowUpCircle },
  UNKNOWN: { label: 'Unknown', tone: 'neutral', icon: CircleHelp },
};

const MATCH_STATUS: Record<MatchStatus, BadgeDefinition> = {
  MATCHED: { label: 'Matched', tone: 'success', icon: CheckCircle2 },
  UNMATCHED: { label: 'Unmatched', tone: 'neutral', icon: MinusCircle },
  UNSUPPORTED: { label: 'Unsupported', tone: 'neutral', icon: MinusCircle },
  UNKNOWN: { label: 'Unknown', tone: 'neutral', icon: CircleHelp },
};

const JOB_STATE: Record<JobState, BadgeDefinition> = {
  QUEUED: { label: 'Queued', tone: 'info', icon: Clock },
  RUNNING: { label: 'Running', tone: 'info', icon: Loader },
  VERIFYING: { label: 'Verifying', tone: 'info', icon: Loader },
  SUCCEEDED: { label: 'Succeeded', tone: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Failed', tone: 'danger', icon: AlertCircle },
  RESTART_REQUIRED: { label: 'Restart required', tone: 'warning', icon: RotateCcw },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: MinusCircle },
  INTERRUPTED: { label: 'Interrupted', tone: 'warning', icon: AlertCircle },
  VERIFICATION_FAILED: { label: 'Verification failed', tone: 'danger', icon: AlertCircle },
};

function Badge({
  tone,
  icon: Icon,
  children,
}: {
  tone: BadgeTone;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <Icon aria-hidden="true" size={14} className="badge-icon" />
      {children}
    </span>
  );
}

export function UpdateStatusBadge({ value }: { value: UpdateStatus }) {
  const definition = UPDATE_STATUS[value];
  return <Badge {...definition}>{definition.label}</Badge>;
}

export function MatchStatusBadge({ value }: { value: MatchStatus }) {
  const definition = MATCH_STATUS[value];
  return <Badge {...definition}>{definition.label}</Badge>;
}

export function JobStateBadge({ value }: { value: JobState }) {
  const definition = JOB_STATE[value];
  return <Badge {...definition}>{definition.label}</Badge>;
}

/** Label and tone for an update status, for places that need text without the badge. */
export function updateStatusLabel(value: UpdateStatus): string {
  return UPDATE_STATUS[value].label;
}

const CONNECTION: Record<ConnectionState, BadgeDefinition> = {
  connected: { label: 'Connected', tone: 'success', icon: CheckCircle2 },
  stale: { label: 'Stale', tone: 'warning', icon: Clock },
  disconnected: { label: 'Disconnected', tone: 'danger', icon: AlertCircle },
  pending: { label: 'Not paired', tone: 'neutral', icon: CircleHelp },
  revoked: { label: 'Revoked', tone: 'danger', icon: MinusCircle },
};

export function ConnectionBadge({ value }: { value: ConnectionState }) {
  const definition = CONNECTION[value];
  return <Badge {...definition}>{definition.label}</Badge>;
}
