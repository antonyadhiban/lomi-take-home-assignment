import { execSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

/** Creates the test database if needed and applies migrations to it. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://lomi:lomi@localhost:5432/lomi_test");
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!exists.rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  execSync("pnpm exec prisma migrate deploy", {
    cwd: path.resolve(import.meta.dirname, "../../db"),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
  });
  process.env.TEST_DATABASE_URL = url.toString();
}
