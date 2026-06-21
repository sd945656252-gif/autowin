ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "lastAccessedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "MediaAsset_lastAccessedAt_idx" ON "MediaAsset"("lastAccessedAt");
CREATE INDEX IF NOT EXISTS "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");
