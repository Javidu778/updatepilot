'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { API_URL } from '@/lib/api/config';
import { useAuth } from '@/lib/auth/session';

/**
 * Shows the app only to a signed-in user.
 *
 * This decides what the browser SHOWS. It is not the security boundary: the API refuses
 * every request without a valid session, whatever this component does.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (session.status !== 'anonymous') return;

    // After pressing "Sign out" go to a clean sign-in page. Otherwise come back to this page after signing in.
    if (session.reason === 'signed-out') {
      router.replace('/login');
      return;
    }
    const here = `${window.location.pathname}${window.location.search}`;
    const params = new URLSearchParams();
    if (here !== '/') params.set('next', here);
    if (session.reason === 'expired') params.set('reason', 'expired');
    const query = params.toString();
    router.replace(query ? `/login?${query}` : '/login');
  }, [session, router]);

  if (session.status === 'authenticated') return <>{children}</>;

  if (session.status === 'unavailable') {
    return (
      <main className="session-screen">
        <div className="card session-card" role="alert">
          <h1>We can&apos;t reach the server</h1>
          <p>
            UpdatePilot could not contact the API at <code>{API_URL}</code>. Make sure the API is
            running, then try again.
          </p>
          <button type="button" className="btn btn-primary" onClick={retry}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="session-screen">
      <p role="status">
        {session.status === 'anonymous' ? 'Redirecting to sign in…' : 'Checking your session…'}
      </p>
    </main>
  );
}
