-- DropForeignKey
ALTER TABLE "CustomApiConfig" DROP CONSTRAINT "CustomApiConfig_ownerId_fkey";

-- AlterTable
ALTER TABLE "CustomApiConfig" ADD COLUMN     "keyPreview" TEXT;
