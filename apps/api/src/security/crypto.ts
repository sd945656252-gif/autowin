import crypto from "crypto";
import { HttpError } from "../shared/http";

export function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || Buffer.byteLength(raw, "utf8") < 31) {
    throw new HttpError(500, "ENCRYPTION_KEY must be configured with at least 31 bytes before saving API keys.", "ENCRYPTION_KEY_TOO_SHORT", {
      currentBytes: raw ? Buffer.byteLength(raw, "utf8") : 0,
      requiredBytes: 31
    });
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(value: string): string {
  const [ivB64, tagB64, dataB64] = value.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new HttpError(400, "Encrypted secret payload is invalid.", "DECRYPT_INVALID_PAYLOAD");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new HttpError(500, "Failed to decrypt API key. Check ENCRYPTION_KEY configuration.", "DECRYPT_FAILED");
  }
}

export function createKeyPreview(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
