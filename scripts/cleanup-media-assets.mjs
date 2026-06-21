import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();
const retentionDays = Math.max(1, Number(process.env.MEDIA_ASSET_RETENTION_DAYS || 30));
const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
const dryRun = process.argv.includes("--dry-run");

function getUploadsDir() {
  const configured = process.env.UPLOADS_DIR || "uploads";
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function safeLocalUploadPath(storageKey) {
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(uploadsDir, storageKey);
  const relative = path.relative(uploadsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

try {
  const staleAssets = await prisma.mediaAsset.findMany({
    where: {
      storageKey: { not: null },
      OR: [
        { createdAt: { lt: cutoff } },
        { lastAccessedAt: { lt: cutoff } }
      ]
    },
    select: { id: true, storageKey: true }
  });

  let filesDeleted = 0;
  let recordsDeleted = 0;
  for (const asset of staleAssets) {
    const localPath = asset.storageKey ? safeLocalUploadPath(asset.storageKey) : null;
    if (!dryRun && localPath && fs.existsSync(localPath)) {
      fs.rmSync(localPath, { force: true });
      filesDeleted += 1;
    }
    if (!dryRun) {
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
      recordsDeleted += 1;
    }
  }

  console.log(JSON.stringify({
    cutoff: cutoff.toISOString(),
    matched: staleAssets.length,
    filesDeleted,
    recordsDeleted,
    dryRun
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
