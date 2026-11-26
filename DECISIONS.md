# Decisions log

Living record of the open calls in the brief, what was chosen, and why.
The final README summarizes these; this file keeps the reasoning.

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | Hosting | **Web UI on Vercel; API + worker + Postgres + Redis on Railway** | BullMQ needs a long-running worker and a persistent Redis connection, which Vercel functions can't provide. Railway runs the same Docker images as `docker compose`. |
| 2 | Repo | Public `antonyadhiban/lomi-take-home-assignment`; Lomi's repo kept as `upstream` | Reviewers can open it; the original brief commit stays in history. |
| 3 | LLM | **OpenRouter** (OpenAI-compatible API, strict JSON-schema output); default model **`openai/gpt-6-luna`**, overridable via `EXTRACTION_MODEL` | Picked from a recorded eval (`pnpm eval:models`, results in `packages/extraction/eval/RESULTS.md`): 8 models × 4 fixtures × 2 runs, scored after the real evidence validation. 7 of 8 scored 100%, so the fixtures don't separate models on accuracy. Luna was the cheapest ($0.00019/doc) and among the fastest (2.7s p50), with 100% run-to-run consistency. Since the evidence check turns any bad output into a gap rather than a wrong value, a cheap model's failure mode is extra review work, not silent errors. Revisit with a harder test set before trusting it on messier real documents. |
| 4 | Frameworks | **Next.js** (UI) + **Fastify** (API) + separate BullMQ **worker** process | Matches the JD; Fastify is lean and typed. API and worker scale and restart independently. |
| 5 | ORM | **Prisma 7** (driver adapter `@prisma/adapter-pg`) | The JD says Lomi uses Prisma heavily. Constraints Prisma can't express (partial unique index) go in raw SQL migrations. |
| 6 | Correction model | **Immutable extracted value + append-only review events** ("Google Docs" model) | The LLM's output and evidence are never edited, so provenance survives. Every human action (approve / correct / restore) is an event; the latest event is the effective state. The UI shows the effective value inline and highlighted, with the LLM's original on hover, a per-value history drawer, and undo/redo that append `restored` events. No document-wide Cmd+Z stack. |
| 7 | "Unchanged" between versions | **Same canonical value AND the prior version's evidence passage still appears verbatim (normalized) in the new text** | Doesn't depend on positions, so inserted paragraphs and reflow don't matter, and it doesn't rely on the LLM picking the identical quote twice (v2 of the invoice repeats "2025-09-14" in a new sentence). Gaps never carry over. Fuzzy matching was rejected: it can wave through `$5,230` vs `$5,280`. |
| 8 | New version while previous is extracting | **Supersede** | v(N+1) is accepted at once and vN is marked `superseded`. The worker checks before commit that its version is still current, so a late result for vN is discarded. Carry-over diffs against the last *extracted* version. |
| 9 | UI freshness | **Poll every 2s only while something is queued/extracting** (TanStack Query) | Extraction takes seconds and there are few concurrent reviewers. SSE would add pub/sub fan-out and cross-origin long-lived connections for no real gain. |
| 10 | Redis ↔ Postgres consistency | **Postgres is truth + reconciler** | `ExtractionRun` (status, attempt, lease) lives in Postgres. On boot and every 30s the worker re-enqueues runs that are `queued`, or `running` with an expired lease. BullMQ `jobId = runId` makes re-enqueue idempotent. This covers restarts, killed containers and `FLUSHALL`. |
| 11 | API access from the browser | **Browser calls the Railway API directly**; CORS allowlist via `CORS_ORIGINS` | No Vercel body-size limit on PDF uploads; the API is a plain public service. `NEXT_PUBLIC_API_URL` is set at build time. |
| 12 | File storage | **S3-compatible object storage from day one**; parsed text per version stored in Postgres | Originals in S3 (SeaweedFS locally, since MinIO no longer publishes images; S3/R2 in prod). Parsed text lives in Postgres because evidence validation and the review UI for version N must always use version N's text. |
| 13 | Tests | **Vitest** (unit + integration against real Postgres/Redis, fake LLM provider) + **Playwright** e2e against an isolated stack with a deterministic fake LLM | Unit: normalization, evidence, carry-over, undo/redo replay. Integration: duplicate runs, crash mid-extract, FLUSHALL, supersede, review history. E2E: seeded list, gap reason, PDF evidence boxes, v1 → v2 carry-over, undo/redo across reloads. |

