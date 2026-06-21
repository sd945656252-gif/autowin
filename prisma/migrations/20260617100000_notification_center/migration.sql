-- Extend existing notifications into a full message center without breaking
-- current production-asset review notifications.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationAudience') THEN
    CREATE TYPE "NotificationAudience" AS ENUM ('USER', 'PROJECT', 'GLOBAL');
  END IF;
END $$;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'USER_NOTICE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_BROADCAST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT';

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "senderId" TEXT,
  ADD COLUMN IF NOT EXISTS "audience" "NotificationAudience" NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Notification_senderId_fkey'
  ) THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_senderId_fkey"
      FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "NotificationAttachment" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationAttachment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NotificationAttachment_notificationId_fkey'
  ) THEN
    ALTER TABLE "NotificationAttachment"
      ADD CONSTRAINT "NotificationAttachment_notificationId_fkey"
      FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NotificationAttachment_mediaAssetId_fkey'
  ) THEN
    ALTER TABLE "NotificationAttachment"
      ADD CONSTRAINT "NotificationAttachment_mediaAssetId_fkey"
      FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'NotificationAttachment_notificationId_mediaAssetId_key'
  ) THEN
    ALTER TABLE "NotificationAttachment"
      ADD CONSTRAINT "NotificationAttachment_notificationId_mediaAssetId_key"
      UNIQUE ("notificationId", "mediaAssetId");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Notification_receiverId_deletedAt_createdAt_idx" ON "Notification"("receiverId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_senderId_idx" ON "Notification"("senderId");
CREATE INDEX IF NOT EXISTS "Notification_expiresAt_idx" ON "Notification"("expiresAt");
CREATE INDEX IF NOT EXISTS "NotificationAttachment_mediaAssetId_idx" ON "NotificationAttachment"("mediaAssetId");
