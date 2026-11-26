import { useState } from 'react';
import { describeFailure } from '@/lib/api/describe-failure';
import { useAuth } from '@/lib/auth/session';

type ReleaseResult = {
  release: { version: string } | null;
  reason: 'ok' | 'NO_SOURCE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_RESPONSE';
};

/** Why there is no release information, in words a person can act on. */
const REASON_TEXT: Record<ReleaseResult['reason'], string> = {
  ok: '',
  NO_SOURCE: 'No release source is known for this package.',
  NOT_FOUND: 'The release page for this package could not be found.',
  RATE_LIMITED: 'The release feed is rate limiting requests. Try again in a few minutes.',
  UNAVAILABLE: 'The release feed could not be reached. Check the connection and try again.',
  BAD_RESPONSE: 'The release feed answered with something this page cannot read.',
};

/**
 * Asks the server to fetch release notes for one application.
 *
 * Explicit rather than automatic on purpose: a page load must never wait on GitHub, and a failure
 * here must read as "not available", never as a broken application page.
 */
export function ReleaseRefresh({
  applicationId,
  onRefreshed,
}: {
  applicationId: string;
  onRefreshed: () => void;
}) {
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.post<ReleaseResult>(`/api/v1/applications/${applicationId}/release`);
      if (result.release) {
        onRefreshed();
        return;
      }
      setMessage(REASON_TEXT[result.reason] || REASON_TEXT.UNAVAILABLE);
    } catch (error) {
      setMessage(describeFailure(error, 'release notes'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="release-refresh">
      <button type="button" className="btn btn-ghost" onClick={check} disabled={busy}>
        {busy ? 'Checking…' : 'Check for release notes'}
      </button>
      {message ? (
        <p className="muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
