# UpdatePilot: Low-Fidelity Wireframes

Status: Draft for team review (Day 2)
Related: `docs/design-system.md`, `docs/scope.md`

These are structural wireframes. They define layout, content and behavior, not final visuals. Colors, type and spacing come from the design system.

Legend: `[Button]`  `(o)` status dot  `[v]` dropdown  `[ ]` checkbox  `...` more content

## 1. App shell (all pages)

```
+--------------------------------------------------------------------------------+
| UpdatePilot        [ Search applications...        ]   (o) Agent: Connected [Theme] |
+-------------+------------------------------------------------------------------+
| Overview    |  Page title                                      [Primary action] |
| Applications|  ----------------------------------------------------------------|
| Updates (3) |                                                                  |
| Security    |                                                                  |
| History     |                    Page content                                  |
| Settings &  |                                                                  |
|   agent     |                                                                  |
|             |                                                                  |
| v0.1.0      |                                                                  |
+-------------+------------------------------------------------------------------+
```

Behavior:
- Sidebar: 6 items, current page highlighted and marked with `aria-current="page"`. The Updates item shows a count badge when updates are available.
- Top bar: global search (jumps to Applications with the query), agent connection indicator (always visible), theme toggle.
- Skip link "Skip to main content" is the first focusable element.
- Under 768px wide the sidebar becomes a slide-over drawer opened from a menu button.

## 2. Overview

```
+--------------------------------------------------------------------------------+
| Overview                                  Last scan: 2 hours ago  [Run scan]   |
+--------------------------------------------------------------------------------+
| +--------------+ +--------------+ +--------------+ +------------------------+   |
| | Applications | | Updates      | | Unmatched    | | Agent                  |   |
| |     142      | | available: 9 | |      17      | | (o) Connected          |   |
| |              | | [Review]     | | [View]       | | Last seen: 1 min ago   |   |
| +--------------+ +--------------+ +--------------+ +------------------------+   |
|                                                                                |
| Next actions                                                                   |
| +----------------------------------------------------------------------------+ |
| |  9 updates available                                          [Review ->]  | |
| |  17 applications could not be matched to a package            [View ->]    | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| Recent activity                                                                |
| +----------------------------------------------------------------------------+ |
| | 10:42  Scan completed        142 apps found                                | |
| | 10:15  Update succeeded      7-Zip 23.01 -> 24.08 (verified)               | |
| | 09:58  Update failed         Example App - installer exit code 1603        | |
| +----------------------------------------------------------------------------+ |
|                                                           [View all history]   |
+--------------------------------------------------------------------------------+
```

Behavior:
- Every card and next-action link goes to the filtered page it describes.
- "Run scan" is disabled with an explanation when the agent is disconnected.
- A scan in progress replaces the button with a progress indicator and "Scan running...".
- Charts are optional. If used, they need a text or table alternative.

## 3. Applications (inventory)

```
+--------------------------------------------------------------------------------+
| Applications                                                  [Export CSV]     |
+--------------------------------------------------------------------------------+
| [ Search name or publisher...      ]  Status [v]  Source [v]  Matched [v] [Clear]|
| Showing 1-25 of 142                                                            |
+--------------------------------------------------------------------------------+
| Name  ^         Publisher        Installed    Available    Status       Source  |
|--------------------------------------------------------------------------------|
| 7-Zip           Igor Pavlov      23.01        24.08        Update avail. winget  |
| Git             Git SCM          2.45.1       2.45.1       Up to date   winget  |
| Legacy Tool     Unknown          1.0          -            Unmatched    -       |
| Some App        Vendor           5.2          -            Unsupported  -       |
| ...                                                                            |
+--------------------------------------------------------------------------------+
| Rows per page [25 v]                      [< Prev]  Page 1 of 6  [Next >]      |
+--------------------------------------------------------------------------------+
```

Behavior:
- Search, filters, sort and pagination all compose, and the state is kept in the URL query string so refresh and back/forward work.
- Changing a filter resets to page 1.
- Sortable column headers are buttons with `aria-sort`.
- Row click or Enter opens Application detail.
- Status always shows an icon and text, never color alone.
- "Export CSV" exports with the current filters applied.
- Empty states: no scan yet, no results for these filters (with "Clear filters"), agent disconnected.

