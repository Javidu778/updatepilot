import {
  AppWindow,
  History,
  LayoutDashboard,
  RefreshCw,
  Settings,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** The six sections from docs/wireframes.md. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/applications', label: 'Applications', icon: AppWindow },
  { href: '/updates', label: 'Updates', icon: RefreshCw },
  { href: '/security', label: 'Security insights', icon: ShieldAlert },
  { href: '/history', label: 'History', icon: History },
  { href: '/settings', label: 'Settings & agent', icon: Settings },
];
