'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/session';

/** Who is signed in, and a way to sign out. Sits in the top bar. */
export function UserMenu() {
  const { session, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.status !== 'authenticated') return null;

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await logout(); // the app guard then sends the browser to the sign-in page
    } catch {
      setError('Could not sign out. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="user-menu">
      <span className="user-email" title={session.user.email}>
        {session.user.email}
      </span>
      <button type="button" className="btn btn-ghost" onClick={signOut} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {error ? (
        <span role="alert" className="user-menu-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