## 4. Application detail

```
+--------------------------------------------------------------------------------+
| < Applications                                                                 |
| 7-Zip                                           Status: Update available       |
| Igor Pavlov                                              [Review update]       |
+--------------------------------------------------------------------------------+
| Versions                           | Package identity                          |
| Installed   23.01                  | Package ID   7zip.7zip                    |
| Available   24.08                  | Source       winget                       |
| Checked     10:42 today            | Architecture x64                          |
|                                    | Match        Matched                      |
+--------------------------------------------------------------------------------+
| Release information                                                            |
| Release date   2024-08-11            [Official release notes ->]               |
| Changelog      Available via the link above (not shown inline)                 |
| Source: winget manifest / GitHub Releases      Fetched: 2 hours ago            |
+--------------------------------------------------------------------------------+
| Update history for this application                                            |
| 2026-10-10   22.01 -> 23.01   Succeeded (verified)                             |
+--------------------------------------------------------------------------------+
```

Behavior:
- Any missing value shows "Not available" with the reason when known, never a blank cell.
- Unmatched or unsupported applications hide the update button and explain why. No command is ever guessed.
- "Review update" opens the confirmation dialog (section 5.2).

## 5. Updates (Update center)

### 5.1 List

```
+--------------------------------------------------------------------------------+
| Updates                                              9 available               |
+--------------------------------------------------------------------------------+
| Application     Installed -> Target      Source   Notes                  Action |
|--------------------------------------------------------------------------------|
| 7-Zip           23.01 -> 24.08           winget                          [Review]|
| Git             2.44 -> 2.45.1           winget   May need restart       [Review]|
| ...                                                                            |
+--------------------------------------------------------------------------------+
| Active and recent operations                                                   |
| 7-Zip   Running   [=========>      ] Installing...                  [Details]  |
+--------------------------------------------------------------------------------+
```

### 5.2 Confirmation dialog

```
+---------------------------------------------------------+
| Update 7-Zip?                                      [X]  |
|---------------------------------------------------------|
| Application   7-Zip (Igor Pavlov)                       |
| Package ID    7zip.7zip                                 |
| Source        winget                                    |
| Architecture  x64                                       |
| Version       23.01  ->  24.08                          |
|                                                         |
| What will happen                                        |
| - The agent will run the approved update for this       |
|   package only.                                         |
| - Installer hash and signature checks stay enabled.     |
| - Windows may ask for administrator approval.           |
| - The installed version will be re-checked afterwards.  |
|                                                         |
|                         [Cancel]  [Confirm update]      |
+---------------------------------------------------------+
```

Behavior:
- The dialog is modal: focus is trapped, Esc closes it, and focus returns to the "Review" button.
- Initial focus is on "Cancel", not on the destructive action.
- The target package and version must always be visible.
- One dialog per update. There is no bulk "update all" in the MVP.
- "Confirm update" disables itself after one click to avoid duplicate jobs.

### 5.3 Progress states

```
Queued  ->  Waiting for agent  ->  Running  ->  Verifying  ->  Succeeded
                                                   |
                                                   +-->  Failed | Restart required | Cancelled | Interrupted
```

- Each state has an icon, a label and a plain-language description.
- Failed jobs show the reason, the exit code and safe next steps. "Retry" appears only when the job state and package source are safe.
- Success is shown only after the rescan confirms the new version. If verification fails, the job is shown as "Verification failed".

## 6. Security insights

```
+--------------------------------------------------------------------------------+
| Security insights                                                              |
+--------------------------------------------------------------------------------+
| (i) Only findings with a verified package match and a known source are shown.  |
|     Coverage is limited. Absence of findings is not a guarantee of safety.     |
+--------------------------------------------------------------------------------+
| Advisory     Package     Severity   Affected range    Source   Last verified    |
|--------------------------------------------------------------------------------|
| CVE-XXXX-... example.pkg High       < 1.2.3           OSV      2026-10-28       |
+--------------------------------------------------------------------------------+
```

