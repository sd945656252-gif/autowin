const MEDIA_DATA_URL_PATTERN = /^data:(image|video|audio)\/[a-z0-9.+-]+;base64,/i;

export function isMediaDataUrl(value: string) {
  return MEDIA_DATA_URL_PATTERN.test(value);
}

export function isBlobUrl(value: string) {
  return value.startsWith('blob:');
}

export function isLocalMediaRef(value: string) {
  return value.startsWith('local-media://');
}

export function parseUrlSafely(value: string) {
  try {
    return new URL(value, window.location.origin);
  } catch {
    return null;
  }
}

export function isSameOriginUploadUrl(value: string) {
  const parsed = parseUrlSafely(value);
  return !!parsed
    && parsed.origin === window.location.origin
    && parsed.pathname.startsWith('/uploads/');
}

export function isRelativeUploadUrl(value: string) {
  return value.startsWith('/uploads/');
}

export function isHttpUrl(value: string) {
  const parsed = parseUrlSafely(value);
  return !!parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
}

export function isSafeRenderableMediaUrl(value: string) {
  return isBlobUrl(value)
    || isLocalMediaRef(value)
    || isMediaDataUrl(value)
    || isSameOriginUploadUrl(value)
    || isHttpUrl(value);
}

export function canFetchMediaInBrowser(value: string) {
  return isBlobUrl(value) || isMediaDataUrl(value) || isSameOriginUploadUrl(value);
}

export function shouldPersistMediaInIndexedDb(value: string) {
  return isMediaDataUrl(value) || isSameOriginUploadUrl(value) || isRelativeUploadUrl(value);
}

export function sanitizeDownloadFilename(filename: string) {
  const cleaned = filename
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 180) || `media_${Date.now()}`;
}
