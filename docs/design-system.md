# UpdatePilot: Design System

Status: Draft for team review (Day 2)
Tokens file: `docs/design/tokens.css` (copied into `apps/web` on Day 5)
Related: `docs/wireframes.md`

## 1. Direction

UpdatePilot should feel like a polished developer or IT operations product:

- Restrained palette with one accent color.
- Strong typographic hierarchy and consistent spacing.
- Compact, readable data tables.
- Informative empty, loading and error states.
- Status colors used deliberately and never as the only signal.
- Light and dark themes, responsive layouts, full keyboard support, WCAG 2.2 AA as the target.

## 2. Color tokens

All colors are CSS variables so themes switch by changing one attribute. Components must use tokens, never raw hex values.

### 2.1 Core

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#FFFFFF` | `#0B1220` | Page background |
| `--color-surface` | `#F8FAFC` | `#111827` | Sidebar, panels |
| `--color-surface-raised` | `#FFFFFF` | `#1F2937` | Cards, dialogs, menus |
| `--color-border` | `#E2E8F0` | `#334155` | Dividers, outlines |
| `--color-border-strong` | `#94A3B8` | `#64748B` | Input borders |
| `--color-text` | `#0F172A` | `#F1F5F9` | Primary text |
| `--color-text-muted` | `#475569` | `#94A3B8` | Secondary text |
| `--color-primary` | `#2563EB` | `#60A5FA` | Primary buttons, links, focus |
| `--color-primary-hover` | `#1D4ED8` | `#93C5FD` | Hover state |
| `--color-on-primary` | `#FFFFFF` | `#0B1220` | Text on primary buttons |

### 2.2 Status

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--color-success` | `#15803D` | `#4ADE80` | Up to date, succeeded, verified |
| `--color-warning` | `#B45309` | `#FBBF24` | Update available, restart required, stale |
| `--color-danger` | `#B91C1C` | `#F87171` | Failed, revoked, destructive |
| `--color-info` | `#0369A1` | `#38BDF8` | Running, informational |
| `--color-neutral` | `#475569` | `#94A3B8` | Unknown, unmatched, unsupported |

Each status also has a tinted background token (`--color-success-bg` and so on) for badges and banners.

### 2.3 Contrast rule

- Normal text needs at least 4.5:1 against its background, large text and UI boundaries at least 3:1.
- The values above were chosen to meet these targets, but **verify every pairing in a contrast checker before release** and record the result in the PR.

## 3. Typography

| Role | Family | Notes |
|---|---|---|
| UI text | Inter (fallback: system-ui, Segoe UI, sans-serif) | Loaded with `next/font` |
| Code, IDs, versions | JetBrains Mono (fallback: ui-monospace, Consolas, monospace) | Package IDs, versions, exit codes |

Scale (base 16px, line heights unitless):

| Token | Size | Line height | Use |
|---|---|---|---|
| `--text-xs` | 12px | 1.4 | Badges, table meta |
| `--text-sm` | 14px | 1.5 | Table cells, secondary text |
| `--text-base` | 16px | 1.5 | Body, inputs |
| `--text-lg` | 18px | 1.4 | Card titles |
| `--text-xl` | 20px | 1.3 | Section headings |
| `--text-2xl` | 24px | 1.25 | Page titles |
| `--text-3xl` | 30px | 1.2 | Large metric numbers |

Weights: 400 body, 500 labels and table headers, 600 headings. Use `font-variant-numeric: tabular-nums` for versions, counts and timestamps.
Users can zoom to 200% and resize text without loss of content, so sizes use `rem`.

## 4. Spacing, radius, elevation

- Spacing: 4px base. Tokens `--space-1` (4px) to `--space-12` (48px).
- Radius: `--radius-sm` 4px (badges), `--radius-md` 6px (inputs, buttons), `--radius-lg` 8px (cards, dialogs).
- Elevation: borders first; shadows only for floating layers (menus, dialogs, toasts).
- Layout: sidebar 240px, content max width 1280px, page padding 24px (16px on mobile).

## 5. Focus, motion and interaction

