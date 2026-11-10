import { AgentIndicator } from '@/components/AgentIndicator';
import { ApiStatus } from '@/components/ApiStatus';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/UserMenu';

/** The application chrome. Everything inside is shown only to a signed-in user. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="app-shell">
        <header className="topbar">
          <span className="brand">UpdatePilot</span>
          <div className="topbar-spacer" />
          <AgentIndicator />
          <ThemeToggle />
          <UserMenu />
        </header>
        <nav className="sidebar" aria-label="Main">
          <Sidebar />
          <ApiStatus />
        </nav>
        <main id="main-content" tabIndex={-1} className="main">
          {children}
        </main>
      </div>
    </RequireAuth>
  );
}
