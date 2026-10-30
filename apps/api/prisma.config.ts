import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env files automatically.
// Run db commands through the npm scripts so the working directory is apps/api.
config({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
