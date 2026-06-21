import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download, Gauge, Loader2 } from 'lucide-react';
import { downloadMedia } from '../utils/download';
import { useTempMedia } from '../hooks/useTempMedia';

interface MediaZoomOverlayProps {
  src: string;
  type: 'image' | 'video';
  name?: string;
  onClose: () => void;
}

export default function MediaZoomOverlay({ src, type, name, onClose }: MediaZoomOverlayProps) {
  const [isSecondaryZoomed, setIsSecondaryZoomed] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resolvedUrl = useTempMedia(src);

  // Sync video speed when rate or element changes
  useEffect(() => {
    if (type === 'video' && videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, type, resolvedUrl]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const filename = name || `media_${Date.now()}.${type === 'video' ? 'mp4' : 'png'}`;
    downloadMedia(resolvedUrl || src, filename);
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none cursor-pointer overflow-auto"
        onClick={onClose}
      >
        {/* Floating Controls in upper right corner of screen */}
        <div className="absolute top-6 right-6 z-[100000] flex items-center gap-3">
          {/* Download Button */}
          <button
            onClick={handleDownload}
            className="bg-black/60 hover:bg-zinc-900 border border-white/10 text-white hover:text-green-400 w-11 h-11 rounded-full backdrop-blur-md transition-all shadow-2xl transform active:scale-95 duration-150 cursor-pointer flex items-center justify-center hover:scale-105"
            title="下载到本地"
          >
            <Download className="w-5 h-5" />
          </button>

          {/* Close Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="bg-black/60 hover:bg-zinc-900 border border-white/10 text-white hover:text-rose-400 w-11 h-11 rounded-full backdrop-blur-md transition-all shadow-2xl transform active:scale-95 duration-150 cursor-pointer flex items-center justify-center hover:scale-105"
            title="关闭预览 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Media Frame Container */}
        <motion.div
          initial={{ scale: 0.95, y: 15 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 15 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="relative flex flex-col items-center justify-center max-w-full max-h-full p-4"
          onClick={(e) => e.stopPropagation()} // Prevent clicking media inside container from auto closing the overlay
        >
          {/* Active Rendering Frame */}
          {resolvedUrl ? (
            type === 'image' ? (
              <div className="relative group flex items-center justify-center max-h-[80vh] max-w-[85vw] overflow-visible">
                <img
                  src={resolvedUrl}
                  alt="Zoomed Reference Display"
                  referrerPolicy="no-referrer"
                  onClick={() => setIsSecondaryZoomed(prev => !prev)}
                  className={`rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] border border-white/10 transition-all duration-300 ease-out origin-center ${
                    isSecondaryZoomed
                      ? 'cursor-zoom-out scale-150 max-h-[75vh] max-w-[80vw]'
                      : 'cursor-zoom-in scale-100 max-h-[80vh] max-w-[85vw] hover:border-cyan-500/20'
                  }`}
                />
                {!isSecondaryZoomed && (
                  <div className="absolute -bottom-10 bg-black/60 backdrop-blur-md border border-white/5 py-1 px-3 rounded-full text-[10px] text-zinc-400 font-mono pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    点击图片可进行二次放大查看细节
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 max-w-[85vw]">
                <div className="relative bg-[#0d0d0d] rounded-xl overflow-hidden border border-white/10 shadow-2xl">
                  <video
                    ref={videoRef}
                    src={resolvedUrl}
                    controls
                    autoPlay
                    playsInline
                    loop
                    onLoadedMetadata={() => {
                      if (videoRef.current) {
                        videoRef.current.playbackRate = playbackSpeed;
                      }
                    }}
                    className="max-h-[70vh] max-w-[85vw] rounded-xl object-contain"
                  />
                </div>

                {/* Enhanced Floating Speed & Control Panel */}
                <div className="bg-zinc-950/90 backdrop-blur-md border border-white/5 px-4 py-2 rounded-2xl flex items-center gap-4 shadow-3xl">
                  <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[10px] font-bold uppercase tracking-wider">
                    <Gauge className="w-3.5 h-3.5 text-green-400" />
                    <span>播放速度 / Speed:</span>
                  </div>
                  <div className="flex bg-black/40 p-0.5 rounded-lg border border-white/5 gap-1">
                    {[0.5, 1.0, 1.5, 2.0].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setPlaybackSpeed(rate)}
                        className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                          playbackSpeed === rate
                            ? 'bg-zinc-805 text-white bg-zinc-800 border border-white/5'
                            : 'text-zinc-500 hover:text-zinc-200'
                        }`}
                      >
                        {rate.toFixed(1)}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="bg-zinc-950/50 backdrop-blur-3xl border border-white/5 p-12 rounded-2xl flex flex-col items-center justify-center">
               <Loader2 className="w-8 h-8 text-cyan-500 animate-spin mb-4" />
               <span className="text-zinc-400 font-mono text-[10px] uppercase tracking-widest animate-pulse">正在解密安全资源...</span>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
