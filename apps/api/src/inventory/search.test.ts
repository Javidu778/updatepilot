import { describe, expect, it } from 'vitest';
import { escapeLike } from './search';

describe('escapeLike', () => {
  it('leaves ordinary text alone', () => {
    expect(escapeLike('Visual Studio Code 2022')).toBe('Visual Studio Code 2022');
    expect(escapeLike('Notepad++')).toBe('Notepad++');
  });

  it('escapes the LIKE wildcards', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('snake_case')).toBe('snake\\_case');
  });

  it('escapes the escape character first, so it cannot cancel another escape', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  it('handles an empty string', () => {
    expect(escapeLike('')).toBe('');
  });
});
