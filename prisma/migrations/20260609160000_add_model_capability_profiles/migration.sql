-- CreateEnum
CREATE TYPE "ModelCapabilityVerificationStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'MANUAL_VERIFIED', 'DEPRECATED');

-- AlterTable
ALTER TABLE "CustomApiConfig"
ADD COLUMN "canonicalModelId" TEXT,
ADD COLUMN "activeCapabilityRevisionId" TEXT;

-- CreateTable
CREATE TABLE "ModelCapabilityProfile" (
    "id" TEXT NOT NULL,
    "canonicalModelId" TEXT NOT NULL,
    "officialModelId" TEXT,
    "provider" TEXT NOT NULL,
    "capability" "ModelCapability" NOT NULL,
    "aliases" JSONB NOT NULL,
    "sourceUrls" JSONB,
    "verificationStatus" "ModelCapabilityVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "activeRevisionId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelCapabilityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCapabilityRevision" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "sourceHash" TEXT,
    "changedSummary" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCapabilityRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomApiConfig_canonicalModelId_idx" ON "CustomApiConfig"("canonicalModelId");

-- CreateIndex
CREATE INDEX "CustomApiConfig_activeCapabilityRevisionId_idx" ON "CustomApiConfig"("activeCapabilityRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelCapabilityProfile_provider_capability_canonicalModelId_key" ON "ModelCapabilityProfile"("provider", "capability", "canonicalModelId");

-- CreateIndex
CREATE INDEX "ModelCapabilityProfile_capability_idx" ON "ModelCapabilityProfile"("capability");

-- CreateIndex
CREATE INDEX "ModelCapabilityProfile_canonicalModelId_idx" ON "ModelCapabilityProfile"("canonicalModelId");

-- CreateIndex
CREATE INDEX "ModelCapabilityProfile_verificationStatus_idx" ON "ModelCapabilityProfile"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ModelCapabilityRevision_profileId_revision_key" ON "ModelCapabilityRevision"("profileId", "revision");

-- CreateIndex
CREATE INDEX "ModelCapabilityRevision_profileId_idx" ON "ModelCapabilityRevision"("profileId");

-- CreateIndex
CREATE INDEX "ModelCapabilityRevision_createdById_idx" ON "ModelCapabilityRevision"("createdById");

-- AddForeignKey
ALTER TABLE "ModelCapabilityRevision" ADD CONSTRAINT "ModelCapabilityRevision_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ModelCapabilityProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
