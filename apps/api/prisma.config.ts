import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The Prisma CLI does not read the app's .env; without this, every migration command in
// development would need the connection string spelled out on the command line.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Only migration commands need it; `prisma generate` runs without a database.
  datasource: { url: process.env.CONTROL_DATABASE_URL ?? '' },
});
