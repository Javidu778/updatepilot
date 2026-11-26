'use client';

import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiStatus } from '@/components/ApiStatus';
import { Sidebar } from '@/components/Sidebar';
import { useFocusTrap } from '@/lib/a11y/use-focus-trap';

/**
 * The sidebar, as a fixed column on desktop and a drawer on narrow screens.
 *
 * On mobile the drawer is closed until the button is pressed, focus is moved into it, Tab stays
 * inside, Escape closes it and focus returns to the button. Navigating closes it, because a drawer
 * that stays open after you tap a link hides the page you asked for.
 */
export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  useFocusTrap(navRef, open, toggleRef);

  // A new route means the user got what they came for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="app-navigation"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden="true" size={18} /> : <Menu aria-hidden="true" size={18} />}
        {open ? 'Close menu' : 'Menu'}
      </button>

      {open ? (
        <div className="nav-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
      ) : null}

      <nav ref={navRef} id="app-navigation" className="sidebar" data-open={open} aria-label="Main">
        <Sidebar />
        <ApiStatus />
      </nav>
    </>
  );
}
