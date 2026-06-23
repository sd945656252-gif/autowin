-- CreateEnum
CREATE TYPE "ProductionStage" AS ENUM ('SCRIPT_01', 'DIRECTOR_02', 'ART_03', 'SHOT_04', 'EDIT_05');

-- CreateEnum
CREATE TYPE "ProductionAssetScope" AS ENUM ('PERSONAL', 'TEAM', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ProductionAssetReviewStatus" AS ENUM ('UNREVIEWED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED', 'REFERENCE');

-- CreateEnum
CREATE TYPE "ProductionProjectMemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProductionProjectGrantRole" AS ENUM ('PROJECT_DEVELOPER');

-- CreateEnum
CREATE TYPE "ProductionAssetReviewAction" AS ENUM ('CREATE', 'SUBMIT_REVIEW', 'APPROVE', 'REJECT', 'ARCHIVE', 'SOFT_DELETE', 'REFERENCE_UPLOAD', 'REFERENCE_DISTRIBUTE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSET_SUBMITTED', 'ASSET_APPROVED', 'ASSET_REJECTED', 'ASSET_ARCHIVED', 'REFERENCE_ASSIGNED', 'PROJECT_DEVELOPER_GRANTED', 'PROJECT_DEVELOPER_REVOKED');

-- CreateTable
CREATE TABLE "ProductionProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProductionProjectMemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionProjectRoleGrant" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProductionProjectGrantRole" NOT NULL,
    "grantedById" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionProjectRoleGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "stage" "ProductionStage" NOT NULL,
    "scope" "ProductionAssetScope" NOT NULL,
    "reviewStatus" "ProductionAssetReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "creatorId" TEXT,
    "submitterId" TEXT,
    "reviewerId" TEXT,
    "mediaAssetId" TEXT,
    "originalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentSnapshotId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourcePayload" JSONB,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionAssetSnapshot" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reviewStatus" "ProductionAssetReviewStatus" NOT NULL DEFAULT 'IN_REVIEW',
    "createdById" TEXT,
    "reviewedById" TEXT,
    "mediaAssetId" TEXT,
    "originalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "frozenPayload" JSONB,
    "frozenStorageObjectKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionAssetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionAssetReviewEvent" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "actorId" TEXT,
    "action" "ProductionAssetReviewAction" NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionAssetReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionAssetReferenceVisibility" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionAssetReferenceVisibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "projectId" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionProject_createdById_idx" ON "ProductionProject"("createdById");

-- CreateIndex
CREATE INDEX "ProductionProject_updatedAt_idx" ON "ProductionProject"("updatedAt");

-- CreateIndex
CREATE INDEX "ProductionProjectMember_userId_idx" ON "ProductionProjectMember"("userId");

-- CreateIndex
CREATE INDEX "ProductionProjectMember_projectId_role_idx" ON "ProductionProjectMember"("projectId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionProjectMember_projectId_userId_key" ON "ProductionProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "ProductionProjectRoleGrant_projectId_role_revokedAt_idx" ON "ProductionProjectRoleGrant"("projectId", "role", "revokedAt");

-- CreateIndex
CREATE INDEX "ProductionProjectRoleGrant_userId_revokedAt_idx" ON "ProductionProjectRoleGrant"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "ProductionAsset_projectId_stage_scope_reviewStatus_idx" ON "ProductionAsset"("projectId", "stage", "scope", "reviewStatus");

-- CreateIndex
CREATE INDEX "ProductionAsset_creatorId_scope_deletedAt_idx" ON "ProductionAsset"("creatorId", "scope", "deletedAt");

-- CreateIndex
CREATE INDEX "ProductionAsset_submitterId_idx" ON "ProductionAsset"("submitterId");

-- CreateIndex
CREATE INDEX "ProductionAsset_mediaAssetId_idx" ON "ProductionAsset"("mediaAssetId");

-- CreateIndex
CREATE INDEX "ProductionAsset_currentSnapshotId_idx" ON "ProductionAsset"("currentSnapshotId");

-- CreateIndex
CREATE INDEX "ProductionAssetSnapshot_reviewStatus_createdAt_idx" ON "ProductionAssetSnapshot"("reviewStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionAssetSnapshot_createdById_idx" ON "ProductionAssetSnapshot"("createdById");

-- CreateIndex
CREATE INDEX "ProductionAssetSnapshot_mediaAssetId_idx" ON "ProductionAssetSnapshot"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionAssetSnapshot_assetId_version_key" ON "ProductionAssetSnapshot"("assetId", "version");

-- CreateIndex
CREATE INDEX "ProductionAssetReviewEvent_assetId_createdAt_idx" ON "ProductionAssetReviewEvent"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionAssetReviewEvent_snapshotId_idx" ON "ProductionAssetReviewEvent"("snapshotId");

-- CreateIndex
CREATE INDEX "ProductionAssetReviewEvent_actorId_idx" ON "ProductionAssetReviewEvent"("actorId");

-- CreateIndex
CREATE INDEX "ProductionAssetReviewEvent_action_idx" ON "ProductionAssetReviewEvent"("action");

-- CreateIndex
CREATE INDEX "ProductionAssetReferenceVisibility_userId_idx" ON "ProductionAssetReferenceVisibility"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionAssetReferenceVisibility_assetId_userId_key" ON "ProductionAssetReferenceVisibility"("assetId", "userId");

-- CreateIndex
CREATE INDEX "Notification_receiverId_readAt_createdAt_idx" ON "Notification"("receiverId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

-- CreateIndex
CREATE INDEX "Notification_targetType_targetId_idx" ON "Notification"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "ProductionProject" ADD CONSTRAINT "ProductionProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProjectMember" ADD CONSTRAINT "ProductionProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProjectMember" ADD CONSTRAINT "ProductionProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProjectRoleGrant" ADD CONSTRAINT "ProductionProjectRoleGrant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProjectRoleGrant" ADD CONSTRAINT "ProductionProjectRoleGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionProjectRoleGrant" ADD CONSTRAINT "ProductionProjectRoleGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAsset" ADD CONSTRAINT "ProductionAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAsset" ADD CONSTRAINT "ProductionAsset_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAsset" ADD CONSTRAINT "ProductionAsset_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAsset" ADD CONSTRAINT "ProductionAsset_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAsset" ADD CONSTRAINT "ProductionAsset_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetSnapshot" ADD CONSTRAINT "ProductionAssetSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ProductionAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetSnapshot" ADD CONSTRAINT "ProductionAssetSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetSnapshot" ADD CONSTRAINT "ProductionAssetSnapshot_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetSnapshot" ADD CONSTRAINT "ProductionAssetSnapshot_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetReviewEvent" ADD CONSTRAINT "ProductionAssetReviewEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ProductionAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetReviewEvent" ADD CONSTRAINT "ProductionAssetReviewEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProductionAssetSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetReferenceVisibility" ADD CONSTRAINT "ProductionAssetReferenceVisibility_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ProductionAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetReferenceVisibility" ADD CONSTRAINT "ProductionAssetReferenceVisibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionAssetReferenceVisibility" ADD CONSTRAINT "ProductionAssetReferenceVisibility_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProductionProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
