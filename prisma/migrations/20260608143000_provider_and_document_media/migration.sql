-- Add provider metadata to model configs and rename generic file media to DOCUMENT.
ALTER TYPE "MediaAssetType" RENAME VALUE 'FILE' TO 'DOCUMENT';

ALTER TABLE "CustomApiConfig"
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'Custom';

CREATE INDEX "CustomApiConfig_provider_idx" ON "CustomApiConfig"("provider");
