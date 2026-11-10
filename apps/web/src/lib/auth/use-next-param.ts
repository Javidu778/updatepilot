'use client';

import { useEffect, useState } from 'react';
import { safeNextPath } from './safe-redirect';

/** The raw ?next= value from the address bar, read in the browser only (no Suspense needed). */
export function readNextParam(): string | null {
  return new URLSearchParams(window.location.search).get('next');
}

/** The checked destination after sign-in. */
export function readSafeNext(): string {
  return safeNextPath(readNextParam());
}

/** The ?next= value for links between the sign-in and register pages, once the page has loaded. */
export function useNextQuery(): string {
  const [query, setQuery] = useState('');
  useEffect(() => {
    const next = readNextParam();
    const safe = safeNextPath(next, '');
    setQuery(safe ? `?next=${encodeURIComponent(safe)}` : '');
  }, []);
  return query;
}
