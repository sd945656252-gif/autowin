CREATE TYPE "ShowcaseWorkStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "ShowcaseWork" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "videoUrl" TEXT,
  "coverUrl" TEXT,
  "fileKey" TEXT,
  "storageKey" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" "ShowcaseWorkStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdById" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShowcaseWork_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShowcaseWork_key_key" ON "ShowcaseWork"("key");
CREATE INDEX "ShowcaseWork_status_sortOrder_idx" ON "ShowcaseWork"("status", "sortOrder");
CREATE INDEX "ShowcaseWork_createdById_idx" ON "ShowcaseWork"("createdById");

ALTER TABLE "ShowcaseWork"
ADD CONSTRAINT "ShowcaseWork_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ShowcaseWork" (
  "id",
  "key",
  "title",
  "category",
  "videoUrl",
  "sortOrder",
  "status",
  "metadata",
  "updatedAt"
)
SELECT
  'showcase_' || "key",
  "key",
  "title",
  "category",
  "url",
  CASE
    WHEN "key" = 'mv' THEN 10
    WHEN "key" = 'sword' THEN 20
    WHEN "key" = 'santi' THEN 30
    WHEN "key" LIKE 'extra-%' THEN 100 + COALESCE(NULLIF(split_part("key", '-', 2), ''), '0')::INTEGER
    ELSE 1000
  END,
  CASE WHEN "url" IS NULL THEN 'DRAFT'::"ShowcaseWorkStatus" ELSE 'PUBLISHED'::"ShowcaseWorkStatus" END,
  COALESCE("metadata", '{}'::jsonb),
  "updatedAt"
FROM "VideoRegistryItem"
ON CONFLICT ("key") DO NOTHING;
