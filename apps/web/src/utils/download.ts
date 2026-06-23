import { canFetchMediaInBrowser, sanitizeDownloadFilename } from './safeUrl';

export const downloadMedia = async (url: string, filename: string) => {
  const safeFilename = sanitizeDownloadFilename(filename);

  if (!canFetchMediaInBrowser(url)) {
    console.warn('Download blocked for non-local media URL. Use server-side persistence before downloading external media.', url);
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = safeFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('Download failed:', err);
  }
};
