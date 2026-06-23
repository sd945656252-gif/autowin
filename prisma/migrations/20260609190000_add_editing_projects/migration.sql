-- CreateTable
CREATE TABLE "EditingProject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "timelineJson" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditingProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EditingProject_ownerId_updatedAt_idx" ON "EditingProject"("ownerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "EditingProject" ADD CONSTRAINT "EditingProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
