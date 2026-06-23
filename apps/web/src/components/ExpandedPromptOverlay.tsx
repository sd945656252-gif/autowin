import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Check, Maximize2 } from 'lucide-react';
import MentionEditor from './MentionEditor';

interface MediaItem {
  url: string;
  type: 'image' | 'video' | 'audio';
  name: string;
}

interface ExpandedPromptOverlayProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  mediaList?: MediaItem[];
  title?: string;
  placeholder?: string;
  accentColor?: string;
}

export default function ExpandedPromptOverlay({
  value,
  onChange,
  onClose,
  mediaList = [],
  title = "提示词编辑器",
  placeholder = "输入提示词...",
  accentColor = "cyan"
}: ExpandedPromptOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  const bgColorMap: Record<string, string> = {
    cyan: "bg-cyan-500",
    green: "bg-green-500",
    indigo: "bg-indigo-500",
    amber: "bg-amber-500"
  };

  const content = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 sm:p-20"
    >
      <motion.div
        ref={containerRef}
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full max-w-4xl glass-panel rounded-2xl border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden h-[70vh] max-h-[800px]"
      >
        {/* Header */}
        <div className="p-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${bgColorMap[accentColor]} bg-opacity-10 text-white`}>
              <Maximize2 className={`w-5 h-5 text-${accentColor}-400`} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-widest uppercase font-mono">{title}</h3>
              <p className="text-[10px] text-zinc-500 font-mono mt-0.5 uppercase tracking-tighter">极影系统高级文本编辑器 • 实时云同步已激活</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-zinc-500 hover:text-white hover:bg-white/5 rounded-full transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 relative bg-black/20">
          <MentionEditor
            value={value}
            onChange={onChange}
            mediaList={mediaList}
            placeholder={placeholder}
            expanded={true}
            className="border-none"
          />
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 flex items-center justify-between bg-white/[0.01]">
          <div className="flex items-center gap-2 text-zinc-500">
             <div className={`w-1.5 h-1.5 rounded-full ${bgColorMap[accentColor]} animate-pulse opacity-50`} />
             <span className="text-[10px] font-mono tracking-widest uppercase">状态: 正在编辑中</span>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className={`flex items-center gap-2 px-8 py-3 rounded-xl bg-white text-black hover:bg-zinc-200 transition-all text-sm font-bold tracking-widest uppercase cursor-pointer shadow-lg shadow-black/20`}
            >
              <Check className="w-4 h-4" />
              确认修改
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );

  return createPortal(content, document.body);
}
