import fs from "fs";
import path from "path";
import crypto from "crypto";
import type express from "express";
import multer from "multer";
import { MediaAssetType, MediaVisibility, Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { getPrivateStorageDir } from "../../shared/storage-paths";
import { requireRoles, type RequestUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { effectiveUploadMime, hasValidMagicNumber, isAllowedUploadFile } from "../media/media.upload";

const VISIBILITY_VALUES = new Set<string>(Object.values(MediaVisibility));
const DEFAULT_DEVELOPER_MEDIA_MAX_MB = 200;
const developerMediaMaxMb = Number(process.env.DEVELOPER_MEDIA_MAX_MB || DEFAULT_DEVELOPER_MEDIA_MAX_MB);
const developerMediaMaxBytes = Math.max(1, developerMediaMaxMb) * 1024 * 1024;
const HEADER_SAMPLE_BYTES = 4096;
const TEXT_SAMPLE_BYTES = 64 * 1024;
const ALLOWED_DEVELOPER_MEDIA_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/webm",
  "audio/ogg",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/zip",
  "application/octet-stream",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const DEVELOPER_MEDIA_MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],
  [".avi", "video/x-msvideo"],
  [".mkv", "video/x-matroska"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".ogg", "audio/ogg"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".zip", "application/zip"],
  [".doc", "application/msword"],
  [".xls", "application/vnd.ms-excel"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]
]);

function getPrivateMediaDir() {
  return path.join(getPrivateStorageDir(), "media");
}

function resolvePrivateMediaPath(fileKey: string) {
  const privateMediaDir = path.resolve(getPrivateMediaDir());
  const resolvedPath = path.resolve(privateMediaDir, fileKey);
  const relativePath = path.relative(privateMediaDir, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new HttpError(400, "Invalid media file key.");
  }
  return { privateMediaDir, resolvedPath };
}

function ensurePrivateMediaDir() {
  const PRIVATE_MEDIA_DIR = getPrivateMediaDir();
  if (!fs.existsSync(PRIVATE_MEDIA_DIR)) fs.mkdirSync(PRIVATE_MEDIA_DIR, { recursive: true });
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 120);
}

function fallbackAsciiFileName(value: string) {
  const ext = path.extname(value || "");
  const base = sanitizeFileName(path.basename(value || "download", ext)) || "download";
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 16);
  return `${base}${safeExt || ""}`.slice(0, 160) || "download";
}

function normalizeOriginalName(value: string) {
  const raw = String(value || "download").replace(/[\r\n]/g, " ").trim() || "download";
  const basename = path.basename(raw.replace(/\\/g, "/"));
  const looksLikeMojibake = /[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßà-ÿ]/.test(basename);
  if (!looksLikeMojibake) return basename;
  try {
    const decoded = Buffer.from(basename, "latin1").toString("utf8").replace(/[\r\n]/g, " ").trim();
    if (decoded && /[\u4e00-\u9fff]/.test(decoded)) return path.basename(decoded.replace(/\\/g, "/"));
  } catch {
    // Keep the original name if repair fails.
  }
  return basename;
}

