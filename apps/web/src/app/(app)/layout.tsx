import { AgentIndicator } from '@/components/AgentIndicator';
import { AppSidebar } from '@/components/AppSidebar';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/UserMenu';
import { DevicesProvider } from '@/lib/devices/devices-context';

/** The application chrome. Everything inside is shown only to a signed-in user. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <DevicesProvider>
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
          <AppSidebar />
          <main id="main-content" tabIndex={-1} className="main">
            {children}
          </main>
        </div>
      </DevicesProvider>
    </RequireAuth>
  );
}
