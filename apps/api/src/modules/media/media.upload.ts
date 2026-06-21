import fs from "fs";
import path from "path";
import multer from "multer";
import { getUploadsDir } from "../../shared/storage-paths";

const DEFAULT_UPLOAD_MAX_MB = 25;
const uploadMaxMb = Number(process.env.UPLOAD_MAX_MB || DEFAULT_UPLOAD_MAX_MB);
const ALLOWED_UPLOAD_MIMES = new Set([
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
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const EXTENSION_BY_MIME = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"],
  ["video/x-msvideo", ".avi"],
  ["video/x-matroska", ".mkv"],
  ["audio/mpeg", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mp4", ".m4a"],
  ["audio/aac", ".aac"],
  ["audio/flac", ".flac"],
  ["audio/webm", ".webm"],
  ["audio/ogg", ".ogg"],
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["text/markdown", ".md"],
  ["text/csv", ".csv"],
  ["application/json", ".json"],
  ["application/zip", ".zip"],
  ["application/msword", ".doc"],
  ["application/vnd.ms-excel", ".xls"],
  ["application/vnd.ms-powerpoint", ".ppt"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"]
]);

const MIME_BY_EXTENSION = new Map<string, string>([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".avi", "video/x-msvideo"],
  [".mkv", "video/x-matroska"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".ogg", "audio/ogg"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".zip", "application/zip"]
]);

export function sanitizeUploadKey(value: unknown) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "upload";
  const basename = raw.replace(/[\\/]+/g, "-");
  const cleaned = basename
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "upload";
}

function safeExtension(file: Express.Multer.File) {
  const mimeExt = EXTENSION_BY_MIME.get(file.mimetype);
  if (mimeExt) return mimeExt;
  const originalExt = path.extname(file.originalname || "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  return originalExt && originalExt.length <= 12 ? originalExt : ".bin";
}

export function assertUploadPathInsideUploads(filename: string) {
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(uploadsDir, filename);
  if (resolved !== uploadsDir && !resolved.startsWith(`${uploadsDir}${path.sep}`)) {
    throw new Error("Resolved upload path escapes uploads directory.");
  }
  return resolved;
}

export function isAllowedUploadMime(mimeType: string) {
  return ALLOWED_UPLOAD_MIMES.has(mimeType.split(";")[0].trim().toLowerCase());
}

export function mimeFromUploadExtension(originalName: string) {
  return MIME_BY_EXTENSION.get(path.extname(originalName || "").toLowerCase()) || null;
}

export function effectiveUploadMime(file: Pick<Express.Multer.File, "mimetype" | "originalname">) {
  const declared = file.mimetype.split(";")[0].trim().toLowerCase();
  if (isAllowedUploadMime(declared) && declared !== "application/octet-stream") return declared;
  return mimeFromUploadExtension(file.originalname) || declared;
}

export function isAllowedUploadFile(file: Pick<Express.Multer.File, "mimetype" | "originalname">) {
  return isAllowedUploadMime(file.mimetype || "") || Boolean(mimeFromUploadExtension(file.originalname));
}

export function hasValidMagicNumber(buffer: Buffer, mimeType: string) {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/gif") return buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "video/mp4" || mime === "video/quicktime") return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  if (mime === "video/x-msvideo") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "AVI ";
  if (mime === "video/webm" || mime === "audio/webm" || mime === "video/x-matroska") return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  if (mime === "audio/mpeg") return (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) || buffer.subarray(0, 3).toString("ascii") === "ID3";
  if (mime === "audio/wav" || mime === "audio/x-wav") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE";
  if (mime === "audio/mp4" || mime === "audio/aac") return buffer.subarray(4, 8).toString("ascii") === "ftyp" || buffer[0] === 0xff;
  if (mime === "audio/flac") return buffer.subarray(0, 4).toString("ascii") === "fLaC";
  if (mime === "audio/ogg") return buffer.subarray(0, 4).toString("ascii") === "OggS";
  if (mime === "application/pdf") return buffer.subarray(0, 4).toString("ascii") === "%PDF";
  if (mime === "application/zip") return buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (mime.includes("openxmlformats-officedocument")) return buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (mime === "application/msword" || mime === "application/vnd.ms-excel" || mime === "application/vnd.ms-powerpoint") {
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/csv" || mime === "application/json") return !buffer.includes(0x00);
  return false;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadsDir = getUploadsDir();
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log("[Multer] Created missing upload directory.");
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const key = sanitizeUploadKey(req.body.key || req.query.key);
    const filename = `${key}-${uniqueSuffix}${safeExtension(file)}`;
    try {
      assertUploadPathInsideUploads(filename);
      cb(null, filename);
    } catch (error: any) {
      cb(error, filename);
    }
  }
});

export function createLocalUpload(maxMb = uploadMaxMb) {
  return multer({
    storage,
    fileFilter: (_req, file, cb) => {
      if (!isAllowedUploadFile(file)) {
        cb(new Error("Only supported image, video, audio, and document uploads are allowed."));
        return;
      }
      cb(null, true);
    },
    limits: {
      fileSize: Math.max(1, maxMb) * 1024 * 1024
    }
  });
}

export const upload = createLocalUpload();