function contentDisposition(type: "inline" | "attachment", filename: string) {
  const normalized = (filename || "download").replace(/[\r\n"]/g, " ").trim() || "download";
  const fallback = fallbackAsciiFileName(normalized);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}

function originalFileName(asset: { originalName?: string | null; title?: string | null; fileKey?: string | null }) {
  return normalizeOriginalName(asset.originalName || asset.title || (asset.fileKey ? path.basename(asset.fileKey) : "download"));
}

function isAllowedDeveloperMediaMime(mimeType: string) {
  return ALLOWED_DEVELOPER_MEDIA_MIMES.has(mimeType.split(";")[0].trim().toLowerCase());
}

function normalizedMimeType(mimeType: string) {
  return mimeType.split(";")[0].trim().toLowerCase();
}

function mimeFromExtension(originalName: string) {
  return DEVELOPER_MEDIA_MIME_BY_EXTENSION.get(path.extname(originalName || "").toLowerCase()) || null;
}

function isAllowedDeveloperMediaFile(file: Pick<Express.Multer.File, "mimetype" | "originalname">) {
  return isAllowedUploadFile(file) || isAllowedDeveloperMediaMime(file.mimetype || "") || Boolean(mimeFromExtension(file.originalname));
}

function readFileSample(filePath: string, bytes: number) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const bytesRead = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

async function computeFileHash(filePath: string) {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function safeRemovePrivateMediaFile(filename?: string | null) {
  if (!filename) return;
  try {
    const { resolvedPath } = resolvePrivateMediaPath(filename);
    if (fs.existsSync(resolvedPath)) fs.rmSync(resolvedPath, { force: true });
  } catch (error) {
    console.warn("[developer-media-upload] Failed to remove private media file:", error);
  }
}

function assertDeveloperUploadAccepted(file: Express.Multer.File) {
  const effectiveMime = effectiveUploadMime(file);
  if (!ALLOWED_DEVELOPER_MEDIA_MIMES.has(effectiveMime)) {
    throw new HttpError(400, "Only safe image, video, audio, PDF, text, JSON, CSV, Markdown, ZIP, and Office uploads are allowed.");
  }
  const header = readFileSample(file.path, HEADER_SAMPLE_BYTES);
  if (!hasValidDeveloperMagicNumber(header, effectiveMime, file.path)) {
    throw new HttpError(400, "Uploaded file content does not match its declared media type.");
  }
}

function hasValidDeveloperMagicNumber(header: Buffer, mimeType: string, filePath: string) {
  const mime = normalizedMimeType(mimeType);
  if (hasValidMagicNumber(header, mime)) return true;
  if (mime === "application/pdf") return header.subarray(0, 4).toString("ascii") === "%PDF";
  if (mime === "application/zip") {
    return header[0] === 0x50 && header[1] === 0x4b;
  }
  if (mime.includes("openxmlformats-officedocument")) {
    return header[0] === 0x50 && header[1] === 0x4b;
  }
  if (mime === "application/msword" || mime === "application/vnd.ms-excel" || mime === "application/vnd.ms-powerpoint") {
    return header.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (mime === "application/json" || mime === "text/plain" || mime === "text/csv" || mime === "text/markdown") {
    const sample = readFileSample(filePath, TEXT_SAMPLE_BYTES);
    return !sample.includes(0x00);
  }
  return false;
}

const developerUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensurePrivateMediaDir();
      cb(null, getPrivateMediaDir());
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".bin";
      const base = sanitizeFileName(path.basename(file.originalname, ext)) || "media";
      cb(null, `${Date.now()}-${crypto.randomUUID()}-${base}${ext}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    if (!isAllowedDeveloperMediaFile(file)) {
      cb(new Error("Only safe image, video, audio, PDF, text, JSON, CSV, Markdown, ZIP, and Office uploads are allowed."));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: developerMediaMaxBytes }
});

function canReadVisibility(user: RequestUser, visibility: MediaVisibility) {
  if (user.role === UserRole.ADMIN) return true;
  if (user.role === UserRole.DEVELOPER) return visibility !== MediaVisibility.ADMIN_ONLY;
  return visibility === MediaVisibility.PUBLIC;
}

function canManageDeveloperMedia(user: RequestUser, asset: { createdById?: string | null; ownerId?: string | null; visibility: MediaVisibility }) {
  if (user.role === UserRole.ADMIN) return true;
  if (asset.visibility === MediaVisibility.ADMIN_ONLY) return false;
  const creatorId = asset.createdById || asset.ownerId;
  return Boolean(creatorId && creatorId === user.id);
}

function mediaTypeFromMime(mimeType: string): MediaAssetType {
  const mime = normalizedMimeType(mimeType);
  if (mime.startsWith("image/")) return MediaAssetType.IMAGE;
  if (mime.startsWith("video/")) return MediaAssetType.VIDEO;
  if (mime.startsWith("audio/")) return MediaAssetType.AUDIO;
  return MediaAssetType.DOCUMENT;
}

function mediaTypeFromFile(file: Express.Multer.File): MediaAssetType {
  return mediaTypeFromMime(effectiveUploadMime(file));
}

function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[,，;；\n]/g);
  return Array.from(new Set(raw.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)));
}

function normalizeVisibility(value: unknown, user: RequestUser): MediaVisibility {
  const visibility = String(value || MediaVisibility.DEVELOPER_ONLY) as MediaVisibility;
  if (!VISIBILITY_VALUES.has(visibility)) throw new HttpError(400, "Invalid media visibility.");
  if (visibility === MediaVisibility.ADMIN_ONLY && user.role !== UserRole.ADMIN) {
    throw new HttpError(403, "Only ADMIN can set ADMIN_ONLY media.");
  }
  return visibility;
}

function serializeMedia(asset: any) {
  const displayName = originalFileName(asset);
  return {
    id: asset.id,
    title: asset.title || displayName || "Untitled media",
    originalName: displayName,
    description: asset.description || "",
    category: asset.category || "",
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    type: asset.type,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    visibility: asset.visibility,
    streamUrl: `/api/developer/media/${asset.id}/stream`,
    previewUrl: `/api/developer/media/${asset.id}/stream`,
    downloadUrl: `/api/developer/media/${asset.id}/download`,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  };
}

export function registerDeveloperMediaRoutes(app: express.Express) {
  app.get("/api/developer/media", async (req, res) => {
    try {
      const user = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const requestedType = typeof req.query.type === "string" ? req.query.type.toUpperCase() : "";
      const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
      const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const where: Prisma.MediaAssetWhereInput = {
        visibility: user.role === UserRole.ADMIN ? undefined : { in: [MediaVisibility.PUBLIC, MediaVisibility.DEVELOPER_ONLY] }
      };
      if (requestedType) {
        if (!Object.values(MediaAssetType).includes(requestedType as MediaAssetType)) {
          throw new HttpError(400, "Invalid media type filter.");
        }
        where.type = requestedType as MediaAssetType;
      }
      if (category) where.category = { equals: category, mode: "insensitive" };
      if (tag) where.tags = { array_contains: tag } as any;
      if (search) {
        where.OR = [
          { title: { contains: search, mode: "insensitive" } },
          { originalName: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { category: { contains: search, mode: "insensitive" } }
        ];
      }
      const media = await prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100
      });
      res.json({ success: true, media: media.map(serializeMedia) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to list developer media.");
    }
  });

  app.post("/api/developer/media", async (req, res, next) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      next();
    } catch (error: any) {
      sendApiError(res, error, "Authentication is required.");
    }
  }, developerUpload.fields([{ name: "file", maxCount: 1 }, { name: "files", maxCount: 20 }]), async (req, res) => {
    try {
      const user = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const groupedFiles = req.files as Record<string, Express.Multer.File[]> | undefined;
      const files = [...(groupedFiles?.file || []), ...(groupedFiles?.files || [])];
      if (files.length === 0) throw new HttpError(400, "No media file uploaded.");
      const title = String(req.body?.title || files[0]?.originalname || "Untitled media").trim();
      const description = req.body?.description ? String(req.body.description).trim() : null;
      const category = req.body?.category ? String(req.body.category).trim().slice(0, 80) : null;
      const tags = normalizeTags(req.body?.tags);
      const visibility = normalizeVisibility(req.body?.visibility, user);
      const assets = [];
      let dedupedCount = 0;
      const startedAt = Date.now();
      for (const file of files) {
        assertDeveloperUploadAccepted(file);
        const fileHash = await computeFileHash(file.path);
        const originalName = normalizeOriginalName(file.originalname || path.basename(file.filename));
        const effectiveMime = effectiveUploadMime(file);
        const duplicateWhere = {
          ownerId_fileHash_sizeBytes_originalName: {
            ownerId: user.id,
            fileHash,
            sizeBytes: file.size,
            originalName
          }
        };
        const existing = await prisma.mediaAsset.findUnique({ where: duplicateWhere });
        if (existing) {
          safeRemovePrivateMediaFile(file.filename);
          (file as any).__jiyingRemoved = true;
          dedupedCount += 1;
          assets.push(existing);
          continue;
        }

        try {
          const asset = await prisma.mediaAsset.create({
            data: {
              ownerId: user.id,
              createdById: user.id,
              type: mediaTypeFromFile(file),
              title: files.length === 1 ? (req.body?.title ? title : originalName) : originalName,
              description,
              category,
              tags,
              url: `private://${file.filename}`,
              fileKey: file.filename,
              storageKey: file.filename,
              originalName,
              fileHash,
              mimeType: effectiveMime,
              sizeBytes: file.size,
              visibility,
              metadata: { originalName, fileHash, storage: "private-local" }
            }
          });
          (file as any).__jiyingPersisted = true;
          assets.push(asset);
        } catch (error: any) {
          safeRemovePrivateMediaFile(file.filename);
          (file as any).__jiyingRemoved = true;
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const existingAfterRace = await prisma.mediaAsset.findUnique({ where: duplicateWhere });
            if (existingAfterRace) {
              dedupedCount += 1;
              assets.push(existingAfterRace);
              continue;
            }
          }
          throw error;
        }
      }

      console.info("[developer-media-upload] completed", {
        userId: user.id,
        count: files.length,
        created: assets.length - dedupedCount,
        deduped: dedupedCount,
        totalMs: Date.now() - startedAt
      });

      await writeAuditLog({
        actor: user,
        action: "CREATE",
        entityType: "DeveloperMedia",
        entityId: assets.length === 1 ? assets[0].id : null,
        req,
        afterJson: { count: assets.length, createdCount: assets.length - dedupedCount, dedupedCount, visibility, category, tags }
      });

      res.status(201).json({ success: true, media: assets.map(serializeMedia) });
    } catch (error: any) {
      const groupedFiles = req.files as Record<string, Express.Multer.File[]> | undefined;
      const files = [...(groupedFiles?.file || []), ...(groupedFiles?.files || [])];
      for (const file of files) {
        if ((file as any).__jiyingPersisted || (file as any).__jiyingRemoved) continue;
        if (file.path && fs.existsSync(file.path)) fs.rmSync(file.path, { force: true });
      }
      const actor = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]).catch(() => null);
      if (actor) {
        await writeAuditLog({
          actor,
          action: "ACCESS",
          entityType: "DeveloperMediaUpload",
          req,
          metadata: {
            decision: "denied",
            reason: error?.message || "Upload rejected.",
            count: files.length
          }
        });
      }
      sendApiError(res, error, "Failed to create developer media.");
    }
  });

  app.patch("/api/developer/media/:id", async (req, res) => {
    try {
      const user = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const existing = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Media not found.");
      if (!canManageDeveloperMedia(user, existing)) {
        throw new HttpError(403, "Forbidden.");
      }

      const visibility = req.body?.visibility !== undefined ? String(req.body.visibility) as MediaVisibility : undefined;
      if (visibility && !VISIBILITY_VALUES.has(visibility)) throw new HttpError(400, "Invalid media visibility.");
      if (visibility === MediaVisibility.ADMIN_ONLY && user.role !== UserRole.ADMIN) throw new HttpError(403, "Only ADMIN can set ADMIN_ONLY media.");
      const tags = req.body?.tags !== undefined ? normalizeTags(req.body.tags) : undefined;
      const category = req.body?.category !== undefined ? String(req.body.category || "").trim().slice(0, 80) || null : undefined;

      const asset = await prisma.mediaAsset.update({
        where: { id: existing.id },
        data: {
          ...(req.body?.title !== undefined ? { title: String(req.body.title).trim() || existing.title } : {}),
          ...(req.body?.description !== undefined ? { description: req.body.description ? String(req.body.description).trim() : null } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(visibility ? { visibility } : {})
        }
      });

      await writeAuditLog({
        actor: user,
        action: "UPDATE",
        entityType: "DeveloperMedia",
        entityId: asset.id,
        req,
        beforeJson: { title: existing.title, description: existing.description, category: existing.category, tags: existing.tags, visibility: existing.visibility },
        afterJson: { title: asset.title, description: asset.description, category: asset.category, tags: asset.tags, visibility: asset.visibility }
      });

      res.json({ success: true, media: serializeMedia(asset) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to update developer media.");
    }
  });

  app.delete("/api/developer/media/:id", async (req, res) => {
    try {
      const user = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const existing = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new HttpError(404, "Media not found.");
      if (!canManageDeveloperMedia(user, existing)) {
        throw new HttpError(403, "Forbidden.");
      }

      await prisma.mediaAsset.delete({ where: { id: existing.id } });
      if (existing.fileKey) {
        const { resolvedPath } = resolvePrivateMediaPath(existing.fileKey);
        if (fs.existsSync(resolvedPath)) {
          fs.rmSync(resolvedPath, { force: true });
        }
      }

      await writeAuditLog({
        actor: user,
        action: "DELETE",
        entityType: "DeveloperMedia",
        entityId: existing.id,
        req,
        beforeJson: { title: existing.title, visibility: existing.visibility }
      });

      res.json({ success: true });
    } catch (error: any) {
      sendApiError(res, error, "Failed to delete developer media.");
    }
  });

  app.get("/api/developer/media/:id/stream", async (req, res) => {
    try {
      const user = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const asset = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
      if (!asset || !asset.fileKey) throw new HttpError(404, "Media not found.");
      if (!canReadVisibility(user, asset.visibility)) throw new HttpError(403, "Forbidden.");

      const { resolvedPath } = resolvePrivateMediaPath(asset.fileKey);
      if (!fs.existsSync(resolvedPath)) {
        throw new HttpError(404, "Media file not found.");
      }

      await writeAuditLog({
        actor: user,
        action: "ACCESS",
        entityType: "DeveloperMedia",
        entityId: asset.id,
        req,
        metadata: { visibility: asset.visibility }
      });

      const stat = fs.statSync(resolvedPath);
      const range = req.headers.range;
      const mimeType = asset.mimeType || "application/octet-stream";
      const fileName = originalFileName(asset);
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
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": mimeType,
          "Content-Disposition": contentDisposition("inline", fileName),
          "X-Jiying-Original-Name": encodeURIComponent(fileName)
        });
        fs.createReadStream(resolvedPath, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Content-Disposition": contentDisposition("inline", fileName),
        "X-Jiying-Original-Name": encodeURIComponent(fileName)
      });
      fs.createReadStream(resolvedPath).pipe(res);
    } catch (error: any) {
      sendApiError(res, error, "Failed to stream developer media.");
    }
  });

  app.get("/api/developer/media/:id/download", async (req, res) => {
    try {
      const user = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const asset = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
      if (!asset || !asset.fileKey) throw new HttpError(404, "Media not found.");
      if (!canReadVisibility(user, asset.visibility)) throw new HttpError(403, "Forbidden.");
      const { resolvedPath } = resolvePrivateMediaPath(asset.fileKey);
      if (!fs.existsSync(resolvedPath)) throw new HttpError(404, "Media file not found.");

      await writeAuditLog({
        actor: user,
        action: "ACCESS",
        entityType: "DeveloperMediaDownload",
        entityId: asset.id,
        req,
        metadata: { visibility: asset.visibility, originalName: asset.originalName || null, mimeType: asset.mimeType || null }
      });

      const stat = fs.statSync(resolvedPath);
      const fileName = originalFileName(asset);
      const mimeType = asset.mimeType || "application/octet-stream";
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": mimeType,
        "Content-Disposition": contentDisposition("attachment", fileName),
        "X-Jiying-Original-Name": encodeURIComponent(fileName)
      });
      fs.createReadStream(resolvedPath).pipe(res);
    } catch (error: any) {
      sendApiError(res, error, "Failed to download developer media.");
    }
  });
}
