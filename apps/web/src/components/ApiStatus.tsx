'use client';

import { useEffect, useState } from 'react';
import { healthResponseSchema } from '@updatepilot/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const POLL_MS = 30_000;

type State = { status: 'checking' } | { status: 'online'; version: string } | { status: 'offline' };

/** Shows whether the web app can reach the API. Also proves CORS and the shared schemas work. */
export function ApiStatus() {
  const [state, setState] = useState<State>({ status: 'checking' });

  useEffect(() => {
    const controller = new AbortController();

    async function check() {
      try {
        const res = await fetch(`${API_URL}/api/v1/health`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = healthResponseSchema.parse(await res.json());
        setState({ status: 'online', version: body.version });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'offline' });
      }
    }

    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  const label =
    state.status === 'online'
      ? `API online (v${state.version})`
      : state.status === 'offline'
        ? 'API unreachable'
        : 'Checking API';
  const tone =
    state.status === 'online' ? 'success' : state.status === 'offline' ? 'danger' : 'neutral';

  return (
    <p className="api-status" role="status">
      <span className={`badge badge-${tone}`}>{label}</span>
    </p>
  );
}
