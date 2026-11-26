-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('queued', 'extracting', 'extracted', 'failed', 'superseded');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('approved', 'corrected', 'restored', 'carried_over');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentVersionId" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'queued',
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "parsedText" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "leaseUntil" TIMESTAMP(3),
    "model" TEXT,
    "prompt" TEXT,
    "rawResponse" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedValue" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT,
    "normalizedValue" TEXT,
    "evidence" TEXT,
    "evidenceStart" INTEGER,
    "evidenceEnd" INTEGER,
    "gapReason" TEXT,
    "previousValueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,
    "kind" "ReviewKind" NOT NULL,
    "resultValue" TEXT,
    "note" TEXT,
    "reviewer" TEXT NOT NULL DEFAULT 'reviewer',
    "sourceEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");

-- CreateIndex
CREATE INDEX "DocumentVersion_status_idx" ON "DocumentVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "ExtractionRun_status_leaseUntil_idx" ON "ExtractionRun"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionRun_versionId_attempt_key" ON "ExtractionRun"("versionId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedValue_versionId_field_key" ON "ExtractedValue"("versionId", "field");

-- CreateIndex
CREATE INDEX "ReviewEvent_valueId_createdAt_idx" ON "ReviewEvent"("valueId", "createdAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedValue" ADD CONSTRAINT "ExtractedValue_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedValue" ADD CONSTRAINT "ExtractedValue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedValue" ADD CONSTRAINT "ExtractedValue_previousValueId_fkey" FOREIGN KEY ("previousValueId") REFERENCES "ExtractedValue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_valueId_fkey" FOREIGN KEY ("valueId") REFERENCES "ExtractedValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "ReviewEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
