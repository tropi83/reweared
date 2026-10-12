import { defineConfig } from "vitest/config";

// Docker-backed integration tests (`pnpm test:integration`): Testcontainers starts Postgres and Redis once,
// the committed migrations are applied, then the files run one after the other against them.
export default defineConfig({
  test: {
    name: "server-integration",
    root: import.meta.dirname,
    environment: "node",
    include: ["test/**/*.int.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
