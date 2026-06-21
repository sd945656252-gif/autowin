import fs from "fs";
import path from "path";
import type express from "express";
import { MediaAssetType, MediaVisibility, UserRole } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { getUploadFilePath } from "../../shared/storage-paths";
import { resolveRequestUser, requireRoles, type RequestUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { canReadMediaAsset, recordLocalMediaAsset, resolveLocalUploadPath } from "../media/media.service";
import { createLocalUpload, effectiveUploadMime, hasValidMagicNumber } from "../media/media.upload";
import {
  PRESET_METADATA,
  getLatestShowcaseEvent,
  onShowcaseRegistryChanged,
  publishShowcaseRegistryChanged,
  processVideoAsset,
  readRegistryFromDatabase,
  showcasePlaybackUrl,
  storageKeyFromShowcaseWork,
  storageKeyFromLegacyVideoUrl,
  upsertVideoRegistryItem
} from "./video-registry.service";

function deleteUploadedFile(file?: Express.Multer.File | null) {
  if (!file?.path) return;
  try {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  } catch (error) {
    console.warn("[VideoRegistry] Failed to remove rejected upload:", error);
  }
}

function isValidRegistryKey(value: string) {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

function assertVideoUploadAccepted(file: Express.Multer.File) {
  const mimeType = effectiveUploadMime(file);
  if (!mimeType.startsWith("video/")) {
    throw new Error("Only video uploads are allowed for the video registry.");
  }
  const header = fs.readFileSync(file.path).subarray(0, 4096);
  if (!hasValidMagicNumber(header, mimeType)) {
    throw new Error("Uploaded video content does not match its declared media type.");
  }
}

function sanitizeText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim().slice(0, 120);
}

async function requireVideoRegistryManager(req: express.Request): Promise<RequestUser> {
  return requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
}

const MAX_SHOWCASE_UPLOAD_MB = 1024;
const configuredShowcaseUploadMb = Number(process.env.SHOWCASE_UPLOAD_MAX_MB || MAX_SHOWCASE_UPLOAD_MB);
const showcaseUploadMaxMb = Math.min(
  MAX_SHOWCASE_UPLOAD_MB,
  Math.max(1, Number.isFinite(configuredShowcaseUploadMb) ? configuredShowcaseUploadMb : MAX_SHOWCASE_UPLOAD_MB)
);
const showcaseUpload = createLocalUpload(showcaseUploadMaxMb);

function uploadSingleVideo(fieldName: string): express.RequestHandler {
  const middleware = showcaseUpload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (error: any) => {
      if (error) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ success: false, error: `Featured work video must be ${showcaseUploadMaxMb}MB or smaller.` });
          return;
        }
        res.status(400).json({ success: false, error: error.message || "Upload rejected." });
        return;
      }
      next();
    });
  };
}

async function findShowcaseStreamTarget(key: string) {
  const work = await prisma.showcaseWork.findUnique({ where: { key } });
  if (!work || work.status !== "PUBLISHED") return null;
  const storageKey = storageKeyFromShowcaseWork(work);
  if (!storageKey) return null;
  const asset = await prisma.mediaAsset.findFirst({ where: { storageKey }, orderBy: { createdAt: "desc" } });
  return { work, storageKey, asset };
}

function streamVideoFile(req: express.Request, res: express.Response, filePath: string, mimeType = "video/mp4") {
  const stat = fs.statSync(filePath);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Accept-Ranges", "bytes");

  const range = req.headers.range;
  if (range) {
    const [startRaw, endRaw] = range.replace(/bytes=/, "").split("-");
    const start = Number.parseInt(startRaw, 10);
    const end = endRaw ? Number.parseInt(endRaw, 10) : stat.size - 1;
    if (Number.isNaN(start) || start >= stat.size) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
      return;
    }
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": end - start + 1,
      "Content-Type": mimeType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Length": stat.size,
    "Content-Type": mimeType
  });
  fs.createReadStream(filePath).pipe(res);
}

