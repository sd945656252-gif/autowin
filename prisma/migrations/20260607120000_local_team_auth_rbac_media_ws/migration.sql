-- Align local-team roles with ADMIN / DEVELOPER / USER while preserving existing users.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DEVELOPER', 'USER');

ALTER TABLE "User"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole"
  USING (
    CASE "role"::text
      WHEN 'ADMIN' THEN 'ADMIN'
      WHEN 'CREATOR' THEN 'USER'
      WHEN 'VIEWER' THEN 'USER'
      ELSE 'USER'
    END
  )::"UserRole";

ALTER TABLE "User"
  ALTER COLUMN "role" SET DEFAULT 'USER';

DROP TYPE "UserRole_old";

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCESS';

CREATE TYPE "MediaVisibility" AS ENUM ('PUBLIC', 'DEVELOPER_ONLY', 'ADMIN_ONLY');

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

ALTER TABLE "Workflow" ADD COLUMN IF NOT EXISTS "draftRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "fileKey" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "visibility" "MediaVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "MediaAsset"
SET "fileKey" = COALESCE("fileKey", "storageKey"),
    "title" = COALESCE("title", "storageKey", "url", 'Untitled media')
WHERE "fileKey" IS NULL OR "title" IS NULL;

CREATE INDEX IF NOT EXISTS "MediaAsset_visibility_idx" ON "MediaAsset"("visibility");

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ip" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
