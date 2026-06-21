import type express from "express";
import fs from "fs";
import { MediaAssetType, MediaVisibility } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth, resolveRequestUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { assertUserUploadQuota, canReadMediaAsset, markMediaAssetAccessed, protectedMediaUrl, recordLocalMediaAsset, resolveLocalUploadPath } from "./media.service";
import { parseMediaRange } from "./media-range";
import { effectiveUploadMime, hasValidMagicNumber, upload } from "./media.upload";

function deleteUploadedFile(file?: Express.Multer.File) {
  if (!file?.path) return;
  try {
    fs.unlinkSync(file.path);
  } catch (error) {
    console.warn("[MediaUpload] Failed to remove rejected upload:", error);
  }
}

async function assertUploadedFileAccepted(requestUser: Awaited<ReturnType<typeof requireAuth>>, file: Express.Multer.File) {
  const header = fs.readFileSync(file.path).subarray(0, 4096);
  if (!hasValidMagicNumber(header, effectiveUploadMime(file))) {
    throw new Error("Uploaded file content does not match its declared media type.");
  }
  await assertUserUploadQuota(requestUser, file.size || fs.statSync(file.path).size);
}

function uploadSingle(fieldName: string): express.RequestHandler {
  const middleware = upload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (error: any) => {
      if (error) {
        res.status(400).json({ success: false, error: error.message || "Upload rejected." });
        return;
      }
      next();
    });
  };
}

async function requireUploadAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    await requireAuth(req);
    next();
  } catch (error: any) {
    res.status(error?.status || 401).json({ success: false, error: error?.status ? error.message : "Authentication is required." });
  }
}

function publicUploadErrorMessage(error: any) {
  if (error instanceof HttpError) return error.message;
  if (typeof error?.message === "string" && /too large|file size|limit/i.test(error.message)) return error.message;
  if (typeof error?.message === "string" && /content does not match|quota exceeded|must be/i.test(error.message)) return error.message;
  return "Upload rejected.";
}

export function registerMediaRoutes(app: express.Express) {
  app.get("/api/media/assets/:id/stream", async (req, res) => {
    try {
      const requestUser = await resolveRequestUser(req, { allowGuest: true });
      const asset = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
      if (!asset || !asset.storageKey) throw new HttpError(404, "Media not found.");
      if (!canReadMediaAsset(requestUser, asset)) throw new HttpError(404, "Media not found.");

      const filePath = resolveLocalUploadPath(asset.storageKey);
      if (!fs.existsSync(filePath)) throw new HttpError(404, "Media file not found.");
      markMediaAssetAccessed(asset.id);

      const stat = fs.statSync(filePath);
      const mimeType = asset.mimeType || "application/octet-stream";
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", asset.visibility === "PUBLIC" ? "public, max-age=3600" : "private, no-store");
      const range = parseMediaRange(typeof req.headers.range === "string" ? req.headers.range : undefined, stat.size);
      if (range.kind !== "none") {
        if (range.kind === "invalid") {
          res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
          return;
        }
        res.writeHead(206, {
          "Content-Range": range.contentRange,
          "Accept-Ranges": "bytes",
          "Content-Length": range.contentLength,
          "Content-Type": mimeType
        });
        fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes"
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (error: any) {
      sendApiError(res, error, "Failed to stream media.");
    }
  });

  app.post("/api/images/upload", requireUploadAuth, uploadSingle("image"), async (req, res) => {
    try {
      console.log("[Server] Received POST request on /api/images/upload");
      if (!req.file) {
        res.status(400).json({ success: false, error: "No image file uploaded." });
        return;
      }

      const requestUser = await requireAuth(req);
      await assertUploadedFileAccepted(requestUser, req.file);
      const mimeType = effectiveUploadMime(req.file);
      const url = `/uploads/${req.file.filename}`;
      const asset = await recordLocalMediaAsset({
        requestUser,
        type: MediaAssetType.IMAGE,
        url,
        filePath: req.file.path,
        originalName: req.file.originalname,
        mimeType,
        visibility: MediaVisibility.OWNER_ONLY
      });

      const streamUrl = asset ? protectedMediaUrl(asset.id) : url;
      console.log("[Server] Image upload successful.");
      res.json({ success: true, url: streamUrl, assetId: asset?.id || null, originalName: req.file.originalname, mimeType });
    } catch (err: any) {
      deleteUploadedFile(req.file);
      const requestUser = await resolveRequestUser(req, { allowGuest: true }).catch(() => null);
      if (requestUser) {
        await writeAuditLog({
          actor: requestUser,
          action: "ACCESS",
          entityType: "MediaUpload",
          req,
          metadata: {
            decision: "denied",
            route: "/api/images/upload",
            reason: err?.message || "Upload rejected.",
            originalName: req.file?.originalname || null,
            mimeType: req.file?.mimetype || null,
            size: req.file?.size || null
          }
        });
      }
      console.error("[Server] Image upload route exception:", err);
      res.status(err?.status || 400).json({ success: false, error: publicUploadErrorMessage(err) });
    }
  });

  app.post("/api/media/upload", requireUploadAuth, uploadSingle("file"), async (req, res) => {
    try {
      console.log("[Server] Received POST request on /api/media/upload");
      if (!req.file) {
        res.status(400).json({ success: false, error: "No media file uploaded." });
        return;
      }

      const requestUser = await requireAuth(req);
      await assertUploadedFileAccepted(requestUser, req.file);
      const mimeType = effectiveUploadMime(req.file);
      const url = `/uploads/${req.file.filename}`;
      const asset = await recordLocalMediaAsset({
        requestUser,
        url,
        filePath: req.file.path,
        originalName: req.file.originalname,
        mimeType,
        visibility: MediaVisibility.OWNER_ONLY
      });

      const streamUrl = asset ? protectedMediaUrl(asset.id) : url;
      console.log("[Server] Media upload successful.");
      res.json({ success: true, url: streamUrl, assetId: asset?.id || null, originalName: req.file.originalname, mimeType });
    } catch (err: any) {
      deleteUploadedFile(req.file);
      const requestUser = await resolveRequestUser(req, { allowGuest: true }).catch(() => null);
      if (requestUser) {
        await writeAuditLog({
          actor: requestUser,
          action: "ACCESS",
          entityType: "MediaUpload",
          req,
          metadata: {
            decision: "denied",
            route: "/api/media/upload",
            reason: err?.message || "Upload rejected.",
            originalName: req.file?.originalname || null,
            mimeType: req.file?.mimetype || null,
            size: req.file?.size || null
          }
        });
      }
      console.error("[Server] Media upload route exception:", err);
      res.status(err?.status || 400).json({ success: false, error: publicUploadErrorMessage(err) });
    }
  });
}
