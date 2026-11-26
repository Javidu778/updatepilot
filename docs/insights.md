# UpdatePilot: History and Security insights

Status: Implemented in Week 4 (History) and Week 5 (Security insights)
Code: `apps/api/src/routes/history.ts`, `apps/api/src/routes/security.ts`, `apps/web/src/components/history/`, `apps/web/src/components/security/`
Related: [`docs/updates.md`](updates.md), [`docs/scans.md`](scans.md), [`docs/threat-model.md`](threat-model.md)

Two read-only pages that answer "what happened" and "what is known about what I have installed".

## 1. History

`GET /api/v1/history` answers one timeline at a time, chosen by `type`:

| `type`   | Source       | Carries                                                                                      |
| -------- | ------------ | -------------------------------------------------------------------------------------------- |
| `update` | `UpdateJob`  | display name, from → to version, verification result, exit code, restart flag, stored reason |
| `scan`   | `ScanJob`    | outcome and application count                                                                |
| `audit`  | `AuditEvent` | the recorded action, its actor and safe metadata                                             |

Query: `page`, `pageSize`, `from`, `to`, `outcome`, `deviceId`.

Decisions worth knowing:

- **One type at a time, not a merged stream.** A merged stream cannot be paged correctly without reading
  everything first, and the page is clearer when the user says what they are looking at.
- **Ordered by `createdAt` descending with an `id` tie-break**, so paging never repeats or skips a row.
- **Scoped to the signed-in user** by device ownership or by `actorUserId`.
- **Sign-in events are excluded** from the audit timeline, matching the dashboard, so the list is about
  work rather than logins.
- The timestamp shown is when the job finished, falling back to when it was requested or created.

The page keeps the chosen timeline in the URL, so a view can be reloaded or shared.

## 2. Security insights

`GET /api/v1/security/findings` lists advisories **only for packages the user actually has installed**, so
another account's inventory is never implied.

Every response carries a `meta` block:

| Field         | Meaning                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`      | Where the rows came from. Today: `Sample data`, or `No advisory feed connected yet`                                                                 |
| `checkedAt`   | The newest `lastVerifiedAt` in the result, or null                                                                                                  |
| `limitations` | The sentence that must be read before the list: only known advisories for matched packages, and an empty list does not prove an application is safe |
| `isSample`    | True when every row is seeded sample data                                                                                                           |

### What this page does not claim

There is **no live advisory feed**. The OSV integration is outstanding work, and it is deliberately not
faked: the page leads with a sample-data banner when the rows are sample, and the limitation sentence
appears with the list _and_ with the empty state.

This matters because the most dangerous possible output of a security page is:

```
0 findings    ->    "my machine is safe"
```

Absence of findings means "nothing is known about these packages", which is why the wording is on the page
twice rather than in a footnote. If OSV is added later, the same `meta` contract carries the new source and
date, so the page does not need rewriting; the data source changes behind it.

### Why the sample row is safe to ship

The seeded finding points at a package that exists **only on the sample device** (`7zip.7zip`), never at a
package from the real machine, and it is labelled `SAMPLE-0001` with `isSample = true`. It exists so the
page can be designed and demonstrated without inventing a vulnerability for software the user runs.

## 3. Tests

| Suite                                         | Covers                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/routes/history.routes.test.ts`  | Update rows with both versions, scan rows with the count, activity without sign-in noise, outcome and device filters, isolation, 401 |
| `apps/api/src/routes/security.routes.test.ts` | Only installed packages, severity and package filters, sample labelling, explicit empty answer, isolation, 401                       |
