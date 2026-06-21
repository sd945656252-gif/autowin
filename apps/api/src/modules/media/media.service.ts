import crypto from "crypto";
import fs from "fs";
import path from "path";
import { MediaAssetType, MediaVisibility, UserRole } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { safeAxiosGet } from "../../security/safe-outbound";
import { HttpError } from "../../shared/http";
import { getUploadsDir } from "../../shared/storage-paths";
import type { RequestUser } from "../auth/auth.shared";

const DEFAULT_GENERATED_MEDIA_MAX_MB = 100;
const generatedMediaMaxMb = Number(process.env.GENERATED_MEDIA_MAX_MB || DEFAULT_GENERATED_MEDIA_MAX_MB);
const generatedMediaMaxBytes = Math.max(1, generatedMediaMaxMb) * 1024 * 1024;
const DEFAULT_USER_UPLOAD_QUOTA_MB = 500;
const userUploadQuotaMb = Number(process.env.USER_UPLOAD_QUOTA_MB || DEFAULT_USER_UPLOAD_QUOTA_MB);
const userUploadQuotaBytes = Math.max(1, userUploadQuotaMb) * 1024 * 1024;
const ALLOWED_GENERATED_MEDIA_TYPES = new Set(["image", "video", "audio"]);

export type LocalMediaAssetRecord = Awaited<ReturnType<typeof recordLocalMediaAsset>>;

function assertAllowedMediaMime(mimeType: string) {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  const family = normalized?.split("/")[0];
  if (!normalized || !family || !ALLOWED_GENERATED_MEDIA_TYPES.has(family)) {
    throw new HttpError(400, "Generated media must be an image, video, or audio file.");
  }
  return normalized;
}

function extensionFromMime(mimeType: string) {
  const subtype = mimeType.split("/")[1] || "bin";
  const safeSubtype = subtype.split("+")[0].replace(/[^a-z0-9.-]/gi, "").toLowerCase();
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "video/quicktime") return "mov";
  return safeSubtype || "bin";
}

export function mediaAssetTypeFromMime(mimeType?: string | null): MediaAssetType {
  if (mimeType?.startsWith("image/")) return MediaAssetType.IMAGE;
  if (mimeType?.startsWith("video/")) return MediaAssetType.VIDEO;
  if (mimeType?.startsWith("audio/")) return MediaAssetType.AUDIO;
  return MediaAssetType.DOCUMENT;
}

export async function recordLocalMediaAsset(input: {
  requestUser: RequestUser;
  type?: MediaAssetType;
  url: string;
  filePath: string;
  originalName?: string | null;
  mimeType?: string | null;
  visibility?: MediaVisibility;
  metadata?: Record<string, any>;
}) {
  const sizeBytes = fs.existsSync(input.filePath) ? fs.statSync(input.filePath).size : null;
  const storageKey = input.url.startsWith("/uploads/") ? input.url.slice("/uploads/".length) : input.url;
  return prisma.mediaAsset.create({
    data: {
      ownerId: input.requestUser.isGuest ? null : input.requestUser.id,
      type: input.type || mediaAssetTypeFromMime(input.mimeType),
      url: input.url,
      storageKey,
      mimeType: input.mimeType || null,
      sizeBytes,
      visibility: input.visibility || (input.requestUser.isGuest ? MediaVisibility.PUBLIC : MediaVisibility.OWNER_ONLY),
      metadata: {
        originalName: input.originalName || null,
        storage: "local",
        ...(input.metadata || {})
      },
      lastAccessedAt: new Date()
    }
  }).catch((error) => {
    console.warn("[MediaAsset] Failed to record local media asset:", error);
    if (fs.existsSync(input.filePath)) {
      try {
        fs.rmSync(input.filePath, { force: true });
      } catch (unlinkError) {
        console.warn("[MediaAsset] Failed to remove untracked local media file:", unlinkError);
      }
    }
    throw new HttpError(500, "Failed to record uploaded media asset.");
  });
}

export function markMediaAssetAccessed(assetId: string) {
  prisma.mediaAsset.update({
    where: { id: assetId },
    data: { lastAccessedAt: new Date() }
  }).catch((error) => {
    console.warn("[MediaAsset] Failed to update lastAccessedAt:", error);
  });
}

export function protectedMediaUrl(assetId: string) {
  return `/api/media/assets/${encodeURIComponent(assetId)}/stream`;
}

