import { API, compose } from "./stack";

/** Fresh stack every run (seeded fixtures, nothing reviewed), then wait until v1 of each fixture is extracted. */
export default async function setup() {
  if (process.env.E2E_BASE_URL) return; // pointing at an existing deployment
  compose("down -v --remove-orphans");
  compose("up -d --build");
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const res = await fetch(`${API}/documents`);
      const { documents } = (await res.json()) as { documents: { status: string }[] };
      if (documents.length >= 3 && documents.every((d) => d.status === "extracted")) return;
    } catch {
      /* still starting */
    }
    if (Date.now() > deadline) throw new Error("e2e stack did not become ready in 3 minutes");
    await new Promise((r) => setTimeout(r, 2000));
  }
}
