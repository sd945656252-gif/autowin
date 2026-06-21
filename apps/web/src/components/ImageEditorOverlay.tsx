import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { X, Check, Crop, Sliders, Loader2, Lock, Unlock } from 'lucide-react';
import { lanczosResample } from '../utils/lanczos';

interface ImageEditorOverlayProps {
  src: string;
  type: 'generated' | 'uploaded';
  index?: number;
  initialTab?: 'crop' | 'resize';
  maxResolution?: number; // based on current model limits
  onClose: () => void;
  onConfirm: (finalUrl: string) => void;
}

function dataURLtoFile(dataurl: string, filename: string): File {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

export default function ImageEditorOverlay({
  src,
  type,
  index,
  initialTab = 'crop',
  maxResolution = 1024,
  onClose,
  onConfirm
}: ImageEditorOverlayProps) {
  const [activeTab, setActiveTab] = useState<'crop' | 'resize'>(initialTab);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Image references for size calculations
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);

  // Cropping states
  const [cropRatio, setCropRatio] = useState<'free' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9'>('free');
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });
  
  // Resizing states
  const [resizeWidth, setResizeWidth] = useState(1024);
  const [resizeHeight, setResizeHeight] = useState(1024);
  const [resizeRatioLocked, setResizeRatioLocked] = useState(true);
  const originalAspectRef = useRef<number>(1);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);

  // Dragging states
  const [isDragging, setIsDragging] = useState(false);
  const dragModeRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ mX: number; mY: number; cX: number; cY: number; cW: number; cH: number }>({
    mX: 0,
    mY: 0,
    cX: 0,
    cY: 0,
    cW: 0,
    cH: 0
  });

  // Load natural image dimensions and init resize inputs
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    img.onload = () => {
      setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
      setResizeWidth(img.naturalWidth);
      setResizeHeight(img.naturalHeight);
      originalAspectRef.current = img.naturalWidth / img.naturalHeight;
    };
  }, [src]);

  // Handle image element resize / loaded metadata to compute visual bounding box
  const handleImageLoaded = () => {
    if (!imgRef.current) return;
    const width = imgRef.current.clientWidth;
    const height = imgRef.current.clientHeight;
    // Prevent zero dimension issues
    if (width === 0 || height === 0) return;
    setImgDims({ w: width, h: height });
    
    // Default Crop Box to 90% centered window inside visual area
    const defaultW = Math.round(width * 0.9);
    const defaultH = Math.round(height * 0.9);
    setCropRect({
      x: Math.round((width - defaultW) / 2),
      y: Math.round((height - defaultH) / 2),
      w: defaultW,
      h: defaultH
    });
    setCropRatio('free');
  };

  // Trigger layout calculations immediately if the image has already cached and loaded
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.clientWidth > 0) {
      handleImageLoaded();
    }
  }, [src]);

  // Adjust aspect ratio crop box dynamically based on selected preset
  const applyAspectPreset = (ratioPreset: typeof cropRatio) => {
    setCropRatio(ratioPreset);
    if (!imgDims) return;

    const imgW = imgDims.w;
    const imgH = imgDims.h;

    if (ratioPreset === 'free') {
      // Freeform crop: maximize to 100% size
      const w = imgW;
      const h = imgH;
      setCropRect({
        x: 0,
        y: 0,
        w,
        h
      });
      return;
    }

    // Split and map numerical aspect bounds
    let aspect = 1;
    if (ratioPreset === '1:1') aspect = 1;
    else if (ratioPreset === '16:9') aspect = 16 / 9;
    else if (ratioPreset === '9:16') aspect = 9 / 16;
    else if (ratioPreset === '4:3') aspect = 4 / 3;
    else if (ratioPreset === '3:4') aspect = 3 / 4;
    else if (ratioPreset === '21:9') aspect = 21 / 9;

    let targetW = 0;
    let targetH = 0;

    if (imgW / imgH > aspect) {
      // Image is wider than selected aspect ratio template: match full vertical height
      targetH = imgH;
      targetW = Math.round(targetH * aspect);
    } else {
      // Image is narrower than selected aspect ratio template: match full horizontal width
      targetW = imgW;
      targetH = Math.round(targetW / aspect);
    }

    // Double check scaling overflow bounds
    if (targetW > imgW) {
      targetW = imgW;
      targetH = Math.round(targetW / aspect);
    }
    if (targetH > imgH) {
      targetH = imgH;
      targetW = Math.round(targetH * aspect);
    }

    setCropRect({
      x: Math.round((imgW - targetW) / 2),
      y: Math.round((imgH - targetH) / 2),
      w: targetW,
      h: targetH
    });
  };

  // Drag Handler pointers setup
  const handlePointerDown = (e: React.MouseEvent, handle: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragModeRef.current = handle;
    setIsDragging(true);
    dragStartRef.current = {
      mX: e.clientX,
      mY: e.clientY,
      cX: cropRect.x,
      cY: cropRect.y,
      cW: cropRect.w,
      cH: cropRect.h
    };
  };

  // Drag Movement Processor
  useEffect(() => {
    const handlePointerMove = (e: MouseEvent) => {
      if (!dragModeRef.current || !imgDims) return;

      // Real-time button release safety guard (e.g. if released outside iframe/view bounds)
      if (e.buttons === 0) {
        dragModeRef.current = null;
        setIsDragging(false);
        return;
      }

      const imgW = imgDims.w;
      const imgH = imgDims.h;

      const dx = e.clientX - dragStartRef.current.mX;
      const dy = e.clientY - dragStartRef.current.mY;

      let nextX = dragStartRef.current.cX;
      let nextY = dragStartRef.current.cY;
      let nextW = dragStartRef.current.cW;
      let nextH = dragStartRef.current.cH;

      const dragMode = dragModeRef.current;

      if (dragMode === 'move') {
        nextX = Math.max(0, Math.min(imgW - nextW, dragStartRef.current.cX + dx));
        nextY = Math.max(0, Math.min(imgH - nextH, dragStartRef.current.cY + dy));
      } else {
        // Handle coordinates deformation based on directions
        if (dragMode.includes('w')) {
          const maxLeft = dragStartRef.current.cX + dragStartRef.current.cW - 40;
          nextX = Math.max(0, Math.min(maxLeft, dragStartRef.current.cX + dx));
          nextW = dragStartRef.current.cW - (nextX - dragStartRef.current.cX);
        }
        if (dragMode.includes('e')) {
          nextW = Math.max(40, Math.min(imgW - dragStartRef.current.cX, dragStartRef.current.cW + dx));
        }
        if (dragMode.includes('n')) {
          const maxTop = dragStartRef.current.cY + dragStartRef.current.cH - 40;
          nextY = Math.max(0, Math.min(maxTop, dragStartRef.current.cY + dy));
          nextH = dragStartRef.current.cH - (nextY - dragStartRef.current.cY);
        }
        if (dragMode.includes('s')) {
          nextH = Math.max(40, Math.min(imgH - dragStartRef.current.cY, dragStartRef.current.cH + dy));
        }

        // Apply ratio constraint if locked
        if (cropRatio !== 'free') {
          let aspect = 1;
          if (cropRatio === '1:1') aspect = 1;
          else if (cropRatio === '16:9') aspect = 16 / 9;
          else if (cropRatio === '9:16') aspect = 9 / 16;
          else if (cropRatio === '4:3') aspect = 4 / 3;
          else if (cropRatio === '3:4') aspect = 3 / 4;
          else if (cropRatio === '21:9') aspect = 21 / 9;

          if (dragMode === 'e' || dragMode === 'w' || dragMode.includes('e') || dragMode.includes('w')) {
            nextH = nextW / aspect;
            if (nextY + nextH > imgH) {
              nextH = imgH - nextY;
              nextW = nextH * aspect;
              if (dragMode.includes('w')) {
                nextX = dragStartRef.current.cX + dragStartRef.current.cW - nextW;
              }
            }
          } else {
            nextW = nextH * aspect;
            if (nextX + nextW > imgW) {
              nextW = imgW - nextX;
              nextH = nextW / aspect;
              if (dragMode.includes('n')) {
                nextY = dragStartRef.current.cY + dragStartRef.current.cH - nextH;
              }
            }
          }
        }
      }

      setCropRect({
        x: Math.round(nextX),
        y: Math.round(nextY),
        w: Math.round(nextW),
        h: Math.round(nextH)
      });
    };

    const handlePointerUp = () => {
      dragModeRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [cropRect, cropRatio, imgDims]);

  // Execute High-Res Crop operation
  const handleConfirmCrop = async () => {
    if (!naturalDims || !imgDims) return;
    setLoading(true);
    setErrorMsg('');

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // Calculate relative coordinates in percentage mapping
      const scaleX = img.naturalWidth / imgDims.w;
      const scaleY = img.naturalHeight / imgDims.h;

      const srcX = Math.max(0, Math.round(cropRect.x * scaleX));
      const srcY = Math.max(0, Math.round(cropRect.y * scaleY));
      const srcW = Math.min(img.naturalWidth - srcX, Math.round(cropRect.w * scaleX));
      const srcH = Math.min(img.naturalHeight - srcY, Math.round(cropRect.h * scaleY));

      const canvas = document.createElement('canvas');
      canvas.width = srcW;
      canvas.height = srcH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not request HTML5 canvas rendering surface');

      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      const croppedBase64 = canvas.toDataURL('image/jpeg', 0.95);

      // Submit base64 outcome
      const file = dataURLtoFile(croppedBase64, `crop_${Date.now()}.jpg`);
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('裁剪网络保存失败');
      const data = await res.json();
      if (!data.success || !data.url) throw new Error(data.error || '解析上传统道失败');

      onConfirm(data.url);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || '裁剪执行出错');
    } finally {
      setLoading(false);
    }
  };

  // Execute High-Res Lanczos-3 Resampler
  const handleConfirmResize = async () => {
    setLoading(true);
    setErrorMsg('');

    const targetW = Math.min(maxResolution, Math.max(64, resizeWidth));
    const targetH = Math.min(maxResolution, Math.max(64, resizeHeight));

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const resizedBase64 = await lanczosResample(img, targetW, targetH);
      const file = dataURLtoFile(resizedBase64, `resize_${Date.now()}.jpg`);
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('尺寸保存网络出错');
      const data = await res.json();
      if (!data.success || !data.url) throw new Error(data.error || '缩放后保存通道失败');

      onConfirm(data.url);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || '高保真缩放重采样失败');
    } finally {
      setLoading(false);
    }
  };

  // Close with ESC key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, loading]);

  return createPortal(
    <AnimatePresence>
      <div 
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="fixed inset-0 z-[100000] bg-zinc-950/95 backdrop-blur-md flex flex-col justify-between overflow-hidden select-none"
      >
        
        {/* Editor Titlebar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-zinc-950">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20 text-cyan-400">
              {activeTab === 'crop' ? <Crop className="w-4 h-4" /> : <Sliders className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 font-sans tracking-wide">
                {activeTab === 'crop' ? '智能高级裁剪编辑器' : '高保真参数尺寸重塑器'}
              </h3>
              <p className="text-[10px] text-zinc-300 font-mono">
                {type === 'generated' ? '编辑类型: 生成画卷' : `编辑类型: 参考图卷 #${(index ?? 0) + 1}`}
                {naturalDims && ` | 原图尺寸: ${naturalDims.w} × ${naturalDims.h} px`}
              </p>
            </div>
          </div>

          {/* Toggle Editors */}
          <div className="flex bg-[#0a0a0c] border border-white/5 rounded-xl p-1 gap-1">
            <button
              onClick={() => {
                setActiveTab('crop');
                setErrorMsg('');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-sans transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'crop'
                  ? 'bg-cyan-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Crop className="w-3.5 h-3.5" />
              <span>裁剪比例</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('resize');
                setErrorMsg('');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-sans transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'resize'
                  ? 'bg-cyan-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>重塑尺寸</span>
            </button>
          </div>

          {/* Close Editor button */}
          <button
            onClick={onClose}
            disabled={loading}
            className="text-zinc-400 hover:text-rose-400 border border-white/10 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-md hover:bg-zinc-900 cursor-pointer disabled:opacity-40 transition-all active:scale-95 duration-150"
            title="关闭编辑器 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Core Editor Visual Canvas area */}
        <div ref={containerRef} className="flex-1 min-h-0 relative flex items-center justify-center p-8 bg-[#0a0b12]/50 overflow-hidden">
          <div className="relative inline-block select-none max-w-full max-h-full">
            <img
              ref={imgRef}
              src={src}
              alt="Editor target context"
              className="max-w-[75vw] max-h-[60vh] object-contain rounded-lg border border-white/10 select-none pointer-events-none"
              onLoad={handleImageLoaded}
              referrerPolicy="no-referrer"
            />

            {/* Render Crop Frame logic */}
            {activeTab === 'crop' && imgDims && cropRect && (
              <div
                className={`absolute border-2 border-cyan-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.75)] cursor-move ${isDragging ? 'transition-none' : 'transition-all duration-150'}`}
                style={{
                  left: `${cropRect.x}px`,
                  top: `${cropRect.y}px`,
                  width: `${cropRect.w}px`,
                  height: `${cropRect.h}px`
                }}
                onMouseDown={(e) => handlePointerDown(e, 'move')}
              >
                {/* 3x3 Grid Lines */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                  <div className="border-r border-b border-dashed border-cyan-400/50"></div>
                  <div className="border-r border-b border-dashed border-cyan-400/50"></div>
                  <div className="border-b border-cyan-400/50"></div>
                  <div className="border-r border-b border-dashed border-cyan-400/50"></div>
                  <div className="border-r border-b border-dashed border-cyan-400/50"></div>
                  <div className="border-b border-cyan-400/50"></div>
                  <div className="border-r border-cyan-400/50"></div>
                  <div className="border-r border-cyan-400/50"></div>
                  <div></div>
                </div>

                {/* Resizing handles with visual neon glow markers */}
                <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-cyan-400 border border-black cursor-nwse-resize rounded-full shadow-[0_0_8px_rgba(34,211,238,0.6)]" onMouseDown={(e) => handlePointerDown(e, 'nw')} />
                <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-cyan-400 border border-black cursor-nesw-resize rounded-full shadow-[0_0_8px_rgba(34,211,238,0.6)]" onMouseDown={(e) => handlePointerDown(e, 'ne')} />
                <div className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-cyan-400 border border-black cursor-nwse-resize rounded-full shadow-[0_0_8px_rgba(34,211,238,0.6)]" onMouseDown={(e) => handlePointerDown(e, 'se')} />
                <div className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-cyan-400 border border-black cursor-nesw-resize rounded-full shadow-[0_0_8px_rgba(34,211,238,0.6)]" onMouseDown={(e) => handlePointerDown(e, 'sw')} />
                
                {/* Horizontal / Vertical edges handle bars */}
                <div className="absolute -top-1 left-4 right-4 h-2 cursor-n-resize" onMouseDown={(e) => handlePointerDown(e, 'n')} />
                <div className="absolute -bottom-1 left-4 right-4 h-2 cursor-s-resize" onMouseDown={(e) => handlePointerDown(e, 's')} />
                <div className="absolute -left-1 top-4 bottom-4 w-2 cursor-w-resize" onMouseDown={(e) => handlePointerDown(e, 'w')} />
                <div className="absolute -right-1 top-4 bottom-4 w-2 cursor-e-resize" onMouseDown={(e) => handlePointerDown(e, 'e')} />
              </div>
            )}
          </div>
        </div>

        {/* Editor Bottom control center bar */}
        <div className="px-6 py-5 bg-zinc-950 border-t border-white/5 space-y-4">
          
          {/* Error Prompt Guard */}
          {errorMsg && (
            <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-2 rounded-xl text-xs max-w-2xl mx-auto font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-6xl mx-auto">
            {/* Context parameters adjusting panels */}
            <div className="w-full sm:w-auto flex-1">
              
              {/* Cropping Presets Selector */}
              {activeTab === 'crop' && (
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] text-zinc-300 uppercase font-bold tracking-wider font-mono">裁剪比例预设 (CROP ASPECT PRESET)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(['free', '1:1', '16:9', '9:16', '4:3', '3:4', '21:9'] as const).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => applyAspectPreset(ratio)}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition-all cursor-pointer ${
                          cropRatio === ratio
                            ? 'bg-cyan-500 text-black border-cyan-500 hover:bg-cyan-400 shadow-[0_2px_10px_rgba(6,182,212,0.35)]'
                            : 'border-white/10 bg-white/10 text-zinc-200 hover:text-white hover:border-cyan-400/50'
                        }`}
                      >
                        {ratio.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* High-quality Resizing Form Configuration */}
              {activeTab === 'resize' && (
                <div className="flex flex-col gap-3">
                  <span className="text-[10px] text-zinc-300 uppercase font-bold tracking-wider font-mono">高质量LANCZO-3重采样设置</span>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-zinc-300">W:</span>
                        <input
                          type="number"
                          value={resizeWidth}
                          min={64}
                          max={maxResolution}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setResizeWidth(val);
                            if (resizeRatioLocked && originalAspectRef.current && val > 0) {
                              setResizeHeight(Math.round(val / originalAspectRef.current));
                            }
                          }}
                          className="w-16 bg-transparent text-xs text-zinc-100 font-mono focus:outline-none focus:text-cyan-400 border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-zinc-300 text-[10px] scale-90 font-mono">px</span>
                      </div>

                      <div className="h-4 w-[1px] bg-white/10 mx-1"></div>

                      <button
                        type="button"
                        onClick={() => setResizeRatioLocked(!resizeRatioLocked)}
                        className={`p-1 rounded-full transition-colors ${
                          resizeRatioLocked ? 'text-cyan-400 bg-cyan-400/5' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                        }`}
                        title={resizeRatioLocked ? '比例联动: 已锁定' : '比例联动: 已解锁'}
                      >
                        {resizeRatioLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>

                      <div className="h-4 w-[1px] bg-white/10 mx-1"></div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-zinc-300">H:</span>
                        <input
                          type="number"
                          value={resizeHeight}
                          min={64}
                          max={maxResolution}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setResizeHeight(val);
                            if (resizeRatioLocked && originalAspectRef.current && val > 0) {
                              setResizeWidth(Math.round(val * originalAspectRef.current));
                            }
                          }}
                          className="w-16 bg-transparent text-xs text-zinc-100 font-mono focus:outline-none focus:text-cyan-400 border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-zinc-300 text-[10px] scale-90 font-mono">px</span>
                      </div>
                    </div>

                    <div className="text-[10px] text-zinc-300 font-mono">
                      * 宽高范围限制: 64px 至 {maxResolution}px
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Side Buttons */}
            <div className="w-full sm:w-auto flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 font-bold text-xs cursor-pointer select-none transition-all duration-150 disabled:opacity-40 font-sans"
              >
                取消
              </button>

              {loading ? (
                <div className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-5 py-2.5 rounded-xl font-mono text-xs font-bold animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>核心重构计算中...</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={activeTab === 'crop' ? handleConfirmCrop : handleConfirmResize}
                  className="px-6 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black font-extrabold text-xs cursor-pointer select-none transition-all duration-150 shadow-[0_4px_15px_rgba(34,211,238,0.25)] hover:shadow-[0_4px_20px_rgba(34,211,238,0.4)] hover:scale-[1.02] active:scale-95 flex items-center gap-1.5 font-sans"
                >
                  <Check className="w-4 h-4" />
                  <span>确认并应用变更</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
