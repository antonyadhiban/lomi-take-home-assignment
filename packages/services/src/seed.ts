import { readFile } from "node:fs/promises";
import path from "node:path";
import { createDocument } from "./documents.js";
import type { Deps } from "./deps.js";

interface ManifestEntry {
  id: string;
  type: string;
  title: string;
  versions: { version: number; file: string }[];
}

/** Seeds version 1 of each fixture document. Idempotent: existing ids are skipped. */
export async function seedFixtures(deps: Deps, fixturesDir: string) {
  const manifest = JSON.parse(await readFile(path.join(fixturesDir, "documents.json"), "utf8")) as ManifestEntry[];
  const created: string[] = [];
  for (const entry of manifest) {
    if (await deps.prisma.document.findUnique({ where: { id: entry.id } })) continue;
    const v1 = entry.versions.find((v) => v.version === 1);
    if (!v1) continue;
    const file = new Uint8Array(await readFile(path.join(fixturesDir, v1.file)));
    await createDocument(deps, { id: entry.id, type: entry.type, title: entry.title, file });
    created.push(entry.id);
  }
  return created;
}
