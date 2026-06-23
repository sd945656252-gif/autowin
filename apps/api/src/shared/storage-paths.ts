import path from "path";

export function getUploadsDir() {
  const configured = process.env.UPLOADS_DIR || "uploads";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

export function getPrivateStorageDir() {
  const configured = process.env.PRIVATE_STORAGE_DIR || "storage/private";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

export function getUploadFilePath(filename: string) {
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(uploadsDir, filename);
  const relative = path.relative(uploadsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Upload file path escapes uploads directory.");
  }
  return resolved;
}
