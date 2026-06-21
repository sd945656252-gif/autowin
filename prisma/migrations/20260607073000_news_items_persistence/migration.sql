ALTER TABLE "NewsItem" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN "category" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

WITH keyed AS (
  SELECT
    "id",
    md5(
      coalesce("title", '') || ':' ||
      coalesce("source", '') || ':' ||
      coalesce("url", '') || ':' ||
      coalesce("publishedAt"::text, '')
    ) AS base_key
  FROM "NewsItem"
),
ranked AS (
  SELECT
    "id",
    base_key,
    row_number() OVER (PARTITION BY base_key ORDER BY "id") AS rn
  FROM keyed
)
UPDATE "NewsItem" AS n
SET "dedupeKey" = CASE
  WHEN ranked.rn = 1 THEN ranked.base_key
  ELSE ranked.base_key || '-' || n."id"
END
FROM ranked
WHERE n."id" = ranked."id";

ALTER TABLE "NewsItem" ALTER COLUMN "dedupeKey" SET NOT NULL;

CREATE UNIQUE INDEX "NewsItem_dedupeKey_key" ON "NewsItem"("dedupeKey");
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");
