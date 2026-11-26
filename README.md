# lomilabs-document-pipeline

Upload a PDF, and the app pulls out the values you care about (invoice totals, lease terms, market figures), each with the exact passage it came from. A reviewer checks every value against the original document and approves or corrects it. When a revised PDF arrives, only the values that actually changed come back for review.

**Live demo:** https://lomi-take-home.vercel.app

---

## Quick start

### What you need

| | |
|---|---|
| **Docker Desktop** (includes Docker Compose) | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |
| **An OpenRouter API key** | Sign in at [openrouter.ai](https://openrouter.ai), open **Keys → Create key**, and add a few dollars of credit. Reviewing a document costs a fraction of a cent. |

That's all you need to run it. Node.js and pnpm are only needed for development (see [Development](#development)).

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

1. **Documents.** All three sample documents show **Ready to review**.
2. **Open "Market report excerpt".** You see the original PDF with every extracted value boxed. Hover a box, or a field in the right-hand list, to see the value and the passage it came from. Click it to review it, then **Approve**, or **Correct** it and add a note. *Median household income* shows **Not found**, because the report doesn't mention it.
3. **Open "Invoice — Meridian Office Supplies"** and approve all five fields. The status changes to **Done**.
4. **Upload the revised invoice.** Open the version menu at the top right (**v1 · current**), choose **Upload new version…**, and pick `fixtures/documents/invoice-001.v2.pdf`. Within a few seconds, **Due date** and **Total amount** need review again, each showing its previous value. The other three keep their approval.
5. **Try your own.** Click **Upload PDF**, or drag a PDF anywhere onto the app.

---

## Configuration

Everything is configured with environment variables in `.env`. The defaults work with `docker compose`.

| Variable | Default | What it's for |
|---|---|---|
| `OPENROUTER_API_KEY` | — | **Required.** Key for the extraction model. |
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

Pushing to `main` updates everything: Vercel rebuilds the web app and Railway rebuilds the API and worker.

The worker needs a long-running process and a persistent Redis connection, which serverless platforms don't provide. Any container host works (Railway, Fly.io, ECS, Cloud Run with min instances). For lower latency, place the API, worker and database in the region closest to the client's reviewers.

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

**How a document flows through it**

1. **Upload.** The PDF is stored and the document appears immediately as *queued*.
2. **Extract.** The worker reads the PDF text and asks the model for each field and the passage it came from.
3. **Check.** A value is kept only if its passage appears word for word in the document. Anything else becomes *Not found*, with the reason.
4. **Review.** A person approves or corrects each value. Every action, including undo and redo, is kept as history.
5. **Revise.** When a new version arrives, a value whose passage and value are unchanged keeps its review. Everything else comes back for review, with the previous version beside it.

---

## Take-home assignment notes

This section covers what the [Lomi Labs brief](BRIEF.md) asks for. Longer reasoning is in [DECISIONS.md](DECISIONS.md).

### Data model

- **Document → versions → extracted values → review events.** Each version keeps its own PDF and text, so older versions stay reviewable as they were.
- **Extracted values are never edited.** Corrections are review events beside them, so what the model said and what a person decided are both kept.
- **One value per field per version** (a database constraint), so running an extraction twice can't create duplicates.

### Redis and Postgres

Postgres holds everything that matters. Redis only holds the queue of jobs to run. A background check re-queues any job Postgres says is unfinished, so losing Redis loses nothing.

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
| What counts as "unchanged" | Same value, and the old passage still appears word for word in the new version. | Fuzzy matching for heavily re-typeset documents, with a confirmation step. |
| Corrections | Kept beside the extracted value, never overwriting it; full history with undo and redo. | Reviewer accounts on every event. |
| Live updates | The page refreshes every 2s only while something is processing. | Server push if many reviewers share one document. |
| Model | OpenRouter, `openai/gpt-6-luna`: tied for best accuracy on the samples, cheapest and fastest ([comparison](packages/extraction/eval/RESULTS.md)). | Re-run the comparison on real client documents. |
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
