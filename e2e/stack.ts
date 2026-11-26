import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
export const API = process.env.E2E_API_URL ?? "http://localhost:4100";
export const compose = (args: string) =>
  execSync(`docker compose -p lomi-e2e -f docker-compose.yml -f docker-compose.e2e.yml ${args}`, { cwd: root, stdio: "inherit" });
