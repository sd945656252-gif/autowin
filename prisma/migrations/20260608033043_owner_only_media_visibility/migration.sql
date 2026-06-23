-- DropIndex
DROP INDEX "MediaAsset_visibility_idx";

-- AlterTable
ALTER TABLE "MediaAsset" ALTER COLUMN "updatedAt" DROP DEFAULT;
