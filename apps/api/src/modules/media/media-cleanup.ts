import fs from "fs";
import path from "path";
import cron from "node-cron";
import { prisma } from "../../db/prisma";
import { getUploadsDir } from "../../shared/storage-paths";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_CRON = "17 3 * * *";

function retentionDays() {
  return Math.max(1, Number(process.env.MEDIA_ASSET_RETENTION_DAYS || DEFAULT_RETENTION_DAYS));
}

function staleCutoff() {
  return new Date(Date.now() - retentionDays() * 24 * 60 * 60 * 1000);
}

function safeLocalUploadPath(storageKey: string) {
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(uploadsDir, storageKey);
  const relative = path.relative(uploadsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

export async function runMediaAssetCleanup(input: { dryRun?: boolean } = {}) {
  const cutoff = staleCutoff();
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
    if (!input.dryRun && localPath && fs.existsSync(localPath)) {
      fs.rmSync(localPath, { force: true });
      filesDeleted += 1;
    }
    if (!input.dryRun) {
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
      recordsDeleted += 1;
    }
  }

  return {
    cutoff: cutoff.toISOString(),
    matched: staleAssets.length,
    filesDeleted,
    recordsDeleted,
    dryRun: Boolean(input.dryRun)
  };
}

export function startMediaAssetCleanupCron() {
  if (process.env.MEDIA_ASSET_CLEANUP_ENABLED === "false") return;
  const schedule = process.env.MEDIA_ASSET_CLEANUP_CRON || DEFAULT_CRON;
  cron.schedule(schedule, () => {
    runMediaAssetCleanup().then((result) => {
      console.log("[MediaCleanup] Completed:", result);
    }).catch((error) => {
      console.error("[MediaCleanup] Failed:", error);
    });
  });
  console.log(`[MediaCleanup] Scheduled with "${schedule}", retention ${retentionDays()} days.`);
}
