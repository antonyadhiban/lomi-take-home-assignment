import { compose } from "./stack";

export default async function teardown() {
  if (process.env.E2E_BASE_URL || process.env.E2E_KEEP) return;
  compose("down -v --remove-orphans");
}
