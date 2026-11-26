import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { DOCUMENT_TYPES } from "@lomi/core";
import {
  addVersion,
  applyReview,
  createDocument,
  getDocument,
  getProgress,
  listDocuments,
  retryExtraction,
  ServiceError,
  type Deps,
  type ReviewAction,
} from "@lomi/services";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Reads a multipart upload: one `file` part plus text fields. */
async function readUpload(req: FastifyRequest) {
  const fields: Record<string, string> = {};
  let file: Uint8Array | undefined;
  for await (const part of req.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        await part.toBuffer();
        continue;
      }
      file = new Uint8Array(await part.toBuffer());
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  if (!file?.length) throw new ServiceError(400, "multipart field `file` (a PDF) is required");
  return { fields, file };
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim());
  await app.register(cors, { origin: origins });
  await app.register(multipart, { limits: { fileSize: MAX_PDF_BYTES, files: 1 } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ServiceError) return reply.status(err.status).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.code === "FST_REQ_FILE_TOO_LARGE") return reply.status(413).send({ error: "PDF is larger than 20 MB" });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: "internal error" });
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/document-types", async () => ({ types: DOCUMENT_TYPES }));

  // Upload: stores the PDF, records a queued run in Postgres, enqueues, and
  // returns 202 immediately. The LLM is never on the request path.
  app.post("/documents", async (req, reply) => {
    const { fields, file } = await readUpload(req);
    const doc = await createDocument(deps, { type: fields.type ?? "", title: fields.title, file });
    return reply.status(202).send(await getDocument(deps, doc.id));
  });

  app.post<{ Params: { id: string } }>("/documents/:id/versions", async (req, reply) => {
    const { file } = await readUpload(req);
    const { duplicate } = await addVersion(deps, req.params.id, file);
    const body = await getDocument(deps, req.params.id);
    return reply.status(duplicate ? 200 : 202).send({ ...body, duplicate });
  });

  app.get("/documents", async () => ({ documents: await listDocuments(deps) }));

  app.get<{ Params: { id: string }; Querystring: { version?: string } }>("/documents/:id", async (req) => {
    const v = req.query.version;
    if (v !== undefined && !/^\d+$/.test(v)) throw new ServiceError(400, "version must be a positive integer");
    return getDocument(deps, req.params.id, v === undefined ? undefined : Number(v));
  });

  app.get<{ Params: { id: string } }>("/documents/:id/progress", async (req) => getProgress(deps, req.params.id));

  app.post<{ Params: { id: string } }>("/documents/:id/retry", async (req, reply) => {
    await retryExtraction(deps, req.params.id);
    return reply.status(202).send(await getDocument(deps, req.params.id));
  });

  app.post<{
    Params: { id: string };
    Body: ReviewAction & { reviewer?: string; expectedLatestEventId?: string | null };
  }>(
    "/values/:id/review",
    {
      schema: {
        body: {
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["approve", "correct", "restore", "reset"] },
            value: { type: "string" },
            note: { type: "string" },
            eventId: { type: "string" },
            reviewer: { type: "string" },
            expectedLatestEventId: { type: ["string", "null"] },
          },
        },
      },
    },
    async (req) => {
      const event = await applyReview(deps, req.params.id, req.body);
      return { event };
    },
  );

  return app;
}
