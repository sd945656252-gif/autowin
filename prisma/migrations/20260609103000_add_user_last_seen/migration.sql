ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

UPDATE "User"
SET "lastSeenAt" = "lastLoginAt"
WHERE "lastLoginAt" IS NOT NULL;
