-- CreateEnum
CREATE TYPE "PipelineAssistantMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PipelineAssistantActionType" AS ENUM ('SCRIPT_CREATE_OR_UPDATE', 'SCRIPT_IMPORT_PARSE', 'DIRECTOR_PROMPT_FILL', 'DIRECTOR_PROMPT_GENERATE', 'ART_NODE_CREATE', 'ART_NODE_UPDATE', 'ART_GENERATE_START', 'SHOT_NODE_CREATE', 'SHOT_NODE_UPDATE', 'SHOT_GENERATE_START', 'EDIT_TIMELINE_UPDATE', 'EDIT_ROUGH_CUT_CREATE', 'EDIT_EFFECT_OR_AUDIO_MARKER_ADD');

-- CreateEnum
CREATE TYPE "PipelineAssistantActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "PipelineAssistantSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "stage" "ProductionStage" NOT NULL,
    "title" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineAssistantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineAssistantMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "stage" "ProductionStage" NOT NULL,
    "role" "PipelineAssistantMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentsJson" JSONB,
    "rawResponseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineAssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineAssistantAction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "messageId" TEXT,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "stage" "ProductionStage" NOT NULL,
    "type" "PipelineAssistantActionType" NOT NULL,
    "status" "PipelineAssistantActionStatus" NOT NULL DEFAULT 'PENDING',
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "previewText" TEXT NOT NULL,
    "workspaceVersion" INTEGER NOT NULL DEFAULT 1,
    "workspaceSnapshotId" TEXT,
    "executionResult" JSONB,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineAssistantAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineAssistantAttachment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "stage" "ProductionStage" NOT NULL,
    "mediaAssetId" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "parseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "parsedJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineAssistantAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineWorkspaceSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "stage" "ProductionStage" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineWorkspaceSnapshot_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "PipelineAssistantSession_projectId_stage_createdAt_idx" ON "PipelineAssistantSession"("projectId", "stage", "createdAt");
CREATE INDEX "PipelineAssistantSession_projectId_userId_idx" ON "PipelineAssistantSession"("projectId", "userId");
CREATE INDEX "PipelineAssistantSession_userId_stage_updatedAt_idx" ON "PipelineAssistantSession"("userId", "stage", "updatedAt");

CREATE INDEX "PipelineAssistantMessage_projectId_stage_createdAt_idx" ON "PipelineAssistantMessage"("projectId", "stage", "createdAt");
CREATE INDEX "PipelineAssistantMessage_projectId_userId_idx" ON "PipelineAssistantMessage"("projectId", "userId");
CREATE INDEX "PipelineAssistantMessage_sessionId_createdAt_idx" ON "PipelineAssistantMessage"("sessionId", "createdAt");

CREATE INDEX "PipelineAssistantAction_projectId_stage_createdAt_idx" ON "PipelineAssistantAction"("projectId", "stage", "createdAt");
CREATE INDEX "PipelineAssistantAction_id_status_idx" ON "PipelineAssistantAction"("id", "status");
CREATE INDEX "PipelineAssistantAction_projectId_userId_idx" ON "PipelineAssistantAction"("projectId", "userId");
CREATE INDEX "PipelineAssistantAction_status_expiresAt_idx" ON "PipelineAssistantAction"("status", "expiresAt");

CREATE INDEX "PipelineAssistantAttachment_projectId_stage_createdAt_idx" ON "PipelineAssistantAttachment"("projectId", "stage", "createdAt");
CREATE INDEX "PipelineAssistantAttachment_projectId_userId_idx" ON "PipelineAssistantAttachment"("projectId", "userId");
CREATE INDEX "PipelineAssistantAttachment_mediaAssetId_idx" ON "PipelineAssistantAttachment"("mediaAssetId");

CREATE INDEX "PipelineWorkspaceSnapshot_projectId_stage_createdAt_idx" ON "PipelineWorkspaceSnapshot"("projectId", "stage", "createdAt");
CREATE INDEX "PipelineWorkspaceSnapshot_projectId_userId_idx" ON "PipelineWorkspaceSnapshot"("projectId", "userId");

-- Foreign Keys
ALTER TABLE "PipelineAssistantSession" ADD CONSTRAINT "PipelineAssistantSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantSession" ADD CONSTRAINT "PipelineAssistantSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PipelineAssistantMessage" ADD CONSTRAINT "PipelineAssistantMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PipelineAssistantSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantMessage" ADD CONSTRAINT "PipelineAssistantMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantMessage" ADD CONSTRAINT "PipelineAssistantMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PipelineAssistantAction" ADD CONSTRAINT "PipelineAssistantAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PipelineAssistantSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantAction" ADD CONSTRAINT "PipelineAssistantAction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "PipelineAssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantAction" ADD CONSTRAINT "PipelineAssistantAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantAction" ADD CONSTRAINT "PipelineAssistantAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantAction" ADD CONSTRAINT "PipelineAssistantAction_workspaceSnapshotId_fkey" FOREIGN KEY ("workspaceSnapshotId") REFERENCES "PipelineWorkspaceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PipelineAssistantAttachment" ADD CONSTRAINT "PipelineAssistantAttachment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PipelineAssistantSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantAttachment" ADD CONSTRAINT "PipelineAssistantAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantAttachment" ADD CONSTRAINT "PipelineAssistantAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineAssistantAttachment" ADD CONSTRAINT "PipelineAssistantAttachment_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PipelineWorkspaceSnapshot" ADD CONSTRAINT "PipelineWorkspaceSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PipelineWorkspaceSnapshot" ADD CONSTRAINT "PipelineWorkspaceSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