Empty state: "No verified findings. Last checked <date> using OSV. Many applications are not covered."
Unavailable state: "Security data is currently unavailable. The rest of UpdatePilot is not affected."

## 7. History

```
+--------------------------------------------------------------------------------+
| History                                                       [Export]         |
| [ Scans ]  [ Updates ]  [ Audit events ]                                       |
+--------------------------------------------------------------------------------+
| Time        Type     Target              Outcome          Details              |
|--------------------------------------------------------------------------------|
| 10:42       Scan     DESKTOP-01          Succeeded        142 apps       [>]   |
| 10:15       Update   7-Zip 23.01->24.08  Succeeded        Verified       [>]   |
| 09:58       Update   Example App         Failed           Exit code 1603 [>]   |
+--------------------------------------------------------------------------------+
| Expanded row: timestamps, before/after versions, exit code, safe diagnostics   |
+--------------------------------------------------------------------------------+
```

Behavior:
- Filters by date range, type and outcome. Pagination as in Applications.
- Expanded details show only safe diagnostic metadata. No file contents, passwords or browsing data.
- The Audit tab shows actor, device, event type, target and timestamp.

## 8. Settings and agent

```
+--------------------------------------------------------------------------------+
| Settings & agent                                                               |
+--------------------------------------------------------------------------------+
| Agent                                                                          |
| DESKTOP-01      (o) Connected     Agent v0.1.0     Last seen 1 min ago         |
|                                          [Revoke agent]  [Pair another device] |
+--------------------------------------------------------------------------------+
| Pair a new agent                                                               |
| Your one-time code:  ABCD-1234        Expires in 09:42        [Generate new]   |
| 1. Install the agent   2. Run: updatepilot-agent pair   3. Enter the code      |
+--------------------------------------------------------------------------------+
| Preferences                                                                    |
| Theme              ( ) System  ( ) Light  ( ) Dark                             |
| Scan preferences   [ ] Scan when the agent connects                            |
| Notifications      [ ] Notify me when updates are found   (saved, optional)    |
| Data retention     Keep detailed logs for [ 90 v ] days            [Save]      |
| Privacy            What UpdatePilot collects: ...        [Delete my data]      |
+--------------------------------------------------------------------------------+
```

Behavior:
- "Revoke agent" asks for confirmation and explains the effect: the agent stops working until re-paired.
- The pairing code is single-use and short-lived. It is never shown after it expires or is used.
- Every control saves or performs its stated action. Unavailable options are removed or clearly labelled "Not available yet", never left as dead buttons.

## 9. Cross-cutting states

Every data-driven page implements these. They are designed, not left to defaults.

| State | Treatment |
|---|---|
| Loading | Skeleton placeholders matching the final layout; `aria-busy="true"`; no layout jump |
| Empty (first use) | Explanation plus one clear next action (for example "Pair your agent") |
| Empty (no results) | Message plus "Clear filters" |
| Error | Plain-language message, cause if known, "Try again" button; details expandable |
| Success | Toast with `role="status"`, also reflected in the page content |
| Stale data | Banner: "Data from <time> ago. Run a scan to refresh." Shown after a set threshold |
| Disconnected agent | Persistent banner and top-bar indicator; scan and update actions disabled with a reason |
| Sample data | Visible banner: "Sample data. Not from a real scan." on every page using it |

## 10. Responsive behavior

| Width | Layout |
|---|---|
| Under 768px (mobile) | Sidebar becomes a drawer; tables become stacked cards or scroll inside their own container; dialogs go full width |
| 768px to 1199px (tablet) | Collapsed icon sidebar with labels on hover and focus; tables keep core columns, secondary columns hidden |
| 1200px and up (desktop) | Full sidebar, all columns visible |

Wide content scrolls inside its own container. The page body never scrolls sideways.

## 11. Review checklist (Day 2 done when all are true)

- [ ] All six sections have a wireframe.
- [ ] The confirmation dialog shows target package and version.
- [ ] All eight cross-cutting states are defined.
- [ ] Every control shown has a documented action.
- [ ] Mobile, tablet and desktop behavior is described.
- [ ] The team has reviewed and commented on the PR.
