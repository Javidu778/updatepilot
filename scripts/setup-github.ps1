# UpdatePilot: create GitHub labels, milestones and issues
# Run from the repo root. Safe to re-run: existing items are skipped.

$ErrorActionPreference = 'Continue'

# --- Check we are in a repo GitHub knows about ---
gh repo view --json nameWithOwner -q .nameWithOwner
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Run this from inside your cloned updatepilot repo, after gh auth login.' -ForegroundColor Red
    exit 1
}

# --- Labels ---
$labels = @(
    @{ Name = 'must';    Color = 'd73a4a'; Desc = 'Required for the MVP' },
    @{ Name = 'should';  Color = 'fbca04'; Desc = 'Important, but not a blocker' },
    @{ Name = 'could';   Color = '0e8a16'; Desc = 'Optional if time allows' },
    @{ Name = 'future';  Color = 'c5def5'; Desc = 'Out of scope for the MVP' },
    @{ Name = 'web';     Color = '1d76db'; Desc = 'Next.js dashboard' },
    @{ Name = 'api';     Color = '5319e7'; Desc = 'Express API and database' },
    @{ Name = 'agent';   Color = 'b60205'; Desc = 'Windows agent' },
    @{ Name = 'docs';    Color = '0075ca'; Desc = 'Documentation' },
    @{ Name = 'testing'; Color = 'bfd4f2'; Desc = 'Tests and QA' }
)

Write-Host "`nCreating labels..." -ForegroundColor Cyan
foreach ($l in $labels) {
    gh label create $l.Name --color $l.Color --description $l.Desc --force | Out-Null
    Write-Host "  label: $($l.Name)"
}

# --- Milestones ---
$milestones = @(
    @{ Title = 'M1: UI/UX, architecture and app shell';        Desc = 'Approved UI/UX, architecture and working application shell.' },
    @{ Title = 'M2: Inventory with real scan data';            Desc = 'Working inventory backed by real scan data.' },
    @{ Title = 'M3: Update detection and update workflow';     Desc = 'Verified update detection and a functioning update workflow.' },
    @{ Title = 'M4: Tested, documented and packaged MVP';      Desc = 'Tested, documented and packaged MVP.' }
)

Write-Host "`nCreating milestones..." -ForegroundColor Cyan
$existingMs = gh api 'repos/:owner/:repo/milestones?state=all&per_page=100' --jq '.[].title'
foreach ($m in $milestones) {
    if ($existingMs -contains $m.Title) {
        Write-Host "  exists:  $($m.Title)"
    } else {
        gh api 'repos/:owner/:repo/milestones' -f title="$($m.Title)" -f description="$($m.Desc)" --silent
        Write-Host "  created: $($m.Title)"
    }
}

# --- Issues ---
function New-Body($desc, $criteria) {
    $lines = @($desc, '', '## Acceptance criteria')
    foreach ($c in $criteria) { $lines += "- [ ] $c" }
    $lines += ''
    $lines += 'Source: UpdatePilot project proposal, section 6.'
    return ($lines -join "`n")
}

