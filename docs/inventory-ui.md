# UpdatePilot: Inventory UI and Overview

Status: Implemented in Week 2, Day 5
Code: `apps/web/src/app/(app)/`, `apps/web/src/components/`, `apps/web/src/lib/`
Builds on: `docs/inventory-api.md` (Day 3 endpoints), `docs/web-auth.md` (Day 4 client)

## 1. Pages

| Route                | What it shows                                                      |
| -------------------- | ------------------------------------------------------------------ |
| `/`                  | Counts, last scan, agent connection and recent activity (Overview) |
| `/applications`      | The inventory: search, filters, sorting, pagination                |
| `/applications/[id]` | One application with release information and update history        |

All three need a signed-in user; `RequireAuth` redirects to `/login?next=…` otherwise.

## 2. The URL is the state

Search, filters, sorting and pagination live in the query string, so a filtered view can be
reloaded, shared and reached with the Back button. `lib/inventory/search-params.ts` validates the
URL with the API's own `applicationsQuerySchema`, so the web app cannot send a request the API
would reject. An invalid field falls back to its default instead of failing the page.

Defaults are omitted from the address bar: `/applications` is the unfiltered, name-ascending view.

## 3. States

| State             | What the user sees                                                 |
| ----------------- | ------------------------------------------------------------------ |
| Loading           | Skeleton block with `aria-busy`, same layout as the final table    |
| Empty             | Two different messages: nothing scanned yet, or filters too narrow |
| Page past the end | "This page is empty" with a link back to page 1                    |
| Error             | The reason in plain words, plus a working "Try again"              |

## 4. Agent state

`DevicesProvider` fetches `GET /api/v1/devices` once per session and exposes the most recently
seen device that is not revoked. The top bar indicator and the Overview agent card read that one
value, so they cannot disagree.

## 5. Accessibility

- Real `<table>` with `<caption>`, `scope="col"` and `aria-sort` on the sorted column.
- Search and filters have visible labels; changes are applied to the URL, announced via
  `role="status"` summaries.
- Colour is never the only signal: every status has an icon and a text label.
- Keyboard only: tab through search, filters, sortable headers, row links and pagination.

## 6. Known limits

- Sorting uses the database's text ordering (see `inventory-api.md` §6).
- The detail page's back link returns to the unfiltered list; carrying the previous filters
  through needs the list state in the link (planned with the Week 5 polish pass).
- Release information stays "Not available" until update checking lands in Week 4.
