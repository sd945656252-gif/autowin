-- Preserve approved team assets when a production project is deleted.
-- Project-specific work records can still be cleaned up by application code,
-- but approved files should remain available in the global team asset library.
ALTER TABLE "ProductionAsset"
  DROP CONSTRAINT IF EXISTS "ProductionAsset_projectId_fkey";

ALTER TABLE "ProductionAsset"
  ADD CONSTRAINT "ProductionAsset_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
