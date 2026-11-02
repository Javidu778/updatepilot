import { config } from 'dotenv';

// Loads the repo-root .env. Run the API through the npm scripts so the working
// directory is apps/api. Import this file first in server.ts.
config({ path: '../../.env' });
