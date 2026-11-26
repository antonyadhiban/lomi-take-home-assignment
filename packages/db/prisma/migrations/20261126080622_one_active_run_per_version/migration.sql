-- At most one queued/running extraction run per version. Prisma can't express
-- partial indexes, so this lives in raw SQL. Together with jobId = runId in
-- BullMQ and UNIQUE(versionId, field) on values, this is what makes
-- "extract the same version twice" a no-op instead of duplicate values.
CREATE UNIQUE INDEX "ExtractionRun_one_active_per_version"
  ON "ExtractionRun" ("versionId")
  WHERE status IN ('queued', 'running');
