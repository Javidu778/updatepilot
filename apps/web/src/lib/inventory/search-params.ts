import { applicationsQuerySchema, type ApplicationsQuery } from '@updatepilot/shared';

/** The sortable columns, taken from the query contract so the two can never disagree. */
export type ApplicationSortField = ApplicationsQuery['sort'];

/**
 * The URL is the single source of truth for the inventory view: search, filters, sorting and
 * pagination all live in the query string. That is what makes a filtered list shareable,
 * reload-safe and Back-button safe.
 *
 * The values are validated with the SAME schema the API uses, so the web app can never send a
 * combination the API would reject, and a hand-edited URL falls back to defaults instead of
 * breaking the page.
 */

export const INVENTORY_PATH = '/applications';

/** The API defaults. A URL that matches these is written without any query string. */
export const INVENTORY_DEFAULTS = {
  page: 1,
  pageSize: 25,
  sort: 'displayName',
  order: 'asc',
  includeRemoved: false,
} as const;

const FIELD_SCHEMAS = {
  q: applicationsQuerySchema.shape.q,
  updateStatus: applicationsQuerySchema.shape.updateStatus,
  matchStatus: applicationsQuerySchema.shape.matchStatus,
  source: applicationsQuerySchema.shape.source,
  deviceId: applicationsQuerySchema.shape.deviceId,
  includeRemoved: applicationsQuerySchema.shape.includeRemoved,
  sort: applicationsQuerySchema.shape.sort,
  order: applicationsQuerySchema.shape.order,
  page: applicationsQuerySchema.shape.page,
  pageSize: applicationsQuerySchema.shape.pageSize,
} as const;

type ReadableParams = { get: (name: string) => string | null };

/**
 * Reads the query from the URL. A field with an invalid value is dropped, not fatal: the page
 * still renders, using the default for that field only.
 */
export function readInventoryQuery(params: ReadableParams): ApplicationsQuery {
  const collected: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(FIELD_SCHEMAS)) {
    const value = params.get(key);
    if (value === null || value === '') continue;
    const parsed = schema.safeParse(value);
    if (parsed.success) collected[key] = parsed.data;
  }
  return applicationsQuerySchema.parse(collected);
}

/** The query string sent to GET /api/v1/applications. Every field is explicit, defaults included. */
export function toApiQueryString(query: ApplicationsQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.updateStatus) params.set('updateStatus', query.updateStatus);
  if (query.matchStatus) params.set('matchStatus', query.matchStatus);
  if (query.source) params.set('source', query.source);
  if (query.deviceId) params.set('deviceId', query.deviceId);
  if (query.includeRemoved) params.set('includeRemoved', 'true');
  params.set('sort', query.sort);
  params.set('order', query.order);
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  return params.toString();
}

/** The address bar version: only what differs from the defaults, so a plain view is "/applications". */
export function inventoryHref(query: ApplicationsQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.updateStatus) params.set('updateStatus', query.updateStatus);
  if (query.matchStatus) params.set('matchStatus', query.matchStatus);
  if (query.source) params.set('source', query.source);
  if (query.deviceId) params.set('deviceId', query.deviceId);
  if (query.includeRemoved) params.set('includeRemoved', 'true');
  if (query.sort !== INVENTORY_DEFAULTS.sort) params.set('sort', query.sort);
  if (query.order !== INVENTORY_DEFAULTS.order) params.set('order', query.order);
  if (query.page !== INVENTORY_DEFAULTS.page) params.set('page', String(query.page));
  if (query.pageSize !== INVENTORY_DEFAULTS.pageSize)
    params.set('pageSize', String(query.pageSize));
  const search = params.toString();
  return search ? `${INVENTORY_PATH}?${search}` : INVENTORY_PATH;
}

/** True when the list is narrowed or ordered in any way, so the empty state can offer a reset. */
export function hasInventoryFilters(query: ApplicationsQuery): boolean {
  return Boolean(
    query.q ||
    query.updateStatus ||
    query.matchStatus ||
    query.source ||
    query.deviceId ||
    query.includeRemoved,
  );
}

/**
 * Applies a change and decides what happens to the page number.
 *
 * Changing a filter, the sort order or the page size starts again at page 1; the page you were
 * on may no longer exist, and showing an empty page 7 of a 2-page result is confusing.
 */
export function applyInventoryPatch(
  current: ApplicationsQuery,
  patch: Partial<ApplicationsQuery>,
): ApplicationsQuery {
  const changesWhatIsListed = (Object.keys(patch) as (keyof ApplicationsQuery)[]).some(
    (key) => key !== 'page',
  );
  const next = { ...current, ...patch };
  if (changesWhatIsListed && patch.page === undefined) next.page = 1;
  return next;
}

/** Clicking a column toggles its order; a new column starts ascending. */
export function toggleInventorySort(
  current: ApplicationsQuery,
  field: ApplicationSortField,
): ApplicationsQuery {
  const order = current.sort === field && current.order === 'asc' ? 'desc' : 'asc';
  return applyInventoryPatch(current, { sort: field, order });
}

/** Column headings, and the accessible label for the sort button inside each one. */
export const SORT_LABELS: Record<ApplicationSortField, string> = {
  displayName: 'Application',
  publisher: 'Publisher',
  installedVersion: 'Installed version',
  updateStatus: 'Status',
  lastSeenAt: 'Last seen',
};
