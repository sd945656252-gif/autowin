import { set } from 'idb-keyval';
import { isMediaDataUrl, shouldPersistMediaInIndexedDb } from './safeUrl';

const MAX_INDEXED_DB_MEDIA_BYTES = 25 * 1024 * 1024;

/**
 * Converts a temporary URL (e.g. server-side /uploads/ or base64) to a local-media:// reference
 * backed by browser's localized IndexedDB persistence.
 */
export async function makeUrlPermanent(url: string, filenameSuffix: string = 'media'): Promise<string> {
  if (!url) return url;
  
  // If it's already a local-media reference or a known placeholder, bypass
  if (
    url.startsWith('local-media://') || 
    url === '[LOCAL_CACHE_ONLY]'
  ) {
    return url;
  }
  
  if (!shouldPersistMediaInIndexedDb(url)) {
    return url;
  }
  
  try {
    let base64Data = '';
    
    if (isMediaDataUrl(url)) {
      base64Data = url;
    } else {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Failed to fetch media data: ${response.statusText}`);
      }
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') && !blob.type.startsWith('video/') && !blob.type.startsWith('audio/')) {
        throw new Error(`Unsupported media type: ${blob.type || 'unknown'}`);
      }
      if (blob.size > MAX_INDEXED_DB_MEDIA_BYTES) {
        throw new Error(`Media is too large for browser persistence: ${blob.size} bytes`);
      }
      
      base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read blob as Data URL'));
        reader.readAsDataURL(blob);
      });
    }
    
    const mediaId = `med_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${filenameSuffix}`;
    const localRef = `local-media://${mediaId}`;
    
    // Store in browser's local IndexedDB
    await set(mediaId, base64Data);
    
    return localRef;
  } catch (error) {
    console.warn(`[LocalPersistence] Could not cache media locally to IndexedDB, falling back to original url:`, error);
    return url;
  }
}
