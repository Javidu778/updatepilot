export type AuthUser = { id: string; email: string; createdAt: Date };

export type AuthContext = {
  user: AuthUser;
  sessionId: string;
  /** Expected value of the X-CSRF-Token header for this session. */
  csrfToken: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      auth?: AuthContext;
    }
  }
}
