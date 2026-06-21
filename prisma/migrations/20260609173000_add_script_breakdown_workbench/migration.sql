-- CreateEnum
CREATE TYPE "ScriptProjectSourceType" AS ENUM ('FILE', 'IDEA');

-- CreateEnum
CREATE TYPE "ScriptProjectStatus" AS ENUM ('DRAFT', 'PROCESSING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "ScriptProcessingJobType" AS ENUM ('FILE_BREAKDOWN', 'IDEA_BREAKDOWN', 'REGENERATE_IMAGE_PROMPT', 'REGENERATE_VIDEO_PROMPT', 'BULK_REGENERATE_PROMPTS', 'EXPORT_EXCEL');

-- CreateEnum
CREATE TYPE "ScriptProcessingJobStatus" AS ENUM ('QUEUED', 'PARSING', 'GENERATING', 'VALIDATING', 'SAVING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScriptProjectVersionType" AS ENUM ('SOURCE', 'AI_GENERATED', 'USER_EDITED', 'EXPORTED');

-- CreateTable
CREATE TABLE "ScriptProject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "ScriptProjectSourceType" NOT NULL,
    "sourceFileId" TEXT,
    "originalIdea" TEXT,
    "status" "ScriptProjectStatus" NOT NULL DEFAULT 'PROCESSING',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptBreakdownRow" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "shotSize" TEXT NOT NULL DEFAULT '',
    "shot" TEXT NOT NULL DEFAULT '',
    "cameraMovement" TEXT NOT NULL DEFAULT '',
    "characters" TEXT NOT NULL DEFAULT '',
    "scene" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL DEFAULT '',
    "props" TEXT NOT NULL DEFAULT '',
    "composition" TEXT NOT NULL DEFAULT '',
    "emotion" TEXT NOT NULL DEFAULT '',
    "lighting" TEXT NOT NULL DEFAULT '',
    "soundEffect" TEXT NOT NULL DEFAULT '',
    "dialogueOrVoiceover" TEXT NOT NULL DEFAULT '',
    "vfx" TEXT NOT NULL DEFAULT '',
    "duration" TEXT NOT NULL DEFAULT '',
    "motionSpeed" TEXT NOT NULL DEFAULT '',
    "dynamic" TEXT NOT NULL DEFAULT '',
    "storyboardImagePrompt" TEXT NOT NULL DEFAULT '',
    "storyboardVideoPrompt" TEXT NOT NULL DEFAULT '',
    "sourceText" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "version" INTEGER NOT NULL DEFAULT 1,
    "characterAssetIds" JSONB,
    "sceneAssetId" TEXT,
    "propAssetIds" JSONB,
    "storyboardImageAssetId" TEXT,
    "storyboardVideoAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptBreakdownRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptProjectVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "ScriptProjectVersionType" NOT NULL,
    "summary" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotJson" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptProcessingJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "ownerId" TEXT NOT NULL,
    "type" "ScriptProcessingJobType" NOT NULL,
    "status" "ScriptProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "errorMessage" TEXT,
    "inputJson" JSONB,
    "resultJson" JSONB,
    "bullJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScriptProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScriptProject_ownerId_updatedAt_idx" ON "ScriptProject"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "ScriptProject_sourceFileId_idx" ON "ScriptProject"("sourceFileId");

-- CreateIndex
CREATE INDEX "ScriptProject_status_idx" ON "ScriptProject"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptBreakdownRow_projectId_orderIndex_key" ON "ScriptBreakdownRow"("projectId", "orderIndex");

-- CreateIndex
CREATE INDEX "ScriptBreakdownRow_projectId_idx" ON "ScriptBreakdownRow"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptProjectVersion_projectId_version_key" ON "ScriptProjectVersion"("projectId", "version");

-- CreateIndex
CREATE INDEX "ScriptProjectVersion_projectId_createdAt_idx" ON "ScriptProjectVersion"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScriptProjectVersion_createdById_idx" ON "ScriptProjectVersion"("createdById");

-- CreateIndex
CREATE INDEX "ScriptProcessingJob_ownerId_createdAt_idx" ON "ScriptProcessingJob"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ScriptProcessingJob_projectId_idx" ON "ScriptProcessingJob"("projectId");

-- CreateIndex
CREATE INDEX "ScriptProcessingJob_status_idx" ON "ScriptProcessingJob"("status");

-- CreateIndex
CREATE INDEX "ScriptProcessingJob_type_idx" ON "ScriptProcessingJob"("type");

-- AddForeignKey
ALTER TABLE "ScriptProject" ADD CONSTRAINT "ScriptProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptProject" ADD CONSTRAINT "ScriptProject_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptBreakdownRow" ADD CONSTRAINT "ScriptBreakdownRow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScriptProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptProjectVersion" ADD CONSTRAINT "ScriptProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScriptProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptProcessingJob" ADD CONSTRAINT "ScriptProcessingJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScriptProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