export function registerVideoRegistryRoutes(app: express.Express) {
  app.get("/api/videos", async (_req, res) => {
    const registry = await readRegistryFromDatabase();

    for (const key of Object.keys(registry.videos)) {
      if (key.startsWith("extra-") && (!registry.videos[key] || registry.videos[key]?.includes("mixkit.co"))) {
        registry.videos[key] = null;
      }
    }

    res.json(registry);
  });

  app.get("/api/videos/events", async (_req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const sendEvent = (event: ReturnType<typeof getLatestShowcaseEvent>) => {
      res.write(`event: showcase-updated\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    sendEvent(getLatestShowcaseEvent());
    const off = onShowcaseRegistryChanged(sendEvent);
    const heartbeat = setInterval(() => {
      res.write(`event: heartbeat\n`);
      res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 30000);

    _req.on("close", () => {
      clearInterval(heartbeat);
      off();
      res.end();
    });
  });

  app.get("/api/videos/:key/stream", async (req, res) => {
    try {
      const key = String(req.params.key || "");
      if (!isValidRegistryKey(key)) {
        res.status(404).send("Not Found");
        return;
      }
      const target = await findShowcaseStreamTarget(key);
      if (!target) {
        res.status(404).send("Not Found");
        return;
      }
      const requestUser = await resolveRequestUser(req, { allowGuest: true });
      if (target.asset && !canReadMediaAsset(requestUser, target.asset)) {
        res.status(404).send("Not Found");
        return;
      }
      const filePath = resolveLocalUploadPath(target.storageKey);
      if (!fs.existsSync(filePath)) {
        res.status(404).send("Not Found");
        return;
      }
      streamVideoFile(req, res, filePath, target.asset?.mimeType || String((target.work.metadata as any)?.mimeType || "video/mp4"));
    } catch (error) {
      console.warn("[VideoRegistry] Stream failed:", error);
      if (!res.headersSent) res.status(404).send("Not Found");
    }
  });

  app.post("/api/videos/upload", async (req, res, next) => {
    console.log("[Server] Received POST request on /api/videos/upload");
    try {
      await requireVideoRegistryManager(req);
      next();
    } catch (error: any) {
      res.status(error?.status || 401).json({ success: false, error: error?.message || "Authentication is required." });
    }
  }, uploadSingleVideo("file"), async (req, res) => {
    try {
      const key = String(req.body.key || req.query.key || "");
      console.log(`[Server] Upload handler started. Parsed Key: ${key}. File defined: ${!!req.file}.`);

      if (!key) {
        console.error("[Server] Missing key value in request body!");
        deleteUploadedFile(req.file);
        res.status(400).json({ error: "Missing 'key' identifier for the video slot. Ensure key is provided." });
        return;
      }

      if (!isValidRegistryKey(key)) {
        deleteUploadedFile(req.file);
        res.status(400).json({ error: "Invalid video registry key." });
        return;
      }

      if (!req.file) {
        console.error("[Server] No file object found inside request!");
        res.status(400).json({ error: "No video file was uploaded." });
        return;
      }

      assertVideoUploadAccepted(req.file);
      const requestUser = await requireVideoRegistryManager(req);
      const registry = await readRegistryFromDatabase();
      const beforeWork = await prisma.showcaseWork.findUnique({ where: { key } });

      const localPhysicalPath = req.file.path;
      console.log("[Server] Local showcase video write succeeded. Preparing registry update...");

      const oldStorageKey = beforeWork?.storageKey || beforeWork?.fileKey || storageKeyFromLegacyVideoUrl(beforeWork?.videoUrl);
      if (oldStorageKey) {
        const oldFilePath = getUploadFilePath(oldStorageKey);
        if (fs.existsSync(oldFilePath)) {
          try {
            fs.unlinkSync(oldFilePath);
            console.log("[Server] Cleaned up older showcase video file.");
          } catch (err) {
            console.error("[Server] Failed to delete older showcase video file.", err);
          }
        }
      }

      const originalName = req.file.originalname;
      const mimeType = effectiveUploadMime(req.file);
      let finalLocalPath = localPhysicalPath;
      let finalMimeType = mimeType;
      let transcodeResult = {
        path: localPhysicalPath,
        mimeType,
        status: "ORIGINAL_UPLOADED",
        enabled: false,
        ffmpegAvailable: false,
        reason: "not_started"
      } as Awaited<ReturnType<typeof processVideoAsset>>;

      try {
        transcodeResult = await processVideoAsset(localPhysicalPath, mimeType);
        finalLocalPath = transcodeResult.path;
        finalMimeType = transcodeResult.mimeType;
        if (transcodeResult.status === "TRANSCODED") {
          console.log("[Server] Showcase video processed successfully to MP4.");
        }
      } catch (processErr) {
        const message = processErr instanceof Error ? processErr.message : String(processErr);
        console.error("[Server] Unexpected video processing error, proceeding with original source file:", message);
        transcodeResult = {
          path: localPhysicalPath,
          mimeType,
          status: "TRANSCODE_FAILED",
          enabled: process.env.SHOWCASE_TRANSCODE_ENABLED === "true",
          ffmpegAvailable: false,
          reason: "unexpected_exception",
          error: message
        } as Awaited<ReturnType<typeof processVideoAsset>>;
      }

      const finalFilename = path.basename(finalLocalPath);
      const finalRelativeUrl = `/uploads/${finalFilename}`;
      const playbackUrl = showcasePlaybackUrl(key);
      const title = sanitizeText(req.body.title, registry.metadata[key]?.title || "Untitled Motion Asset") || "Untitled Motion Asset";
      const category = sanitizeText(req.body.category, registry.metadata[key]?.category || "JiYing Concept") || "JiYing Concept";
      const sortOrder = Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : undefined;
      const coverUrl = req.body.coverUrl ? sanitizeText(req.body.coverUrl) : undefined;

      registry.videos[key] = playbackUrl;
      registry.metadata[key] = { title, category };
      await upsertVideoRegistryItem(key, null, {
        title,
        category,
        coverUrl,
        sortOrder,
        status: "PUBLISHED",
        createdById: requestUser.id,
        fileKey: finalFilename,
        storageKey: finalFilename,
        extraMetadata: {
          mimeType: finalMimeType,
          originalName,
          transcode: {
            status: transcodeResult.status,
            enabled: transcodeResult.enabled,
            ffmpegAvailable: transcodeResult.ffmpegAvailable,
            reason: transcodeResult.reason,
            error: transcodeResult.error || null
          }
        }
      });
      await recordLocalMediaAsset({
        requestUser,
        type: MediaAssetType.VIDEO,
        url: finalRelativeUrl,
        filePath: finalLocalPath,
        originalName,
        mimeType: finalMimeType,
        visibility: MediaVisibility.PUBLIC,
        metadata: {
          showcaseKey: key,
          originalName,
          transcodeStatus: transcodeResult.status,
          transcodeReason: transcodeResult.reason,
          transcodeError: transcodeResult.error || null
        }
      });

      const afterWork = await prisma.showcaseWork.findUnique({ where: { key } });
      await writeAuditLog({
        actor: requestUser,
        action: beforeWork ? "UPDATE" : "CREATE",
        entityType: "ShowcaseWork",
        entityId: afterWork?.id || null,
        req,
        beforeJson: beforeWork ? { key: beforeWork.key, title: beforeWork.title, category: beforeWork.category, status: beforeWork.status } : undefined,
        afterJson: afterWork ? { key: afterWork.key, title: afterWork.title, category: afterWork.category, status: afterWork.status, hasVideo: Boolean(afterWork.storageKey || afterWork.fileKey) } : { key, title, category, hasVideo: true }
      });

      publishShowcaseRegistryChanged("upload", key);
      res.json({ success: true, playbackUrl, registry: await readRegistryFromDatabase(), storage: "protected" });
    } catch (error: any) {
      console.error("[Server] Video upload endpoint exception:", error);
      deleteUploadedFile(req.file);
      if (!res.headersSent) {
        res.status(error?.status || 400).json({ success: false, error: error.message || "Video upload failed." });
      }
    }
  });

  app.post("/api/videos/metadata", async (req, res) => {
    try {
      const requestUser = await requireVideoRegistryManager(req);
      const { key, title, category, coverUrl, sortOrder, status } = req.body;
      if (!key) {
        res.status(400).json({ error: "Missing key." });
        return;
      }
      if (!isValidRegistryKey(String(key))) {
        res.status(400).json({ error: "Invalid video registry key." });
        return;
      }
      if (status !== undefined && !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(String(status))) {
        res.status(400).json({ error: "Invalid showcase status." });
        return;
      }

      const registry = await readRegistryFromDatabase();
      const beforeWork = await prisma.showcaseWork.findUnique({ where: { key: String(key) } });
      if (!registry.metadata[key]) {
        registry.metadata[key] = { title: "", category: "" };
      }
      if (title !== undefined) registry.metadata[key].title = sanitizeText(title, registry.metadata[key].title);
      if (category !== undefined) registry.metadata[key].category = sanitizeText(category, registry.metadata[key].category);

      await upsertVideoRegistryItem(String(key), null, {
        ...registry.metadata[String(key)],
        ...(coverUrl !== undefined ? { coverUrl: coverUrl ? sanitizeText(coverUrl) : null } : {}),
        ...(sortOrder !== undefined && Number.isFinite(Number(sortOrder)) ? { sortOrder: Number(sortOrder) } : {}),
        ...(status !== undefined ? { status: String(status) as any } : {}),
        ...(beforeWork?.fileKey !== undefined ? { fileKey: beforeWork.fileKey } : {}),
        ...(beforeWork?.storageKey !== undefined ? { storageKey: beforeWork.storageKey } : {})
      });
      const afterWork = await prisma.showcaseWork.findUnique({ where: { key: String(key) } });
      await writeAuditLog({
        actor: requestUser,
        action: "UPDATE",
        entityType: "ShowcaseWork",
        entityId: afterWork?.id || beforeWork?.id || null,
        req,
        beforeJson: beforeWork ? { key: beforeWork.key, title: beforeWork.title, category: beforeWork.category, status: beforeWork.status, sortOrder: beforeWork.sortOrder } : undefined,
        afterJson: afterWork ? { key: afterWork.key, title: afterWork.title, category: afterWork.category, status: afterWork.status, sortOrder: afterWork.sortOrder } : undefined
      });
      publishShowcaseRegistryChanged("metadata", String(key));
      res.json({ success: true, registry: await readRegistryFromDatabase() });
    } catch (error: any) {
      console.error("Metadata save endpoint error:", error);
      res.status(error?.status || 500).json({ error: error?.status ? error.message : "Failed to save video metadata." });
    }
  });

  app.post("/api/videos/remove", async (req, res) => {
    try {
      const requestUser = await requireVideoRegistryManager(req);
      const { key } = req.body;
      if (!key) {
        res.status(400).json({ error: "Missing key parameter." });
        return;
      }
      if (!isValidRegistryKey(String(key))) {
        res.status(400).json({ error: "Invalid video registry key." });
        return;
      }

      const registry = await readRegistryFromDatabase();
      const beforeWork = await prisma.showcaseWork.findUnique({ where: { key: String(key) } });

      const storageKey = beforeWork?.storageKey || beforeWork?.fileKey || storageKeyFromLegacyVideoUrl(beforeWork?.videoUrl);
      if (storageKey) {
        const filePath = getUploadFilePath(storageKey);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (err) {
            console.error("Error deleting physical file:", err);
          }
        }
      }

      const defaultMeta = PRESET_METADATA[key] || { title: "Untitled Motion Asset", category: "JiYing Concept" };

      registry.videos[key] = null;
      registry.metadata[key] = defaultMeta;

      await upsertVideoRegistryItem(key, null, { ...defaultMeta, status: "ARCHIVED", fileKey: null, storageKey: null });
      const afterWork = await prisma.showcaseWork.findUnique({ where: { key: String(key) } });
      await writeAuditLog({
        actor: requestUser,
        action: "DELETE",
        entityType: "ShowcaseWork",
        entityId: beforeWork?.id || afterWork?.id || null,
        req,
        beforeJson: beforeWork ? { key: beforeWork.key, title: beforeWork.title, category: beforeWork.category, status: beforeWork.status, hasVideo: Boolean(beforeWork.storageKey || beforeWork.fileKey || beforeWork.videoUrl) } : undefined,
        afterJson: afterWork ? { key: afterWork.key, title: afterWork.title, category: afterWork.category, status: afterWork.status, hasVideo: Boolean(afterWork.storageKey || afterWork.fileKey || afterWork.videoUrl) } : { key, status: "ARCHIVED" }
      });
      publishShowcaseRegistryChanged("remove", String(key));
      res.json({ success: true, registry: await readRegistryFromDatabase() });
    } catch (error: any) {
      console.error("Remove video endpoint error:", error);
      res.status(error?.status || 500).json({ error: error?.status ? error.message : "Failed to remove video." });
    }
  });
}
