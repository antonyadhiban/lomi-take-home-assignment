import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim());
  await app.register(cors, { origin: origins });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  app.get("/health", async () => ({ ok: true }));
  // Routes (POST /documents, /documents/:id/versions, GET /documents/:id,
  // /documents/:id/progress, POST /values/:id/review) land next.
  return app;
}