## Idempotency layers (decision 10, in detail)

1. `UNIQUE(versionId, field)` on `ExtractedValue`: a second commit for the same version can't insert duplicates.
2. Partial unique index: at most one `queued`/`running` run per version.
3. BullMQ `jobId = runId`: enqueuing the same run twice is a no-op.
4. The commit is one Postgres transaction: values, carry-over review events, run → `succeeded`, version → `extracted`.

## Monorepo layout

```
apps/web          Next.js review UI (Vercel)
apps/api          Fastify HTTP API (Railway)
apps/worker       BullMQ worker + reconciler (Railway)
packages/core     pure domain: field defs, normalization, evidence check, carry-over rule
packages/services transport-agnostic use cases: upload/version/retry, extraction run, reconciler, reads, reviews, seed
packages/db       Prisma schema, migrations, client, seed
packages/queue    BullMQ queue name, job type, Redis connection
packages/storage  S3 client wrapper
packages/extraction  PDF parsing + LLM provider interface (OpenRouter) + model eval
packages/tsconfig, packages/eslint-config  shared tooling
```

`apps/api` and `apps/worker` are thin adapters (HTTP, BullMQ) over `services`, so integration tests drive the real logic against real Postgres/Redis without HTTP or a live worker. `core` has no I/O, so the rules the brief tests most heavily (hallucination defense, carry-over) are unit-testable in milliseconds.

## Recovery timing

A run whose worker died stays `extracting` until its lease (60s, extended every 20s by a live worker's heartbeat) expires; the reconciler (every 30s, and on boot) then re-enqueues it. Worst case about 90s from crash to re-extraction. Measured: kill the worker mid-extraction, `FLUSHALL`, `docker compose restart` → extracted in 64s. A run whose worker died 3 times is marked `failed` (retryable) instead of looping forever.

## Verified behaviours (integration tests in `packages/services/test`)

- upload returns before extraction; a queued run is in Postgres and a job in Redis
- concurrent / repeated processing of the same run → one commit, no duplicate values
- hallucinated evidence → gap with reason
- LLM failure → `failed` with error, retryable; a double retry is rejected
- expired lease → reclaimed; live lease → not stolen; stale commit after takeover → discarded
- invoice v1 → v2: exactly `due_date` and `total_amount` back to pending, with previous value/review; corrections carry over; v1 stays queryable with its own text
- new version while previous queued or mid-LLM-call → previous superseded, its result discarded
- reconciler after Redis loss → re-enqueued exactly once, including when BullMQ retained a finished job with the same id
- reviews: corrections validated by type, restore/reset (undo), optimistic concurrency, old versions read-only

## Deployment (live)

- **Web:** https://lomi-take-home.vercel.app (Vercel), connected to GitHub: every push to `main` deploys. Root directory `apps/web`; the build runs through turbo from the repo root (`apps/web/vercel.json`).
- **API:** https://api-production-7892467b.up.railway.app (Railway). Migrations + idempotent fixture seed run on start (`RUN_MIGRATIONS=true`).
- **Worker, Postgres, Redis, object storage:** the same Railway project, over private networking. PDFs live in a Railway bucket (S3-compatible, virtual-host URLs), so the storage code is identical to local dev.
- **CORS:** the API allows only the Vercel origin.
- **Redeploy:** `railway up --service api|worker`; web: `npx vercel@latest build --prod && npx vercel@latest deploy --prebuilt --prod`.
