import { buildApp } from "./app.js";
import { createDeps, waitForStorage } from "./deps.js";

const deps = createDeps();
await waitForStorage(deps);
const app = await buildApp(deps);
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000) });

const shutdown = async () => {
  await app.close();
  await deps.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
