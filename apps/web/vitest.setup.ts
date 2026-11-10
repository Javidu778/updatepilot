import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest does not expose globals, so Testing Library cannot register this clean-up itself.
afterEach(() => {
  cleanup();
});
