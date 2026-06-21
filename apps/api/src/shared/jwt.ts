export function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, "base64");
}

export function decodeJwtPart<T>(value: string): T {
  return JSON.parse(base64UrlToBuffer(value).toString("utf8")) as T;
}
