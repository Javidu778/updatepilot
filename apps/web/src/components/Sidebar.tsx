'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/nav';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <ul className="nav-list">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <li key={href}>
            <Link href={href} className="nav-link" aria-current={active ? 'page' : undefined}>
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
