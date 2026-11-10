import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/lib/auth/session';
import { apiError, authBody, createFakeApi } from '@/test/fake-api';
import { AuthForm } from './AuthForm';

const nav = vi.hoisted(() => ({ router: { replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => nav.router }));

const ANONYMOUS = {
  'GET /api/v1/auth/me': apiError(401, 'UNAUTHENTICATED', 'Authentication required'),
};
const GOOD_PASSWORD = 'Correct-Horse-Battery-9';

function renderForm(mode: 'login' | 'register', routes: Parameters<typeof createFakeApi>[0] = {}) {
  const fake = createFakeApi({ ...ANONYMOUS, ...routes });
  render(
    <AuthProvider baseUrl="http://api.test" fetchImpl={fake.fetchImpl}>
      <AuthForm mode={mode} />
    </AuthProvider>,
  );
  return fake;
}

const emailInput = () => screen.getByLabelText('Email') as HTMLInputElement;
const passwordInput = () => screen.getByLabelText('Password') as HTMLInputElement;

async function fill(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  if (email) await user.type(emailInput(), email);
  if (password) await user.type(passwordInput(), password);
}

beforeEach(() => {
  nav.router.replace.mockReset();
  window.history.pushState({}, '', '/login');
});

describe('sign in form', () => {
  it('has labelled fields, sensible autocomplete hints and no errors to start with', () => {
    renderForm('login');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(emailInput().type).toBe('email');
    expect(emailInput().autocomplete).toBe('username');
    expect(passwordInput().type).toBe('password');
    expect(passwordInput().autocomplete).toBe('current-password');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows what is missing, marks the fields invalid and focuses the first one, without calling the API', async () => {
    const user = userEvent.setup();
    const fake = renderForm('login');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter your email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(passwordInput().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(emailInput());
    expect(fake.callsTo('POST /api/v1/auth/login')).toHaveLength(0);
  });

  it('links each error to its field for screen readers', async () => {
    const user = userEvent.setup();
    renderForm('login');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const errorId = emailInput().getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)?.textContent).toBe('Enter your email address.');
  });

  it('clears a field error as soon as the person starts correcting it', async () => {
    const user = userEvent.setup();
    renderForm('login');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.type(emailInput(), 'a');
    expect(screen.queryByText('Enter your email address.')).toBeNull();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
  });

  it('rejects an address that is not an email', async () => {
    const user = userEvent.setup();
    renderForm('login');
    await fill(user, 'not-an-email', 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('signs in: sends the trimmed email and the password with the cookie, then moves on', async () => {
    const user = userEvent.setup();
    const fake = renderForm('login', { 'POST /api/v1/auth/login': { json: authBody() } });
    await fill(user, '  demo@updatepilot.local ', GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    const [call] = fake.callsTo('POST /api/v1/auth/login');
    expect(call?.body).toEqual({ email: 'demo@updatepilot.local', password: GOOD_PASSWORD });
    expect(call?.credentials).toBe('include');
    expect(call?.headers.get('Content-Type')).toBe('application/json');
  });

  it('goes back to the page the person wanted', async () => {
    window.history.pushState({}, '', '/login?next=%2Fapplications%3Fpage%3D2');
    const user = userEvent.setup();
    renderForm('login', { 'POST /api/v1/auth/login': { json: authBody() } });
    await fill(user, 'demo@updatepilot.local', GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/applications?page=2'));
  });

  it.each([
    ['https%3A%2F%2Fevil.example%2Fphish'],
    ['%2F%2Fevil.example'],
    ['javascript%3Aalert(1)'],
    ['%2Flogin'],
  ])('ignores an unsafe next value (%s) and goes to the home page', async (next) => {
    window.history.pushState({}, '', `/login?next=${next}`);
    const user = userEvent.setup();
    renderForm('login', { 'POST /api/v1/auth/login': { json: authBody() } });
    await fill(user, 'demo@updatepilot.local', GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
  });

  it('shows one message for wrong credentials, keeps the email, clears the password and focuses the message', async () => {
    const user = userEvent.setup();
    renderForm('login', {
      'POST /api/v1/auth/login': apiError(401, 'UNAUTHENTICATED', 'Invalid email or password'),
    });
    await fill(user, 'demo@updatepilot.local', 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Incorrect email or password.');
    expect(emailInput().value).toBe('demo@updatepilot.local');
    expect(passwordInput().value).toBe('');
    expect(document.activeElement).toBe(alert);
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('tells the person to wait after too many attempts', async () => {
    const user = userEvent.setup();
    renderForm('login', {
      'POST /api/v1/auth/login': {
        ...apiError(429, 'RATE_LIMITED', 'Too many requests'),
        headers: { 'Retry-After': '600' },
      },
    });
    await fill(user, 'demo@updatepilot.local', 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many attempts. Try again in about 10 minutes.',
    );
  });

  it('explains when the server cannot be reached', async () => {
    const user = userEvent.setup();
    renderForm('login', { 'POST /api/v1/auth/login': 'network-error' });
    await fill(user, 'demo@updatepilot.local', 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/can't reach the server/i);
  });

  it('sends only one request when the button is pressed twice, and says it is working', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = renderForm('login', {
      'POST /api/v1/auth/login': async () => {
        await slow;
        return { json: authBody() };
      },
    });
    await fill(user, 'demo@updatepilot.local', GOOD_PASSWORD);
    const button = screen.getByRole('button', { name: 'Sign in' });
    await user.dblClick(button);

    expect(
      (screen.getByRole('button', { name: 'Signing in…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    release?.();
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalled());
    expect(fake.callsTo('POST /api/v1/auth/login')).toHaveLength(1);
  });

  it('shows and hides the password on request', async () => {
    const user = userEvent.setup();
    renderForm('login');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await user.click(toggle);
    expect(passwordInput().type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput().type).toBe('password');
  });

  it('explains why the person was sent here when the session ended', () => {
    window.history.pushState({}, '', '/login?reason=expired');
    renderForm('login');
    return waitFor(() =>
      expect(screen.getByText('Your session ended. Sign in again to continue.')).toBeTruthy(),
    );
  });

  it('says the server is not answering, but still lets the person try', async () => {
    renderForm('login', { 'GET /api/v1/auth/me': 'network-error' });
    expect((await screen.findByText(/server is not answering/i)).getAttribute('role')).toBe(
      'status',
    );
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('skips the form for someone who is already signed in', async () => {
    renderForm('login', { 'GET /api/v1/auth/me': { json: authBody() } });
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(screen.getByText(/You are signed in/)).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('links to registration and keeps the page the person wanted', async () => {
    window.history.pushState({}, '', '/login?next=%2Fupdates');
    renderForm('login');
    const link = await screen.findByRole('link', { name: 'Create an account' });
    await waitFor(() => expect(link.getAttribute('href')).toBe('/register?next=%2Fupdates'));
  });

  it('never puts an unsafe next value into the link', async () => {
    window.history.pushState({}, '', '/login?next=https%3A%2F%2Fevil.example');
    renderForm('login');
    const link = await screen.findByRole('link', { name: 'Create an account' });
    expect(link.getAttribute('href')).toBe('/register');
  });
});

describe('registration form', () => {
  it('explains the password rule and asks the browser for a new password', () => {
    renderForm('register');
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeTruthy();
    expect(screen.getByText(/At least 12 characters/)).toBeTruthy();
    expect(passwordInput().autocomplete).toBe('new-password');
    expect(emailInput().autocomplete).toBe('email');
  });

  it('rejects a short password before calling the API', async () => {
    const user = userEvent.setup();
    const fake = renderForm('register');
    await fill(user, 'new.user@example.com', 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const message = screen.getAllByText('Use at least 12 characters.');
    expect(message.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(passwordInput());
    expect(fake.callsTo('POST /api/v1/auth/register')).toHaveLength(0);
  });

  it('creates the account and moves on', async () => {
    const user = userEvent.setup();
    const fake = renderForm('register', {
      'POST /api/v1/auth/register': { status: 201, json: authBody() },
    });
    await fill(user, 'new.user@example.com', GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith('/'));
    expect(fake.callsTo('POST /api/v1/auth/register')[0]?.body).toEqual({
      email: 'new.user@example.com',
      password: GOOD_PASSWORD,
    });
  });

  it('shows the server message next to the email when it cannot be used, and focuses it', async () => {
    const user = userEvent.setup();
    renderForm('register', {
      'POST /api/v1/auth/register': apiError(400, 'VALIDATION_ERROR', 'Registration failed', [
        { path: 'email', message: 'This email cannot be used' },
      ]),
    });
    await fill(user, 'taken@example.com', GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const message = await screen.findByText('This email cannot be used');
    expect(emailInput().getAttribute('aria-describedby')).toContain(message.id);
    expect(document.activeElement).toBe(emailInput());
    expect(passwordInput().value).toBe('');
  });

  it('links to sign in', async () => {
    renderForm('register');
    expect((await screen.findByRole('link', { name: 'Sign in' })).getAttribute('href')).toBe(
      '/login',
    );
  });
});
