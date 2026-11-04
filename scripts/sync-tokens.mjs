// Copies the design tokens from docs/design/tokens.css (the single source of truth)
// into the web app. Runs automatically before `dev` and `build`.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../docs/design/tokens.css', import.meta.url));
const target = fileURLToPath(new URL('../apps/web/src/app/tokens.css', import.meta.url));

copyFileSync(source, target);
console.log('Synced design tokens: docs/design/tokens.css -> apps/web/src/app/tokens.css');
