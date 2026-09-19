import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Only migration commands need it; `prisma generate` runs without a database.
  datasource: { url: process.env.CONTROL_DATABASE_URL ?? '' },
});
