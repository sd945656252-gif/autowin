/**
 * High-quality Lanczos-3 Image Resampling Filter
 */
export function lanczosResample(
  img: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = img.naturalWidth;
      srcCanvas.height = img.naturalHeight;
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) {
        throw new Error('Could not get src 2d context');
      }
      srcCtx.drawImage(img, 0, 0);
      const srcData = srcCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);

      const destCanvas = document.createElement('canvas');
      destCanvas.width = targetWidth;
      destCanvas.height = targetHeight;
      const destCtx = destCanvas.getContext('2d');
      if (!destCtx) {
        throw new Error('Could not get dest 2d context');
      }
      const destData = destCtx.createImageData(targetWidth, targetHeight);

      const a = 3; // Lanczos filter size (3 is standard for high-quality)
      const lanczos = (x: number) => {
        if (x === 0) return 1;
        if (x < -a || x > a) return 0;
        const piX = Math.PI * x;
        return (Math.sin(piX) * Math.sin(piX / a)) / ((piX * piX) / a);
      };

      const sW = img.naturalWidth;
      const sH = img.naturalHeight;
      const dW = targetWidth;
      const dH = targetHeight;

      const scaleX = sW / dW;
      const scaleY = sH / dH;

      for (let cy = 0; cy < dH; cy++) {
        for (let cx = 0; cx < dW; cx++) {
          const gx = (cx + 0.5) * scaleX - 0.5;
          const gy = (cy + 0.5) * scaleY - 0.5;

          const gxi = Math.floor(gx);
          const gyi = Math.floor(gy);

          let red = 0, green = 0, blue = 0, alpha = 0;
          let weightSum = 0;

          // Kernel loop
          for (let j = gyi - a + 1; j <= gyi + a; j++) {
            if (j < 0 || j >= sH) continue;
            const dy = gy - j;
            const wy = lanczos(dy);
            if (wy === 0) continue;

            for (let i = gxi - a + 1; i <= gxi + a; i++) {
              if (i < 0 || i >= sW) continue;
              const dx = gx - i;
              const wx = lanczos(dx);
              const weight = wx * wy;

              if (weight <= 0) continue;

              const srcIdx = (j * sW + i) * 4;
              red += srcData.data[srcIdx] * weight;
              green += srcData.data[srcIdx + 1] * weight;
              blue += srcData.data[srcIdx + 2] * weight;
              alpha += srcData.data[srcIdx + 3] * weight;
              weightSum += weight;
            }
          }

          const destIdx = (cy * dW + cx) * 4;
          if (weightSum > 0) {
            destData.data[destIdx] = Math.min(255, Math.max(0, red / weightSum));
            destData.data[destIdx + 1] = Math.min(255, Math.max(0, green / weightSum));
            destData.data[destIdx + 2] = Math.min(255, Math.max(0, blue / weightSum));
            destData.data[destIdx + 3] = Math.min(255, Math.max(0, alpha / weightSum));
          } else {
            // Fallback to bilinear on failure
            const srcIdx = (gyi * sW + gxi) * 4;
            destData.data[destIdx] = srcData.data[srcIdx];
            destData.data[destIdx + 1] = srcData.data[srcIdx + 1];
            destData.data[destIdx + 2] = srcData.data[srcIdx + 2];
            destData.data[destIdx + 3] = srcData.data[srcIdx + 3];
          }
        }
      }

      destCtx.putImageData(destData, 0, 0);
      resolve(destCanvas.toDataURL('image/jpeg', 0.95));
    } catch (err) {
      reject(err);
    }
  });
}
