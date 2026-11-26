import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the real UI against a real, isolated stack
 * (docker-compose.e2e.yml: own volumes, ports 3100/4100, deterministic fake LLM).
 * Global setup builds and starts it; teardown removes it (E2E_KEEP=1 keeps it).
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1, // one shared stack and seed data
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
