// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateCredentials } from './validate-credentials';

describe('validateCredentials (login)', () => {
  it('accepts a normal email and any non-empty password', () => {
    expect(
      validateCredentials('login', { email: 'demo@updatepilot.local', password: 'x' }),
    ).toEqual({});
  });

  it('asks for both fields when they are empty', () => {
    expect(validateCredentials('login', { email: '', password: '' })).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    });
  });

  it('treats a blank email as missing, not invalid', () => {
    expect(validateCredentials('login', { email: '   ', password: 'x' }).email).toBe(
      'Enter your email address.',
    );
  });

  it('rejects something that is not an email', () => {
    expect(validateCredentials('login', { email: 'not-an-email', password: 'x' }).email).toBe(
      'Enter a valid email address.',
    );
  });

  it('ignores spaces around the email, as the form does when it sends it', () => {
    expect(
      validateCredentials('login', { email: '  demo@updatepilot.local ', password: 'x' }),
    ).toEqual({});
  });

  it('does not apply the length rule when signing in, so an old short password still reaches the server', () => {
    expect(validateCredentials('login', { email: 'a@b.co', password: 'short' })).toEqual({});
  });
});

describe('validateCredentials (register)', () => {
  const email = 'new.user@example.com';

  it('requires at least 12 characters', () => {
    expect(validateCredentials('register', { email, password: '12345678901' }).password).toBe(
      'Use at least 12 characters.',
    );
    expect(validateCredentials('register', { email, password: '123456789012' })).toEqual({});
  });

  it('allows up to 128 characters and no more', () => {
    expect(validateCredentials('register', { email, password: 'a'.repeat(128) })).toEqual({});
    expect(validateCredentials('register', { email, password: 'a'.repeat(129) }).password).toBe(
      'Use 128 characters or fewer.',
    );
  });

  it('asks for a password when it is empty', () => {
    expect(validateCredentials('register', { email, password: '' }).password).toBe(
      'Enter your password.',
    );
  });

  it('reports the email and the password together', () => {
    const errors = validateCredentials('register', { email: 'nope', password: 'short' });
    expect(errors.email).toBe('Enter a valid email address.');
    expect(errors.password).toBe('Use at least 12 characters.');
  });

  it('rejects an email that is too long', () => {
    const errors = validateCredentials('register', {
      email: `${'a'.repeat(250)}@example.com`,
      password: 'a'.repeat(12),
    });
    expect(errors.email).toBeDefined();
  });
});
