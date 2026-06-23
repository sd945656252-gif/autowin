ALTER TABLE "MediaAsset"
ADD COLUMN "originalName" TEXT,
ADD COLUMN "fileHash" TEXT;

UPDATE "MediaAsset"
SET "originalName" = "metadata"->>'originalName'
WHERE "originalName" IS NULL
  AND "metadata" IS NOT NULL
  AND "metadata" ? 'originalName';

CREATE INDEX "MediaAsset_fileHash_idx" ON "MediaAsset"("fileHash");
CREATE UNIQUE INDEX "MediaAsset_ownerId_fileHash_sizeBytes_originalName_key"
ON "MediaAsset"("ownerId", "fileHash", "sizeBytes", "originalName");
