import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // one shared test database: run files sequentially
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
