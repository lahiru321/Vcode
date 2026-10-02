import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` writes a SQL migration for schema changes. The app applies pending
// migrations at startup (src/main/db/index.ts).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations',
});
