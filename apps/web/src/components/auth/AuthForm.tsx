'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { describeAuthError } from '@/lib/auth/describe-error';
import { useAuth } from '@/lib/auth/session';
import { readSafeNext, useNextQuery } from '@/lib/auth/use-next-param';
import { validateCredentials, type CredentialErrors } from '@/lib/auth/validate-credentials';
import { PasswordField, TextField } from './fields';

type Mode = 'login' | 'register';

const COPY = {
  login: {
    title: 'Sign in',
    submit: 'Sign in',
    busy: 'Signing in…',
    emailAutocomplete: 'username',
    passwordAutocomplete: 'current-password',
    hint: undefined,
    switchText: 'New to UpdatePilot?',
    switchLink: 'Create an account',
    switchHref: '/register',
  },
  register: {
    title: 'Create your account',
    submit: 'Create account',
    busy: 'Creating account…',
    emailAutocomplete: 'email',
    passwordAutocomplete: 'new-password',
    hint: 'At least 12 characters. A long passphrase works well.',
    switchText: 'Already have an account?',
    switchLink: 'Sign in',
    switchHref: '/login',
  },
} as const;

type FocusTarget = 'email' | 'password' | 'alert';

/** The sign-in and registration form. One component, so both behave and read the same way. */
export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const { session, login, register } = useAuth();
  const router = useRouter();
  const nextQuery = useNextQuery();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<CredentialErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget } | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  // Explains why the person was sent here, when the session ended while they were using the app.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('reason') === 'expired') {
      setNotice('Your session ended. Sign in again to continue.');
    }
  }, []);

  // Signed in already, or just now: continue to the page they wanted (checked, same site only).
  useEffect(() => {
    if (session.status === 'authenticated') router.replace(readSafeNext());
  }, [session.status, router]);

  // Moves keyboard and screen reader focus to the problem once the error text is on the page.
  useEffect(() => {
    if (!focusRequest) return;
    const element =
      focusRequest.target === 'email'
        ? emailRef.current
        : focusRequest.target === 'password'
          ? passwordRef.current
          : alertRef.current;
    element?.focus();
  }, [focusRequest]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    const errors = validateCredentials(mode, { email, password });
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setFocusRequest({ target: errors.email ? 'email' : 'password' });
      return;
    }

    setSubmitting(true);
    try {
      const credentials = { email: email.trim(), password };
      if (mode === 'login') await login(credentials);
      else await register(credentials);
      // The session is now "authenticated", and the effect above moves on to the next page.
    } catch (error) {
      const described = describeAuthError(error, mode);
      setFieldErrors(described.fieldErrors);
      setFormError(described.formError);
      setPassword(''); // never leave a rejected password sitting in the field
      setSubmitting(false);
      setFocusRequest({
        target: described.fieldErrors.email
          ? 'email'
          : described.fieldErrors.password
            ? 'password'
            : 'alert',
      });
    }
  }

  if (session.status === 'authenticated') {
    return (
      <section className="auth-card">
        <p role="status">You are signed in. Taking you to the app…</p>
      </section>
    );
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{copy.title}</h1>

      {notice ? (
        <p className="alert alert-info" role="status">
          {notice}
        </p>
      ) : null}
      {session.status === 'unavailable' ? (
        <p className="alert alert-warning" role="status">
          The server is not answering right now, so we cannot check for an existing session. You can
          still try to sign in.
        </p>
      ) : null}

      <form noValidate onSubmit={onSubmit} className="auth-form">
        {formError ? (
          <div ref={alertRef} role="alert" tabIndex={-1} className="alert alert-danger">
            {formError}
          </div>
        ) : null}

        <TextField
          ref={emailRef}
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete={copy.emailAutocomplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          error={fieldErrors.email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
          }}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          name="password"
          autoComplete={copy.passwordAutocomplete}
          required
          hint={copy.hint}
          value={password}
          error={fieldErrors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (fieldErrors.password)
              setFieldErrors((current) => ({ ...current, password: undefined }));
          }}
        />

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? copy.busy : copy.submit}
        </button>
      </form>

      <p className="auth-switch">
        {copy.switchText} <Link href={`${copy.switchHref}${nextQuery}`}>{copy.switchLink}</Link>
      </p>
    </section>
  );
}
