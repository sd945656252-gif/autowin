import { useState, useEffect } from "react";
import { get } from "idb-keyval";

export function useTempMedia(sourceUrl: string | undefined): string | undefined {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;

    if (!sourceUrl) {
      setResolvedUrl(undefined);
      return;
    }

    // Handles IndexedDB virtual local media system
    if (sourceUrl.startsWith("local-media://")) {
      const mediaId = sourceUrl.split("local-media://")[1];
      get(mediaId)
        .then((data) => {
          if (active && data) {
            setResolvedUrl(data as string);
          }
        })
        .catch((err) => {
          console.error("Failed to load local IndexedDB media", err);
        });
      return;
    }

    // Legacy temp-media:// values cannot be resolved in local-only mode.
    if (sourceUrl.startsWith("temp-media://")) {
      setResolvedUrl(undefined);
      return;
    }

    // Direct URLs (standard HTTP or base64 data)
    setResolvedUrl(sourceUrl);

    return () => {
      active = false;
    };
  }, [sourceUrl]);

  if (!sourceUrl) return undefined;
  if (sourceUrl === "[LOCAL_CACHE_ONLY]") return undefined;
  
  if (sourceUrl.startsWith("local-media://") || sourceUrl.startsWith("temp-media://")) {
    return resolvedUrl;
  }
  
  return sourceUrl;
}
