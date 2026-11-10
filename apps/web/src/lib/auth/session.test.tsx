import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { UserMenu } from '@/components/UserMenu';
import { apiError, authBody, createFakeApi } from '@/test/fake-api';
import { AuthProvider, useAuth } from './session';

// next/navigation needs a real Next.js runtime. The router is replaced by a stable fake.
const nav = vi.hoisted(() => ({ router: { replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router }));

const SIGNED_IN = { 'GET /api/v1/auth/me': { json: authBody('csrf-token-1') } };

/** A button that makes an API call the way a real page will. */
function Probe() {
  const { api } = useAuth();
  return (
    <button
      type="button"
      onClick={() => void api.get('/api/v1/applications').catch(() => undefined)}
    >
      Load applications
    </button>
  );
}

function renderApp(fake: ReturnType<typeof createFakeApi>) {
  return render(
    <AuthProvider baseUrl="http://api.test" fetchImpl={fake.fetchImpl}>
      <RequireAuth>
        <p>Secret page</p>
        <UserMenu />
        <Probe />
      </RequireAuth>
    </AuthProvider>,
  );
}

beforeEach(() => {
  nav.router.replace.mockReset();
  window.history.pushState({}, '', '/');
});

describe('signed-in visitor', () => {
  it('sees a status message while the session is checked, then the app', async () => {
    renderApp(createFakeApi(SIGNED_IN));
    expect(screen.getByRole('status').textContent).toBe('Checking your session…');
    expect(await screen.findByText('Secret page')).toBeTruthy();
    expect(screen.getByText('demo@updatepilot.local')).toBeTruthy();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it('asks the API with the session cookie', async () => {
    const fake = createFakeApi(SIGNED_IN);
    renderApp(fake);
    await screen.findByText('Secret page');
    const [call] = fake.callsTo('GET /api/v1/auth/me');
    expect(call?.credentials).toBe('include');
  });

  it('keeps the CSRF token in memory only', async () => {
    renderApp(createFakeApi(SIGNED_IN));
    await screen.findByText('Secret page');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('csrf');
  });
});

describe('visitor who is not signed in', () => {
  it('is sent to sign in, and the page they wanted is remembered', async () => {
    window.history.pushState({}, '', '/applications?page=2');
    renderApp(
      createFakeApi({
        'GET /api/v1/auth/me': apiError(401, 'UNAUTHENTICATED', 'Authentication required'),
      }),
    );

    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith('/login?next=%2Fapplications%3Fpage%3D2'),
    );
    expect(screen.queryByText('Secret page')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Redirecting to sign in…');
  });

  it('is not given a next value for the home page', async () => {
    renderApp(
      createFakeApi({
        'GET /api/v1/auth/me': apiError(401, 'UNAUTHENTICATED', 'Authentication required'),
      }),
    );
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/login'));
  });
});

describe('server not reachable', () => {
  it('explains it and offers to try again', async () => {
    const user = userEvent.setup();
    renderApp(createFakeApi({ 'GET /api/v1/auth/me': ['network-error', { json: authBody() }] }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("We can't reach the server");
    expect(screen.queryByText('Secret page')).toBeNull();
    expect(nav.router.replace).not.toHaveBeenCalled(); // not signed out, just unknown

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Secret page')).toBeTruthy();
  });

  it('treats a server error the same way', async () => {
    renderApp(
      createFakeApi({
        'GET /api/v1/auth/me': apiError(500, 'INTERNAL_ERROR', 'Something went wrong'),
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain("We can't reach the server");
  });
});

describe('signing out', () => {
  it('sends the CSRF token, then goes to a clean sign-in page', async () => {
    const user = userEvent.setup();
    const fake = createFakeApi({ ...SIGNED_IN, 'POST /api/v1/auth/logout': { status: 204 } });
    window.history.pushState({}, '', '/updates');
    renderApp(fake);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    const [call] = fake.callsTo('POST /api/v1/auth/logout');
    expect(call?.headers.get('X-CSRF-Token')).toBe('csrf-token-1');
    expect(call?.credentials).toBe('include');
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/login')); // no next after signing out
    expect(screen.queryByText('Secret page')).toBeNull();
  });

  it('counts an already-ended session as signed out', async () => {
    const user = userEvent.setup();
    renderApp(
      createFakeApi({
        ...SIGNED_IN,
        'POST /api/v1/auth/logout': apiError(401, 'UNAUTHENTICATED', 'Authentication required'),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/login'));
  });

  it('stays signed in and says so when sign-out fails', async () => {
    const user = userEvent.setup();
    renderApp(
      createFakeApi({
        ...SIGNED_IN,
        'POST /api/v1/auth/logout': apiError(403, 'FORBIDDEN', 'Missing or invalid CSRF token'),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not sign out. Try again.');
    expect(screen.getByText('Secret page')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('session that ends while the app is open', () => {
  it('sends the person to sign in with an explanation and the page they were on', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/updates');
    renderApp(
      createFakeApi({
        ...SIGNED_IN,
        'GET /api/v1/applications': apiError(401, 'UNAUTHENTICATED', 'Authentication required'),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Load applications' }));
    await waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith('/login?next=%2Fupdates&reason=expired'),
    );
    expect(screen.queryByText('Secret page')).toBeNull();
  });

  it('does not treat other failures as a lost session', async () => {
    const user = userEvent.setup();
    renderApp(
      createFakeApi({
        ...SIGNED_IN,
        'GET /api/v1/applications': apiError(500, 'INTERNAL_ERROR', 'Something went wrong'),
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Load applications' }));
    await waitFor(() => expect(screen.getByText('Secret page')).toBeTruthy());
    expect(nav.router.replace).not.toHaveBeenCalled();
  });
});

describe('useAuth', () => {
  it('refuses to work outside the provider, so a missing provider is caught early', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/inside <AuthProvider>/);
    quiet.mockRestore();
  });
});
