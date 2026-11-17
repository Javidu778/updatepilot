import { describe, expect, it } from 'vitest';
import { parseBearer } from './auth';

const TOKEN = 'A'.repeat(43);

describe('parseBearer', () => {
  it('accepts the header the agent sends', () => {
    expect(parseBearer(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearer(`  Bearer ${TOKEN}  `)).toBe(TOKEN);
  });

  it('rejects anything else', () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('')).toBeNull();
    expect(parseBearer(TOKEN)).toBeNull();
    expect(parseBearer(`Basic ${TOKEN}`)).toBeNull();
    expect(parseBearer('Bearer short')).toBeNull();
    expect(parseBearer(`Bearer ${'A'.repeat(201)}`)).toBeNull();
    expect(parseBearer(`Bearer ${'A'.repeat(42)} with space`)).toBeNull();
  });
});
