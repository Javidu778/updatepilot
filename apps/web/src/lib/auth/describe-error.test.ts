// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, ResponseShapeError } from '@/lib/api/errors';
import { describeAuthError } from './describe-error';

const api = (status: number, details: { path: string; message: string }[] = [], retry?: number) =>
  new ApiError(status, 'UNKNOWN', 'server text that must not be shown', details, 'req-1', retry);

describe('describeAuthError', () => {
  it('explains an unreachable server', () => {
    expect(describeAuthError(new NetworkError(), 'login').formError).toMatch(
      /can't reach the server/i,
    );
  });

  it('gives one message for wrong credentials, without saying which part was wrong', () => {
    const { formError } = describeAuthError(api(401), 'login');
    expect(formError).toBe('Incorrect email or password.');
    expect(formError).not.toMatch(/no account|not found|unknown email/i);
  });

  it('turns a rate limit into a wait instruction', () => {
    expect(describeAuthError(api(429), 'login').formError).toBe(
      'Too many attempts. Wait a few minutes and try again.',
    );
    expect(describeAuthError(api(429, [], 45), 'login').formError).toBe(
      'Too many attempts. Try again in a minute.',
    );
    expect(describeAuthError(api(429, [], 600), 'login').formError).toBe(
      'Too many attempts. Try again in about 10 minutes.',
    );
  });

  it('tells the person to reload when the server refuses the request (origin or CSRF)', () => {
    expect(describeAuthError(api(403), 'login').formError).toMatch(/reload the page/i);
  });

  it('puts server field messages next to the field on a 400', () => {
    const result = describeAuthError(
      api(400, [{ path: 'email', message: 'This email cannot be used' }]),
      'register',
    );
    expect(result.fieldErrors).toEqual({ email: 'This email cannot be used' });
    expect(result.formError).toBeNull();
  });

  it('falls back to a form message for a 400 without field details', () => {
    expect(describeAuthError(api(400), 'register').formError).toBe(
      'We could not create the account.',
    );
    expect(describeAuthError(api(400), 'login').formError).toBe('Check the details and try again.');
  });

  it('reports server problems without exposing details', () => {
    const { formError } = describeAuthError(api(500), 'login');
    expect(formError).toMatch(/something went wrong on our side/i);
    expect(formError).not.toContain('server text');
  });

  it('copes with an unexpected response and with unknown errors', () => {
    expect(describeAuthError(new ResponseShapeError(), 'login').formError).toMatch(
      /unexpected answer/i,
    );
    expect(describeAuthError(new Error('boom'), 'login').formError).toBe(
      'Something went wrong. Try again.',
    );
    expect(describeAuthError('weird', 'login').formError).toBe('Something went wrong. Try again.');
  });
});
