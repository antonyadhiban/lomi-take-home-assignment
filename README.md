# Lomi Labs document review

Review invoice, lease, and market-report fields against the passage an LLM extracted them from. When a revised PDF arrives, the app carries forward eligible reviews and shows what needs a fresh decision.

[Open the live demo](https://lomi-take-home.vercel.app)

## Quick start

Install Docker with Compose and provide an OpenRouter API key for extraction. Reviewing existing values makes no model calls.

### Run it

```sh
git clone https://github.com/antonyadhiban/lomi-take-home-assignment.git lomilabs-document-pipeline
cd lomilabs-document-pipeline
cp .env.example .env          # then paste your key after OPENROUTER_API_KEY=
docker compose up
```

The first start takes a few minutes while the images build. Then open **http://localhost:3000**.

Three sample documents are loaded on first start and processed automatically.

To stop the app, press `Ctrl+C` or run `docker compose down`; your data is kept. To start over with fresh sample documents, run `docker compose down -v`.

### Your first review

1. Open **Invoice — Meridian Office Supplies** when its status reaches **Ready to review**. Select **Total amount** in the list or on the PDF. The card shows the extracted value and its **Source passage**. **Show in document** locates the highlighted text.
2. **Approve** the five invoice fields. To try a correction, choose **Correct**, enter a value and optional note, then **Save**. **Undo** and **Redo** step through the selected field’s decisions, including after a reload.
3. Open the version selector at the top right. Choose **Upload** in the menu header and select [the revised invoice](fixtures/documents/invoice-001.v2.pdf). **Due date** and **Total amount** return to review. The other three approvals carry over.
4. Select **Total amount** and open **Compare passages** to see what changed in the source. Choose **v1** from the version menu to inspect the earlier approval in read-only mode.
5. Open **Market report excerpt** and select **Median household income** to see a missing field and its reason. To try a new document, use **Upload PDF** above the dashboard table. On a document page, dropping a file adds a version to that document.


---

## Configuration

Everything is configured with environment variables in `.env`. The defaults work with `docker compose`.

| Variable | Default | What it's for |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Required for the OpenRouter provider. |
| `EXTRACTION_MODEL` | `openai/gpt-6-luna` | Any [OpenRouter model](https://openrouter.ai/models) that supports structured output. |
| `EXTRACTION_PROVIDER` | `openrouter` | Set to `fake` for a deterministic offline mode (used by the end-to-end tests). |
| `DATABASE_URL` | local Postgres | PostgreSQL connection string. |
| `REDIS_URL` | local Redis | Redis connection string (job queue only). |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | local storage | Any S3-compatible storage for the original PDFs (AWS S3, Cloudflare R2, Railway buckets…). |
| `CORS_ORIGINS` | `http://localhost:3000` | Web origins allowed to call the API. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API address the web app calls; baked in at build time. |

---

## Deployment

The live demo runs as two halves:

| Part | Where | Notes |
|---|---|---|
| Web app (`apps/web`) | Vercel | Deploys automatically on every push to `main`. Root directory `apps/web`; needs `NEXT_PUBLIC_API_URL`. |
| API, worker, Postgres, Redis, PDF storage | Railway | API and worker deploy automatically on every push to `main`, both built from the same `Dockerfile` (`APP=api` / `APP=worker`). `RUN_MIGRATIONS=true` on the API runs migrations and the sample seed on start. |

The worker runs continuously to process jobs and reconcile unfinished runs.

---

## Development

Requires Node.js 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
docker compose up -d postgres redis s3 migrate   # infrastructure only
pnpm dev                                         # api :4000, worker, web :3000 with hot reload
```

| Command | What it does |
|---|---|
| `pnpm test` | Unit and integration tests (needs Postgres and Redis from the command above). |
| `pnpm test:e2e` | Playwright browser tests against a separate, throwaway stack (ports 3100/4100, offline model). First time only: `pnpm --filter @lomi/e2e exec playwright install chromium`. |
| `pnpm lint` / `pnpm typecheck` | Across every package. |
| `pnpm eval:models` | Compares extraction models on the sample documents ([latest results](packages/extraction/eval/RESULTS.md)). |

Tasks run through Turborepo, so each one builds only what it depends on and reuses cached results.

---

## Architecture

- **Monorepo:** pnpm workspaces + Turborepo
- **Web:** Next.js, React, Tailwind CSS, shadcn/ui, pdf.js
- **API:** Fastify (Node.js, TypeScript)
- **Worker:** BullMQ job processor
- **Database:** PostgreSQL via Prisma
- **Queue:** Redis
- **Storage:** S3-compatible object storage
- **AI:** OpenRouter (structured output)

```
apps/
  web          The review app
  api          HTTP API
  worker       Runs extractions in the background
packages/
  core         Business rules: field definitions, evidence checks, carry-over, undo/redo
  services     Everything the API and worker do (upload, extract, review, recover)
  db           Database schema and migrations
  extraction   PDF reading, the extraction prompt, model providers, model comparison
  queue        Job queue setup
  storage      File storage client
e2e            Browser tests (Playwright)
fixtures       Sample documents
```

The API stores the original PDF, creates a queued extraction run, and returns. A worker parses the version’s text, calls the model, and validates each quoted passage. Matching normalizes whitespace, Unicode and typographic punctuation while preserving case and digits. Missing or rejected evidence produces a gap with a reason. Each run stores its prompt and raw response for debugging.

The API and worker share the use cases in `packages/services`. Domain rules in `packages/core` run without a database or a model. The [decision record](DECISIONS.md) explains the boundaries and trade-offs against the [assignment brief](BRIEF.md).

### Data model

- **Document → versions → extracted values → review events.** Each version keeps its own PDF and text, so older versions remain available for read-only inspection.
- **Extracted values are never edited.** Corrections are review events beside them, so what the model said and what a person decided are both kept.
- **One value per field per version** (a database constraint), so running an extraction twice can't create duplicates.

### Redis and Postgres

Postgres holds parsed text, values, reviews, and extraction outcomes. Object storage holds the original PDFs. Redis coordinates jobs. On startup and at intervals, the reconciler uses Postgres to requeue eligible unfinished runs. A worker claims each run with an expiring lease. Committing the values, carry-over decisions, and final run status in one transaction keeps retries consistent.

| What happens | Result |
|---|---|
| Upload | Responds immediately; extraction runs in the background. |
| Worker or container restarts mid-extraction | The document is picked up again automatically (measured: done 64s after a crash). |
| Redis is wiped (`FLUSHALL`) | Jobs are re-queued from Postgres; no values or reviews are lost. |
| Same version extracted twice | Only one result is ever saved. |
| The model or the PDF fails | The document shows **Failed** with the reason and a **Retry** button. |

### Decisions

| Decision | Choice | Later |
|---|---|---|
| New version while one is extracting | The newer version replaces it; the unfinished one is marked superseded. | Optionally let the older version finish for comparison. |
| What counts as "unchanged" | The normalized value matches and the previously reviewed passage still occurs in the new text after normalization, at any position. Gaps need a fresh decision. | Fuzzy matching for heavily re-typeset documents, with a confirmation step. |
| Corrections | Kept beside the extracted value, never overwriting it; full history with undo and redo. | Reviewer accounts on every event. |
| Live updates | The UI polls document status every two seconds during processing and refreshes stale data on window focus. | Server push if many reviewers share one document. |
| Model | OpenRouter, `openai/gpt-6-luna`: tied for best fixture accuracy at the lowest measured cost ([comparison](packages/extraction/eval/RESULTS.md)). | Re-run the comparison on real client documents. |
| Hosting | Web on Vercel; API, worker and data on Railway. | The client's own cloud (AWS or GCP), set up with Terraform. |

### Performance

| Event | Measured |
|---|---|
| API response, server time | 10–40 ms |
| API response from Asia to the US East region | ~400 ms (network distance) |
| Upload accepted | ~35 ms locally, under 1 s on the live demo |
| Extraction per document | ~3 s |
| Recovery after a worker crash | up to ~90 s (64 s measured) |

In production, the services should run in the region closest to the client's reviewers.

### Tests

- **Unit:** evidence checks, carry-over, undo/redo replay, the offline model against every sample.
- **Integration** (real Postgres and Redis): duplicate runs, crash recovery, Redis loss, superseded versions, review history.
- **End-to-end** (Playwright): the walkthrough above, including uploading the revised invoice and undo/redo surviving a reload.

### Not done yet

- **Scanned PDFs.** A PDF with no text layer currently fails with a clear message. A vision model could read it, but then the model would also write the text its quotes are checked against, which defeats the check. The plan is OCR (e.g. Tesseract) to create a real text layer first, then run the same pipeline.
- **CI.** Tests run locally. A GitHub Actions workflow with Postgres and Redis would be set up when deploying for a client.
- **Accounts and permissions.** Reviews are attributed to a single "reviewer" for now.
- **At 10,000 documents:** paginate the document list and store review progress per version, add rate-limit-aware retries for the model, use OpenRouter batch pricing for backfills, and separate data per client.

The interface's visual style references [Midday](https://github.com/midday-ai/midday). No Midday code is used (it's AGPL-licensed); components are [shadcn/ui](https://ui.shadcn.com) (MIT).
