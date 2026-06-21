-- Add a normalized capability for custom model providers while preserving the legacy type field.
CREATE TYPE "ModelCapability" AS ENUM ('TEXT_GENERATOR', 'IMAGE_GENERATOR', 'VIDEO_GENERATOR');

ALTER TABLE "CustomApiConfig"
  ADD COLUMN "capability" "ModelCapability" NOT NULL DEFAULT 'TEXT_GENERATOR';

UPDATE "CustomApiConfig"
SET "capability" = CASE
  WHEN lower("type") = 'image' THEN 'IMAGE_GENERATOR'::"ModelCapability"
  WHEN lower("type") = 'video' THEN 'VIDEO_GENERATOR'::"ModelCapability"
  ELSE 'TEXT_GENERATOR'::"ModelCapability"
END;

CREATE INDEX "CustomApiConfig_capability_idx" ON "CustomApiConfig"("capability");
