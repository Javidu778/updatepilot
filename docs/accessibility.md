# UpdatePilot: Accessibility

Status: Keyboard, focus and theme behaviour checked by hand and by test. A screen-reader pass and an
automated axe run are outstanding (see §5).
Code: `apps/web/src/lib/a11y/`, `apps/web/src/components/AppSidebar.tsx`, `apps/web/src/app/inventory.css`
Related: [`docs/design-system.md`](design-system.md) §8, [`docs/deployment.md`](deployment.md)

## 1. What the audit found and fixed

| Finding                                                                                                                                                           | Fix                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The confirmation dialog did not manage focus.** Tab walked out of the dialog into the page behind it, and closing it dumped the user at the top of the document | `useFocusTrap` moves focus to Confirm on open, cycles Tab and Shift+Tab inside, and restores focus to the button that opened it                                                                           |
| **The drawer did not exist.** On a narrow screen the sidebar became a horizontally scrolling strip, so navigation was reachable only by scrolling sideways        | The sidebar is now an off-canvas drawer with a labelled toggle (`aria-expanded`, `aria-controls`), a backdrop, Escape to close, and it closes itself on navigation                                        |
| **`inventory.css` was never imported.** Every style added from Week 2 Day 5 onward — tables, dialog, banners, drawer — silently did not apply                     | Imported in the root layout, and the built CSS is checked for the rules                                                                                                                                   |
| Focus trap relied on `offsetParent` to find controls                                                                                                              | `offsetParent` is null for `position: fixed` dialogs and unimplemented in jsdom, so the trap silently found nothing. Visibility filtering removed; disabled controls are excluded by the selector instead |

## 2. Keyboard

| Area              | Behaviour                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Skip link         | First Tab stop, jumps to `#main-content`                                                                 |
| Navigation        | Every link is a real link, `aria-current="page"` on the active one                                       |
| Tables            | Sort headers are buttons; `aria-sort` announces the direction; row links are links, never clickable rows |
| Dialog            | Focus enters, stays, Escape closes, focus returns                                                        |
| Drawer            | Toggle announces expanded state; Escape closes; focus returns to the toggle                              |
| Forms             | Visible labels, errors linked with `aria-describedby`, focus moved to the first invalid field on submit  |
| Disabled controls | Always paired with a reason in text, never a silent dead button                                          |

## 3. Focus and colour

- A visible focus ring on every interactive element (`:focus-visible`, 2px, offset), from `tokens.css`.
- Colour is never the only signal: every status badge carries an icon and a text label.
- Light and dark are both defined as tokens, and `prefers-color-scheme` is respected with a manual
  override that persists.
- Motion is reduced under `prefers-reduced-motion`, including the drawer transition and skeleton pulse.

## 4. Structure

- One `h1` per page, then `h2` per section; tables use `caption`, `scope="col"` and `aria-sort`.
- Landmarks: `header`, `nav[aria-label="Main"]`, `main#main-content`, and the skip link before them.
- Live regions: loading text uses `role="status"`; errors use `role="alert"`; the update dialog's
  progress line is a `role="status"` so a screen reader hears state changes.

## 5. Outstanding

| Item                          | Why it is not done                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Screen-reader pass (NVDA)     | Needs a real Windows session with a screen reader; listed for the Week 5 review                           |
| Automated axe run             | Would come with the Playwright suite (#37), which is not started                                          |
| 200% zoom check on every page | Done by hand on Overview, Applications and Updates; History, Security insights and Settings are unchecked |
| Contrast measurement          | Tokens were chosen against the design system's pairs; no automated contrast assertion exists              |

## 6. How to check it yourself

1. Unplug the mouse. Tab from the top of every page to the bottom and back.
2. Open **Updates → Review update**. Focus should land on **Confirm**; Tab should cycle inside; Escape
   should close it and return focus to the button you pressed.
3. Narrow the window below 768px. The **Menu** button appears; opening it should trap focus, Escape
   should close it, and choosing a page should close it too.
4. Switch the theme with the top-bar control and confirm nothing becomes unreadable.
5. Zoom to 200% and check that tables scroll inside their container rather than pushing the page wide.
