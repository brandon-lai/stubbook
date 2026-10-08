import { defineConfig } from "vitest/config";
// Needs the dev server (pnpm dev) with DATABASE_URL pointing at a migrated database.
export default defineConfig({ test: { include: ["tests/integration/**/*.test.ts"], testTimeout: 30000, fileParallelism: false } });