$issues = @(
    @{ Title = 'FR-01: Securely pair, identify and revoke a local agent'; Labels = 'must,agent,api'; Ms = 1
       Body = (New-Body 'A user can pair a Windows agent using a one-time code. The server stores only a hash of the agent credential, and credentials can be revoked and rotated.' @(
           'Pairing code is single-use and expires',
           'Agent credential is stored hashed on the server',
           'Revoked agents are rejected on every request',
           'Agent status and last-seen time are visible in the UI')) },

    @{ Title = 'FR-02: Discover installed applications and persist scan results'; Labels = 'must,agent,api'; Ms = 1
       Body = (New-Body 'The agent scans the installed applications and the API stores the results as scan snapshots.' @(
           'A scan job has a persistent state, start and end times',
           'Real installed apps from the test PC appear in the database',
           'Previous scan snapshots are kept, not overwritten',
           'Timeouts and agent disconnects are handled')) },

    @{ Title = 'FR-03: Match detected applications to trusted package identities'; Labels = 'must,agent,api'; Ms = 1
       Body = (New-Body 'Detected applications are matched to package identities (for example WinGet package IDs). Unmatched apps are shown separately.' @(
           'Matching lives in its own module with unit tests',
           'Unmatched and unsupported apps are clearly labelled',
           'No update command is ever guessed for an unmatched app')) },

    @{ Title = 'FR-04: Compare installed and available versions for supported packages'; Labels = 'must,api'; Ms = 2
       Body = (New-Body 'Compare installed and available versions accurately and flag which apps have updates.' @(
           'Version comparison is a separate, unit-tested module',
           'Results are checked against real WinGet output',
           'Unknown version states are shown explicitly')) },

    @{ Title = 'FR-05: Show application details and official release metadata'; Labels = 'must,web,api'; Ms = 2
       Body = (New-Body 'Application detail pages show installed and available versions, release date, changelog link and official link when available.' @(
           'Metadata is cached and respects source rate limits',
           'Missing metadata shows as unavailable, not blank',
           'Source outages do not break the inventory')) },

    @{ Title = 'FR-06: Search, filter, sort and paginate the inventory'; Labels = 'must,web,api'; Ms = 1
       Body = (New-Body 'The application inventory supports search, filtering, sorting and pagination that work together.' @(
           'Search, filters, sorting and pagination compose correctly',
           'Large inventories are paginated server-side',
           'Empty, loading and error states are designed')) },

    @{ Title = 'FR-07: Execute a supported update only after explicit user confirmation'; Labels = 'must,web,api,agent'; Ms = 2
       Body = (New-Body 'The user previews an update, confirms it, and the agent runs only an allowlisted operation.' @(
           'Confirmation dialog shows the target package and version',
           'The agent re-validates the approved operation independently',
           'No arbitrary commands or paths are accepted from the browser',
           'Installer hash and signature checks are never bypassed')) },

    @{ Title = 'FR-08: Verify the resulting installed version and record the outcome'; Labels = 'must,agent,api'; Ms = 2
       Body = (New-Body 'After an update the agent captures the exit status and rescans to verify the installed version.' @(
           'Exit code and restart-required state are captured',
           'Success is reported only after the rescan confirms the new version',
           'A verification failure is shown and recorded')) },

    @{ Title = 'FR-09: Persist scan and update history with diagnostic details'; Labels = 'must,api,web'; Ms = 2
       Body = (New-Body 'Scan and update history, before and after versions, failures and audit events are stored and shown in the History page.' @(
           'Audit events record actor, device, package, target, timestamps and result',
           'Failure diagnostics are visible without exposing sensitive data',
           'Retention limits for detailed logs are defined')) },

    @{ Title = 'FR-10: Display security information only when the match and source are reliable'; Labels = 'should,api,web'; Ms = 3
       Body = (New-Body 'The Security insights page shows verified advisories with source and freshness, and never makes unverified claims.' @(
           'Each finding shows its source and date checked',
           'Unavailable data is labelled clearly',
           'No finding is shown when package identity is unverified')) },

    @{ Title = 'FR-11: Export inventory and update reports'; Labels = 'should,web,api'; Ms = 3
       Body = (New-Body 'Users can export the inventory and update reports.' @(
           'Export works from the UI with the current filters',
           'Exported data contains only inventory and operational metadata')) },

    @{ Title = 'FR-12: Responsive layouts, keyboard navigation and light/dark themes'; Labels = 'must,web'; Ms = 0
       Body = (New-Body 'The dashboard is responsive, keyboard accessible and supports light and dark themes, targeting WCAG 2.2 AA.' @(
           'All controls are reachable and usable by keyboard with visible focus',
           'Light and dark themes both meet contrast requirements',
           'Layouts work on mobile, tablet and desktop widths',
           'Keyboard and screen-reader flows are tested')) },

    @{ Title = 'FR-13: Scheduled scans and configurable notifications'; Labels = 'could,api,web,agent'; Ms = 3
       Body = (New-Body 'Optional: scheduled scans and notification preferences. Only start if all Must items are done.' @(
           'Scan schedule is configurable',
           'Notification preferences are saved and respected')) },

    @{ Title = 'FR-14: Support other operating systems'; Labels = 'future,agent'; Ms = -1
       Body = (New-Body 'Future work: macOS and Linux agents. Out of scope for the MVP, tracked here for the roadmap only.' @(
           'Not part of the initial release')) }
)

Write-Host "`nCreating issues..." -ForegroundColor Cyan
$existing = gh issue list --state all --limit 200 --json title --jq '.[].title'
foreach ($i in $issues) {
    if ($existing -contains $i.Title) {
        Write-Host "  exists:  $($i.Title)"
        continue
    }
    $args = @('issue', 'create', '--title', $i.Title, '--body', $i.Body, '--label', $i.Labels)
    if ($i.Ms -ge 0) { $args += @('--milestone', $milestones[$i.Ms].Title) }
    gh @args | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "  created: $($i.Title)" }
    else { Write-Host "  FAILED:  $($i.Title)" -ForegroundColor Red }
}

Write-Host "`nDone. Open the repo on GitHub to check Issues and Milestones." -ForegroundColor Green
