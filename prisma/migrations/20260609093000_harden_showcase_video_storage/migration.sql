UPDATE "ShowcaseWork"
SET
  "storageKey" = COALESCE(
    "storageKey",
    CASE
      WHEN "videoUrl" LIKE '/uploads/%' THEN split_part("videoUrl", '/uploads/', 2)
      WHEN "videoUrl" LIKE '%/uploads/%' THEN split_part("videoUrl", '/uploads/', 2)
      ELSE NULL
    END
  ),
  "fileKey" = COALESCE(
    "fileKey",
    CASE
      WHEN "videoUrl" LIKE '/uploads/%' THEN split_part("videoUrl", '/uploads/', 2)
      WHEN "videoUrl" LIKE '%/uploads/%' THEN split_part("videoUrl", '/uploads/', 2)
      ELSE NULL
    END
  ),
  "videoUrl" = NULL
WHERE "videoUrl" LIKE '/uploads/%' OR "videoUrl" LIKE '%/uploads/%';
