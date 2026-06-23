ALTER TABLE "NewsItem" ADD COLUMN "dateGroup" TEXT;
ALTER TABLE "NewsItem" ADD COLUMN "credibilityStatus" TEXT NOT NULL DEFAULT 'VERIFIED';
ALTER TABLE "NewsItem" ADD COLUMN "fetchedAt" TIMESTAMP(3);

UPDATE "NewsItem"
SET "dateGroup" = to_char(COALESCE("publishedAt", "createdAt") AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
WHERE "dateGroup" IS NULL;

UPDATE "NewsItem"
SET "fetchedAt" = COALESCE("updatedAt", "createdAt")
WHERE "fetchedAt" IS NULL;

CREATE INDEX "NewsItem_dateGroup_idx" ON "NewsItem"("dateGroup");
