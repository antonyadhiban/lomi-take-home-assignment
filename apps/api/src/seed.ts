import path from "node:path";
import { seedFixtures } from "@lomi/services";
import { createDeps, waitForStorage } from "./deps.js";

const fixturesDir = process.env.FIXTURES_DIR ?? path.resolve(import.meta.dirname, "../../../fixtures");
const deps = createDeps();
await waitForStorage(deps);
const created = await seedFixtures(deps, fixturesDir);
console.log(created.length ? `seeded: ${created.join(", ")}` : "seed: nothing to do (already seeded)");
await deps.close();
