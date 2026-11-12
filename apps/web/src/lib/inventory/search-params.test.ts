import { describe, expect, it } from 'vitest';
import {
  applyInventoryPatch,
  hasInventoryFilters,
  inventoryHref,
  readInventoryQuery,
  toApiQueryString,
  toggleInventorySort,
} from './search-params';

const read = (query = '') => readInventoryQuery(new URLSearchParams(query));

describe('readInventoryQuery', () => {
  it('applies the API defaults to an empty URL', () => {
    const query = read();
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(25);
    expect(query.sort).toBe('displayName');
    expect(query.order).toBe('asc');
    expect(query.includeRemoved).toBe(false);
    expect(query.q).toBeUndefined();
    expect(query.updateStatus).toBeUndefined();
  });

  it('reads every supported field', () => {
    const query = read(
      'q=firefox&updateStatus=UPDATE_AVAILABLE&matchStatus=MATCHED&sort=publisher&order=desc&page=3&pageSize=50&includeRemoved=true',
    );
    expect(query.q).toBe('firefox');
    expect(query.updateStatus).toBe('UPDATE_AVAILABLE');
    expect(query.matchStatus).toBe('MATCHED');
    expect(query.sort).toBe('publisher');
    expect(query.order).toBe('desc');
    expect(query.page).toBe(3);
    expect(query.pageSize).toBe(50);
    expect(query.includeRemoved).toBe(true);
  });

  it('drops one invalid field instead of breaking the page', () => {
    const query = read('page=abc&sort=hacked&pageSize=0&updateStatus=NOT_A_STATUS&q=vlc');
    expect(query.page).toBe(1);
    expect(query.sort).toBe('displayName');
    expect(query.pageSize).toBe(25);
    expect(query.updateStatus).toBeUndefined();
    expect(query.q).toBe('vlc');
  });

  it('drops a search longer than the API allows', () => {
    expect(read(`q=${'x'.repeat(101)}`).q).toBeUndefined();
    expect(read(`q=${'x'.repeat(100)}`).q).toHaveLength(100);
  });

  it('ignores an invalid boolean', () => {
    expect(read('includeRemoved=maybe').includeRemoved).toBe(false);
  });
});

describe('inventoryHref', () => {
  it('writes the plain view without a query string', () => {
    expect(inventoryHref(read())).toBe('/applications');
  });

  it('writes only what differs from the defaults', () => {
    expect(inventoryHref(read('q=vlc&page=2'))).toBe('/applications?q=vlc&page=2');
    expect(inventoryHref(read('sort=publisher&order=desc'))).toBe(
      '/applications?sort=publisher&order=desc',
    );
  });

  it('round-trips through readInventoryQuery', () => {
    const original = read('q=vlc&updateStatus=UP_TO_DATE&sort=lastSeenAt&order=desc&page=4');
    const href = inventoryHref(original);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(readInventoryQuery(params)).toEqual(original);
  });
});

describe('toApiQueryString', () => {
  it('sends the defaults explicitly', () => {
    expect(toApiQueryString(read())).toBe('sort=displayName&order=asc&page=1&pageSize=25');
  });

  it('includes the search text', () => {
    expect(toApiQueryString(read('q=vlc'))).toContain('q=vlc');
  });
});

describe('applyInventoryPatch', () => {
  it('starts again at page 1 when a filter changes', () => {
    const query = read('page=5&q=vlc');
    expect(applyInventoryPatch(query, { updateStatus: 'UP_TO_DATE' }).page).toBe(1);
    expect(applyInventoryPatch(query, { q: 'firefox' }).page).toBe(1);
    expect(applyInventoryPatch(query, { pageSize: 50 }).page).toBe(1);
  });

  it('keeps the requested page when only the page changes', () => {
    const query = read('page=2');
    expect(applyInventoryPatch(query, { page: 3 }).page).toBe(3);
  });

  it('clears a filter when the patch value is undefined', () => {
    expect(applyInventoryPatch(read('q=vlc'), { q: undefined }).q).toBeUndefined();
  });
});

describe('toggleInventorySort', () => {
  it('flips the order when the same column is clicked again', () => {
    const query = read();
    const flipped = toggleInventorySort(query, 'displayName');
    expect(flipped.sort).toBe('displayName');
    expect(flipped.order).toBe('desc');
    expect(toggleInventorySort(flipped, 'displayName').order).toBe('asc');
  });

  it('starts a new column ascending on page 1', () => {
    const next = toggleInventorySort(read('page=4'), 'publisher');
    expect(next.sort).toBe('publisher');
    expect(next.order).toBe('asc');
    expect(next.page).toBe(1);
  });
});

describe('hasInventoryFilters', () => {
  it('is false only for the untouched view', () => {
    expect(hasInventoryFilters(read())).toBe(false);
    expect(hasInventoryFilters(read('q=vlc'))).toBe(true);
    expect(hasInventoryFilters(read('updateStatus=UP_TO_DATE'))).toBe(true);
    expect(hasInventoryFilters(read('matchStatus=UNMATCHED'))).toBe(true);
  });
});
