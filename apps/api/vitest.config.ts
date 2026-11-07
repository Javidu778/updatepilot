import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      // Test-only value, so code that reads SESSION_SECRET works without a real .env (for example in CI).
      SESSION_SECRET: 'test-only-secret-not-for-real-use-0123456789abcdef',
    },
  },
});
