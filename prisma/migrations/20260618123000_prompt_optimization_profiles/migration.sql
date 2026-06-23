-- CreateTable
CREATE TABLE "PromptOptimizationProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "defaultSystemPrompt" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptOptimizationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptOptimizationProfile_key_key" ON "PromptOptimizationProfile"("key");

-- CreateIndex
CREATE INDEX "PromptOptimizationProfile_isEnabled_sortOrder_idx" ON "PromptOptimizationProfile"("isEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX "PromptOptimizationProfile_updatedById_idx" ON "PromptOptimizationProfile"("updatedById");

-- AddForeignKey
ALTER TABLE "PromptOptimizationProfile" ADD CONSTRAINT "PromptOptimizationProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
