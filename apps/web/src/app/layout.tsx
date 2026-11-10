import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth/session';
import './globals.css';
import './session.css';

export const metadata: Metadata = {
  title: { default: 'UpdatePilot', template: '%s | UpdatePilot' },
  description: 'Software update intelligence and management for Windows.',
};

// Runs before first paint so a saved dark or light choice never flashes the wrong theme.
// A constant string, no user data, so inline use is safe.
const THEME_SCRIPT = `try{var t=localStorage.getItem('up-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

/**
 * The root layout holds only what every page needs: the document, the theme and the session.
 * The app chrome (sidebar, top bar) lives in the (app) group; the sign-in pages in (auth).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
