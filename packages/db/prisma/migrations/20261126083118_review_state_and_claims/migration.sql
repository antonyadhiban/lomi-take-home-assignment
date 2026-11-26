/*
  Warnings:

  - Added the required column `state` to the `ReviewEvent` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('pending', 'approved', 'corrected');

-- AlterTable
ALTER TABLE "ExtractionRun" ADD COLUMN     "claimToken" TEXT,
ADD COLUMN     "claims" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReviewEvent" ADD COLUMN     "state" "ReviewState" NOT NULL;
