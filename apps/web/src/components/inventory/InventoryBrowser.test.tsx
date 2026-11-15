import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth/session';
import { apiError, authBody, createFakeApi } from '@/test/fake-api';
import { InventoryBrowser } from './InventoryBrowser';

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => nav.searchParams,
}));

// Link needs a router in the App Router; a plain anchor is enough for these assertions.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string | { pathname?: string }; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}));

const APPLICATION = {
  id: '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b',
  deviceId: '8a1c4f2e-6b3d-4a5e-9c7b-2d1e3f4a5b6c',
  displayName: 'Firefox',
  publisher: 'Mozilla',
  installedVersion: '120.0',
  availableVersion: '121.0',
  packageId: 'Mozilla.Firefox',
  source: 'winget',
  architecture: 'x64',
  matchStatus: 'MATCHED',
  updateStatus: 'UPDATE_AVAILABLE',
  lastSeenAt: '2026-11-12T10:00:00.000Z',
  removedAt: null,
};

const page = (data: unknown[], overrides: Record<string, number> = {}) => ({
  json: {
    data,
    page: 1,
    pageSize: 25,
    total: data.length,
    totalPages: data.length > 0 ? 1 : 0,
    ...overrides,
  },
});

const SIGNED_IN = { 'GET /api/v1/auth/me': { json: authBody() } };

function renderBrowser(routes: Parameters<typeof createFakeApi>[0]) {
  const fake = createFakeApi({ ...SIGNED_IN, ...routes });
  render(
    <AuthProvider baseUrl="http://api.test" fetchImpl={fake.fetchImpl}>
      <InventoryBrowser />
    </AuthProvider>,
  );
  return fake;
}

beforeEach(() => {
  nav.replace.mockReset();
  nav.searchParams = new URLSearchParams();
});

describe('inventory browser', () => {
  it('shows the rows the API returned, and asks for the default page once', async () => {
    const fake = renderBrowser({ 'GET /api/v1/applications': page([APPLICATION]) });

    const link = await screen.findByRole('link', { name: 'Firefox' });
    const row = link.closest('tr') as HTMLTableRowElement;

    expect(within(row).getByText('Mozilla.Firefox')).toBeTruthy();
    expect(within(row).getByText('120.0')).toBeTruthy();
    expect(within(row).getByText('121.0')).toBeTruthy();
    expect(within(row).getByText('Update available')).toBeTruthy();
    expect(fake.callsTo('GET /api/v1/applications')).toHaveLength(1);
  });

  it('explains an empty inventory when nothing is filtered', async () => {
    renderBrowser({ 'GET /api/v1/applications': page([]) });

    expect(await screen.findByText('No applications yet')).toBeTruthy();
    expect(screen.getByText(/Pair an agent and run a scan/)).toBeTruthy();
  });

  it('offers a reset when filters match nothing', async () => {
    nav.searchParams = new URLSearchParams('q=nothingmatches');

    renderBrowser({ 'GET /api/v1/applications': page([]) });

    expect(await screen.findByText('No applications match these filters')).toBeTruthy();
    // Two resets on purpose: one in the toolbar, one in the empty state.
    expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(2);
  });

  it('reports a server failure and offers to try again, without losing the page', async () => {
    renderBrowser({
      'GET /api/v1/applications': apiError(500, 'INTERNAL_ERROR', 'boom'),
    });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/The server had a problem/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows a row that has no available version without inventing one', async () => {
    renderBrowser({
      'GET /api/v1/applications': page([
        { ...APPLICATION, availableVersion: null, updateStatus: 'UP_TO_DATE' },
      ]),
    });

    expect(await screen.findByText('Up to date')).toBeTruthy();
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });
});
