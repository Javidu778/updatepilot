import type { Metadata } from 'next';
import { AgentIndicator } from '@/components/AgentIndicator';
import { ApiStatus } from '@/components/ApiStatus';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'UpdatePilot', template: '%s | UpdatePilot' },
  description: 'Software update intelligence and management for Windows.',
};

// Runs before first paint so a saved dark or light choice never flashes the wrong theme.
// A constant string, no user data, so inline use is safe.
const THEME_SCRIPT = `try{var t=localStorage.getItem('up-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <div className="app-shell">
          <header className="topbar">
            <span className="brand">UpdatePilot</span>
            <div className="topbar-spacer" />
            <AgentIndicator />
            <ThemeToggle />
          </header>
          <nav className="sidebar" aria-label="Main">
            <Sidebar />
            <ApiStatus />
          </nav>
          <main id="main-content" tabIndex={-1} className="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
