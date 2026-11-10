import { ThemeToggle } from '@/components/ThemeToggle';

/** A clean layout for sign-in and registration: no sidebar, no navigation into the app. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div className="auth-shell">
        <header className="auth-header">
          <span className="brand">UpdatePilot</span>
          <ThemeToggle />
        </header>
        <main id="main-content" tabIndex={-1} className="auth-main">
          {children}
        </main>
      </div>
    </>
  );
}