export function canReadMediaAsset(requestUser: RequestUser, asset: { ownerId: string | null; visibility: MediaVisibility }) {
  if (asset.visibility === MediaVisibility.PUBLIC) return true;
  if (requestUser.isGuest) return false;
  if (requestUser.role === UserRole.ADMIN) return true;
  if (asset.visibility === MediaVisibility.OWNER_ONLY) return asset.ownerId === requestUser.id;
  if (asset.visibility === MediaVisibility.DEVELOPER_ONLY) return requestUser.role === UserRole.DEVELOPER;
  return false;
}

export function resolveLocalUploadPath(storageKey: string) {
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(uploadsDir, storageKey);
  const relative = path.relative(uploadsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, "Invalid media storage key.");
  }
  return resolved;
}

export async function findMediaAssetByStorageKey(storageKey: string) {
  return prisma.mediaAsset.findFirst({
    where: { storageKey },
    orderBy: { createdAt: "desc" }
  });
}

export async function assertUserUploadQuota(requestUser: RequestUser, nextUploadBytes: number) {
  if (requestUser.isGuest) {
    throw new HttpError(401, "Authentication is required.");
  }
  const aggregate = await prisma.mediaAsset.aggregate({
    where: { ownerId: requestUser.id },
    _sum: { sizeBytes: true }
  });
  const usedBytes = aggregate._sum.sizeBytes || 0;
  if (usedBytes + nextUploadBytes > userUploadQuotaBytes) {
    throw new HttpError(413, `Upload quota exceeded. Limit is ${userUploadQuotaMb}MB per user.`);
  }
}

export async function saveGeneratedToLocalFile(mediaData: string, requestUser?: RequestUser): Promise<string> {
  if (!mediaData) return mediaData;

  try {
    const uploadsDir = getUploadsDir();
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const secureToken = crypto.randomUUID();
    const filename = `generated-${Date.now()}-${secureToken}`;

    if (mediaData.startsWith("data:")) {
      const match = mediaData.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = assertAllowedMediaMime(match[1]);
        const base64Data = match[2];
        const buffer = Buffer.from(base64Data, "base64");
        if (buffer.length > generatedMediaMaxBytes) {
          throw new HttpError(413, `Generated media exceeds ${generatedMediaMaxMb}MB.`);
        }
        const ext = extensionFromMime(mimeType);
        const finalFilename = `${filename}.${ext}`;
        const filePath = path.join(uploadsDir, finalFilename);
        fs.writeFileSync(filePath, buffer);
        console.log("[Media] Saved generated base64 media locally.");
        if (requestUser) {
          const asset = await recordLocalMediaAsset({
            requestUser,
            type: mediaAssetTypeFromMime(mimeType),
            url: `/uploads/${finalFilename}`,
            filePath,
            mimeType,
            visibility: MediaVisibility.OWNER_ONLY,
            metadata: { generated: true }
          });
          if (asset) return protectedMediaUrl(asset.id);
        }
        return `/uploads/${finalFilename}`;
      }
    }

    if (mediaData.startsWith("http://") || mediaData.startsWith("https://")) {
      console.log("[Media] Downloading generated remote media to local storage.");
      const response = await safeAxiosGet(mediaData, {
        label: "generated media URL",
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: generatedMediaMaxBytes,
        maxBodyLength: generatedMediaMaxBytes,
        validateStatus: null
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Generated media download failed with HTTP ${response.status}.`);
      }
      const rawContentType = response.headers["content-type"] || "image/png";
      const contentType = assertAllowedMediaMime(typeof rawContentType === "string" ? rawContentType : String(rawContentType));
      const buffer = Buffer.from(response.data);
      if (buffer.length > generatedMediaMaxBytes) {
        throw new HttpError(413, `Generated media exceeds ${generatedMediaMaxMb}MB.`);
      }
      const ext = extensionFromMime(contentType);
      const finalFilename = `${filename}.${ext}`;
      const filePath = path.join(uploadsDir, finalFilename);
      fs.writeFileSync(filePath, buffer);
      console.log("[Media] Saved remote generated media locally.");
      if (requestUser) {
        const asset = await recordLocalMediaAsset({
          requestUser,
          type: mediaAssetTypeFromMime(contentType),
          url: `/uploads/${finalFilename}`,
          filePath,
          mimeType: contentType,
          visibility: MediaVisibility.OWNER_ONLY,
          metadata: { generated: true, source: "remote" }
        });
        if (asset) return protectedMediaUrl(asset.id);
      }
      return `/uploads/${finalFilename}`;
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("[Media] Failed to persist generated media locally:", error);
  }

  return mediaData;
}
