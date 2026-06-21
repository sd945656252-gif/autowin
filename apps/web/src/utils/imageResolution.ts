export function getImageDimensions(
  model: string,
  ratio: string,
  resolutionLevel?: string,
  _quality?: string,
  sizeConstraints?: {
    minTotalPixels?: number;
    maxTotalPixels?: number;
    maxEdge?: number;
    multipleOf?: number;
    maxLongToShortRatio?: number;
  }
): { w: number; h: number } {
  const activeRatio = ratio || '1:1';
  const activeLevel = resolutionLevel || '1K';

  const exactSizeMatch = activeLevel.match(/^(\d{3,5})x(\d{3,5})$/i);
  if (exactSizeMatch) {
    return { w: Number(exactSizeMatch[1]), h: Number(exactSizeMatch[2]) };
  }

  if (sizeConstraints) {
    let rX = 1;
    let rY = 1;
    const parts = activeRatio.split(':');
    if (parts.length === 2) {
      rX = parseInt(parts[0], 10) || 1;
      rY = parseInt(parts[1], 10) || 1;
    }
    const maxRatio = sizeConstraints.maxLongToShortRatio || 3;
    if (Math.max(rX, rY) / Math.min(rX, rY) > maxRatio) {
      rX = 1;
      rY = 1;
    }
    const targetPixels = activeLevel === '4K'
      ? Math.min(sizeConstraints.maxTotalPixels || 8294400, 3840 * 2160)
      : activeLevel === '2K'
        ? Math.min(sizeConstraints.maxTotalPixels || 8294400, 2048 * 2048)
        : Math.max(sizeConstraints.minTotalPixels || 655360, 1024 * 1024);
    const ratioValue = rX / rY;
    let w = Math.sqrt(targetPixels * ratioValue);
    let h = w / ratioValue;
    const maxEdge = sizeConstraints.maxEdge || 3840;
    if (w > maxEdge) {
      w = maxEdge;
      h = w / ratioValue;
    }
    if (h > maxEdge) {
      h = maxEdge;
      w = h * ratioValue;
    }
    const multipleOf = sizeConstraints.multipleOf || 16;
    w = Math.max(multipleOf, Math.floor(w / multipleOf) * multipleOf);
    h = Math.max(multipleOf, Math.floor(h / multipleOf) * multipleOf);
    const minPixels = sizeConstraints.minTotalPixels || 0;
    if (w * h < minPixels) {
      const scale = Math.sqrt(minPixels / (w * h));
      w = Math.min(maxEdge, Math.ceil((w * scale) / multipleOf) * multipleOf);
      h = Math.min(maxEdge, Math.ceil((h * scale) / multipleOf) * multipleOf);
    }
    return { w, h };
  }

  // --- 1. Distinct precise resolutions for gpt-image-2 ---
  if (model === 'gpt-image-2') {
    let rX = 1;
    let rY = 1;
    const parts = activeRatio.split(':');
    if (parts.length === 2) {
      rX = parseInt(parts[0], 10) || 1;
      rY = parseInt(parts[1], 10) || 1;
    }
    const ratioValue = activeRatio === 'auto' ? 1 : rX / rY;
    const targetPixels = activeLevel === '4K' ? 3840 * 2160 : activeLevel === '2K' ? 2048 * 2048 : 1536 * 1024;
    let w = Math.sqrt(targetPixels * ratioValue);
    let h = w / ratioValue;
    if (w > 3840) {
      w = 3840;
      h = w / ratioValue;
    }
    if (h > 3840) {
      h = 3840;
      w = h * ratioValue;
    }
    return {
      w: Math.max(16, Math.floor(w / 16) * 16),
      h: Math.max(16, Math.floor(h / 16) * 16)
    };
  }

  // --- 2. Distinct precise resolutions for nano-banana-2 / nano-banana-pro ---
  if (['nano-banana-2', 'nano-banana-pro', 'gemini-3.1-flash-image', 'gemini-3-pro-image'].includes(model)) {
    if (activeLevel === '0.5K' || activeLevel === '512') {
      switch (activeRatio) {
        case '1:1': return { w: 512, h: 512 };
        case '1:4': return { w: 256, h: 1024 };
        case '1:8': return { w: 192, h: 1536 };
        case '2:3': return { w: 424, h: 632 };
        case '3:2': return { w: 632, h: 424 };
        case '3:4': return { w: 448, h: 600 };
        case '4:1': return { w: 1024, h: 256 };
        case '4:3': return { w: 600, h: 448 };
        case '4:5': return { w: 464, h: 576 };
        case '5:4': return { w: 576, h: 464 };
        case '8:1': return { w: 1536, h: 192 };
        case '9:16': return { w: 384, h: 688 };
        case '16:9': return { w: 688, h: 384 };
        case '21:9': return { w: 792, h: 168 };
        default: return { w: 512, h: 512 };
      }
    } else if (activeLevel === '1K') {
      switch (activeRatio) {
        case '1:1': return { w: 1024, h: 1024 };
        case '1:4': return { w: 512, h: 2048 };
        case '1:8': return { w: 384, h: 3072 };
        case '2:3': return { w: 848, h: 1264 };
        case '3:2': return { w: 1264, h: 848 };
        case '3:4': return { w: 896, h: 1200 };
        case '4:1': return { w: 2048, h: 512 };
        case '4:3': return { w: 1200, h: 896 };
        case '4:5': return { w: 928, h: 1152 };
        case '5:4': return { w: 1152, h: 928 };
        case '8:1': return { w: 3072, h: 384 };
        case '9:16': return { w: 768, h: 1376 };
        case '16:9': return { w: 1376, h: 768 };
        case '21:9': return { w: 1584, h: 672 };
        default: return { w: 1024, h: 1024 };
      }
    } else if (activeLevel === '2K') {
      switch (activeRatio) {
        case '1:1': return { w: 2048, h: 2048 };
        case '1:4': return { w: 1024, h: 4096 };
        case '1:8': return { w: 768, h: 6144 };
        case '2:3': return { w: 1696, h: 2528 };
        case '3:2': return { w: 2528, h: 1696 };
        case '3:4': return { w: 1792, h: 2400 };
        case '4:1': return { w: 4096, h: 1024 };
        case '4:3': return { w: 2400, h: 1792 };
        case '4:5': return { w: 1856, h: 2304 };
        case '5:4': return { w: 2304, h: 1856 };
        case '8:1': return { w: 6144, h: 768 };
        case '9:16': return { w: 1536, h: 2752 };
        case '16:9': return { w: 2752, h: 1536 };
        case '21:9': return { w: 3168, h: 1344 };
        default: return { w: 2048, h: 2048 };
      }
    } else { // 4K
      switch (activeRatio) {
        case '1:1': return { w: 4096, h: 4096 };
        case '1:4': return { w: 2048, h: 8192 };
        case '1:8': return { w: 1536, h: 12288 };
        case '2:3': return { w: 3392, h: 5056 };
        case '3:2': return { w: 5056, h: 3392 };
        case '3:4': return { w: 3584, h: 4800 };
        case '4:1': return { w: 8192, h: 2048 };
        case '4:3': return { w: 4800, h: 3584 };
        case '4:5': return { w: 3712, h: 4608 };
        case '5:4': return { w: 4608, h: 3712 };
        case '8:1': return { w: 12288, h: 1536 };
        case '9:16': return { w: 3072, h: 5504 };
        case '16:9': return { w: 5504, h: 3072 };
        case '21:9': return { w: 6336, h: 2688 };
        default: return { w: 4096, h: 4096 };
      }
    }
  }

  // --- 3. Dynamic mathematical fallback for any other custom API models ---
  let rX = 1;
  let rY = 1;
  if (activeRatio === '自适应' || !activeRatio) {
    rX = 1;
    rY = 1;
  } else {
    const parts = activeRatio.split(':');
    if (parts.length === 2) {
      rX = parseInt(parts[0]) || 1;
      rY = parseInt(parts[1]) || 1;
    }
  }

  const base = activeLevel === '4K' ? 4096 : activeLevel === '2K' ? 2048 : activeLevel === '0.5K' ? 512 : 1024;
  let w = base;
  let h = base;
  if (activeRatio === '自适应') {
    w = base;
    h = base;
  } else if (rX > rY) {
    w = base;
    h = Math.round((base * rY) / rX);
  } else if (rY > rX) {
    h = base;
    w = Math.round((base * rX) / rY);
  } else {
    w = base;
    h = base;
  }

  // Align to multiples of 32 for modern model latent compatibility
  w = Math.round(w / 32) * 32;
  h = Math.round(h / 32) * 32;

  return { w, h };
}
