'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The three states every page that reads from the API has to show.
 * There is no fourth "stale" state on purpose: a refetch shows the loading state again,
 * so the screen never mixes old data with a new filter.
 */
export type Resource<T> =
  { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T };

export type ResourceResult<T> = {
  resource: Resource<T>;
  /** Runs the request again, for a "Try again" button. */
  reload: () => void;
};

/**
 * Loads one API resource and tracks loading, error and ready.
 *
 * `key` decides WHEN to load: the request runs whenever the key changes, and the key must
 * describe everything the request depends on (path plus query). `load` may be a new function
 * every render without causing another request; only `key` does that.
 *
 * The request is cancelled with an AbortSignal when the key changes or the component unmounts,
 * so a slow answer for an old filter can never overwrite a newer one.
 */
export function useApiResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): ResourceResult<T> {
  const [resource, setResource] = useState<Resource<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    setResource({ status: 'loading' });

    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResource({ status: 'ready', data });
      },
      (error: unknown) => {
        // A cancelled request is not a failure; the replacement request is already running.
        if (!controller.signal.aborted) setResource({ status: 'error', error });
      },
    );

    return () => controller.abort();
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { resource, reload };
}