- **Focus ring:** 2px solid `--color-primary` with 2px offset on every interactive element, visible in both themes. Never remove outlines without a replacement.
- **Targets:** minimum 24x24 CSS px, and 36px height for primary controls.
- **Motion:** short transitions (100 to 200ms). Respect `prefers-reduced-motion` by removing non-essential animation.
- **Theme:** default follows the system setting, with a manual override saved per browser. Avoid a flash of the wrong theme on load.

## 6. Status vocabulary

One shared mapping for badges across the app. Every status has an icon, a text label and a color.

| Status | Label | Color token | Meaning |
|---|---|---|---|
| `up_to_date` | Up to date | success | Installed equals the latest known version |
| `update_available` | Update available | warning | A newer version exists from a trusted source |
| `unmatched` | Unmatched | neutral | Could not be matched to a package identity |
| `unsupported` | Unsupported | neutral | Matched, but no supported update method |
| `unknown` | Unknown | neutral | Not enough data to compare versions |
| `queued` | Queued | info | Waiting for the agent |
| `running` | Running | info | Update or scan in progress |
| `verifying` | Verifying | info | Rescanning to confirm the version |
| `succeeded` | Succeeded | success | Completed and verified |
| `failed` | Failed | danger | Did not complete |
| `restart_required` | Restart required | warning | Needs a restart before verification |
| `cancelled` | Cancelled | neutral | Stopped by the user |
| `interrupted` | Interrupted | warning | Agent disconnected or timed out |
| `verification_failed` | Verification failed | danger | Installer finished, version not confirmed |

Color is never the only indicator: each badge includes an icon and its text label.

## 7. Components

Build these once and reuse them. Use accessible primitives (for example Radix UI or shadcn/ui built on Radix) and Lucide icons.

| Component | Key requirements |
|---|---|
| Button (primary, secondary, ghost, danger) | Visible focus, disabled state with a reason when relevant, loading state that prevents double submit |
| Status badge | Icon plus text, token colors only |
| Data table | Real `<table>` markup, sortable header buttons with `aria-sort`, row focus, sticky header, responsive fallback |
| Pagination | Labeled controls, current page announced, page size selector |
| Search and filter bar | Labeled inputs, clear action, state kept in URL |
| Card and metric tile | Heading, value, optional action link |
| Dialog | Modal, focus trap, Esc to close, focus returns to trigger, labelled by its title |
| Toast | `role="status"` (errors `role="alert"`), dismissible, not the only place a result appears |
| Banner | Info, warning, error variants for stale data, disconnected agent, sample data |
| Skeleton | Matches final layout, `aria-busy` on the container |
| Empty state | Icon, short explanation, one clear action |
| Progress stepper | Job states with icon, label and description |
| Form controls | Visible labels, error text linked with `aria-describedby`, no placeholder-only labels |
| Theme toggle | Three options (system, light, dark), announces the active choice |
| Sidebar and top bar | Landmarks (`nav`, `header`, `main`), skip link, `aria-current="page"` |

## 8. Accessibility checklist

- Landmarks and a logical heading order on every page.
- All functionality works with the keyboard alone, with a logical tab order and no traps (except intentionally inside modals).
- Visible focus in both themes.
- Form fields have labels, errors are announced, and required fields are marked.
- Dynamic updates (scan progress, job status, toasts) are announced to assistive technology.
- Tables use proper header cells and `scope`.
- Icons that carry meaning have text alternatives; decorative icons are hidden with `aria-hidden`.
- Test with keyboard only, a screen reader (NVDA on Windows), 200% zoom, and automated checks (axe) in Playwright.

## 9. Content rules

- Plain, specific language. Say what happened and what the user can do next.
- Never show a success message before verification completes.
- Missing data reads "Not available", with a reason when known.
- Security text states its source, date checked and limitations.
- Buttons describe their action ("Confirm update", not "OK").
- Sample data is always labelled as such.

## 10. Using the tokens in the project

On Day 5, when the Next.js app exists:

1. Copy `docs/design/tokens.css` into the web app's global styles.
2. Set the theme by adding `data-theme="light"` or `data-theme="dark"` on the `<html>` element. Without the attribute, the system preference applies.
3. Map the tokens into Tailwind so utility classes use them (the Tailwind setup depends on the version installed; follow its theme configuration docs and point the theme colors at these variables).
4. Add a lint or review rule: no raw hex colors in components.
