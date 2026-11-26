'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Every focusable control inside the container.
 *
 * No visibility filtering: `offsetParent` is null for anything with `position: fixed` (which this
 * dialog is) and is not implemented in jsdom at all, so filtering on it silently produced an empty
 * list and broke the wrap. Controls that should be unreachable are marked `disabled`, which the
 * selector already excludes.
 */
function focusableInside(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Keeps keyboard focus inside an open dialog and gives it back when the dialog closes.
 *
 * Without this, Tab walks out of the dialog and into the page behind it: the user ends up typing
 * into something they cannot see, which is one of the worst keyboard failures a modal can have.
 *
 * On open: remembers what was focused, then focuses the first control inside (or `initialFocus`).
 * While open: Tab and Shift+Tab cycle. On close: focus returns to where it came from.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const initial = initialFocusRef?.current ?? focusableInside(container)[0] ?? container;
    // A dialog with no focusable child still needs focus, or the trap has nowhere to start.
    if (initial === container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = focusableInside(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Returning focus matters: closing must not dump the user at the top of the page.
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef, initialFocusRef]);
}
