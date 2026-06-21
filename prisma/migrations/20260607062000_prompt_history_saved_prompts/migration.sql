-- CreateTable
CREATE TABLE "PromptHistoryItem" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "featureMode" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mode" TEXT,
    "duration" TEXT,
    "techniques" JSONB,
    "styles" JSONB,
    "promptCount" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptHistoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptHistoryAttachment" (
    "id" TEXT NOT NULL,
    "historyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptHistoryAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedPrompt" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptHistoryItem_ownerId_createdAt_idx" ON "PromptHistoryItem"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptHistoryAttachment_historyId_idx" ON "PromptHistoryAttachment"("historyId");

-- CreateIndex
CREATE INDEX "SavedPrompt_ownerId_createdAt_idx" ON "SavedPrompt"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "PromptHistoryAttachment" ADD CONSTRAINT "PromptHistoryAttachment_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "PromptHistoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
