ALTER TABLE "MediaAsset"
ADD COLUMN "category" TEXT,
ADD COLUMN "tags" JSONB;

CREATE INDEX "MediaAsset_category_idx" ON "MediaAsset"("category");
