import { describe, expect, it } from 'vitest';
import { describeFailure } from './describe-failure';
import { ApiError, NetworkError, ResponseShapeError } from './errors';

describe('describeFailure', () => {
  it('explains an unreachable server', () => {
    expect(describeFailure(new NetworkError())).toContain("can't reach the server");
  });

  it('names what could not be found', () => {
    expect(describeFailure(new ApiError(404, 'NOT_FOUND', 'Not found'), 'that application')).toBe(
      'We could not find that application.',
    );
  });

  it('asks the person to sign in again on 401', () => {
    const message = describeFailure(
      new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'),
    );
    expect(message).toContain('Sign in again');
  });

  it('does not blame the user for a server error', () => {
    expect(describeFailure(new ApiError(500, 'INTERNAL_ERROR', 'boom'))).toContain(
      'server had a problem',
    );
  });

  it('handles a response it does not understand', () => {
    expect(describeFailure(new ResponseShapeError())).toContain('does not understand');
  });

  it('falls back for anything else', () => {
    expect(describeFailure(new Error('?'))).toContain('Something went wrong');
  });
});
