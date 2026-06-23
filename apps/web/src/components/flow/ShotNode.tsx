import React, { useState } from 'react';
import { CanvasNode } from '../../types';
import { Trash2, Film, Maximize2, Download } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { downloadMedia } from '../../utils/download';
import { useTempMedia } from '../../hooks/useTempMedia';
import MediaZoomOverlay from '../MediaZoomOverlay';

interface ShotNodeProps {
  node: CanvasNode;
  isSelected: boolean;
  isEditing: boolean;
  renameText: string;
  onRenameChange: (value: string) => void;
  onStartRename: (e: React.MouseEvent) => void;
  onSaveRename: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onSelect: (e: React.MouseEvent) => void;
  onUpdate: (fields: Partial<CanvasNode>) => void;
}

export default function ShotNode({
  node,
  isSelected,
  isEditing,
  renameText,
  onRenameChange,
  onStartRename,
  onSaveRename,
  onDelete,
  onSelect
}: ShotNodeProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const rawMediaUrl = node.generated_media || '';
  const resolvedTempMedia = useTempMedia(rawMediaUrl === '[LOCAL_CACHE_ONLY]' ? undefined : rawMediaUrl);
  const mediaUrl = rawMediaUrl === '[LOCAL_CACHE_ONLY]' ? resolvedTempMedia : (resolvedTempMedia || rawMediaUrl);
  const isVideo = mediaUrl?.toLowerCase().endsWith('.mp4') || mediaUrl?.includes('video');

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mediaUrl) return;
    const filename = `${node.name || 'shot'}_${node.id.slice(0, 4)}.${isVideo ? 'mp4' : 'jpg'}`;
    downloadMedia(mediaUrl, filename);
  };

  return (
    <div
      onClick={onSelect}
      className={`node-box glass-panel rounded-xl border flex flex-col z-10 group relative transition-all duration-300 w-[380px] overflow-hidden ${
        isSelected
          ? 'border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.4)]'
          : 'border-white/10 shadow-2xl hover:border-white/20'
      }`}
    >
      {/* Header */}
      <div className="p-3 border-b border-white/5 flex justify-between items-center bg-white/5">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          {isEditing ? (
            <input
              type="text"
              value={renameText}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onSaveRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveRename();
              }}
              onClick={(e) => e.stopPropagation()}
              className="nodrag w-44 bg-transparent border-b border-green-500 px-0.5 text-[11px] font-bold text-white tracking-widest uppercase font-mono outline-none"
              autoFocus
            />
          ) : (
            <span
              onDoubleClick={onStartRename}
              className="max-w-[240px] cursor-text truncate text-[11px] font-bold text-white tracking-widest uppercase font-mono transition-colors hover:text-green-300"
              title="双击重命名"
            >
              {node.name || '镜头节点'}
            </span>
          )}
        </div>
        <button
          onClick={onDelete}
          className="text-zinc-500 hover:text-white transition-colors p-1 hover:bg-white/10 rounded"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Media Content */}
      <div className="aspect-video bg-[#1a1a1a] relative group/media overflow-hidden">
        {mediaUrl ? (
          <>
            {isVideo ? (
              <video
                src={mediaUrl}
                className="w-full h-full object-cover"
                controls={false}
                autoPlay
                muted
                loop
              />
            ) : (
              <img
                src={mediaUrl}
                alt="Preview"
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/media:opacity-100 transition-opacity flex items-center justify-center gap-4">
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true); }}
                className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all transform hover:scale-110 active:scale-95 border border-white/20"
                title="放大预览"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
              <button
                onClick={handleDownload}
                className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all transform hover:scale-110 active:scale-95 border border-white/20"
                title="下载媒体"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 space-y-2">
            <Film className="w-12 h-12 opacity-20" />
            <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">等待审核内容传输</span>
          </div>
        )}
      </div>

      {/* Decorative dots for tree connection */}
      <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-green-500 rounded-full border border-black shadow-lg" />

      {/* Full-screen Preview */}
      <AnimatePresence>
        {previewOpen && mediaUrl && (
          <MediaZoomOverlay
            src={mediaUrl}
            type={isVideo ? 'video' : 'image'}
            name={node.name}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
