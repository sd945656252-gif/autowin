import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import getCaretCoordinates from 'textarea-caret';
import { motion, AnimatePresence } from 'motion/react';
import { Image, Video, Music } from 'lucide-react';
import { useTempMedia } from '../hooks/useTempMedia';

interface MediaItem {
  url: string;
  type: 'image' | 'video' | 'audio';
  name: string;
}

interface MentionEditorProps {
  value: string;
  onChange: (value: string) => void;
  mediaList: MediaItem[];
  placeholder?: string;
  className?: string;
  expanded?: boolean;
}

// Sub-component to handle media protocol resolution gracefully
function MediaPreview({ item }: { item: MediaItem }) {
  const resolvedUrl = useTempMedia(item.url);
  
  if (!resolvedUrl) {
    return <div className="w-full h-32 bg-zinc-800 animate-pulse rounded-lg flex items-center justify-center">
      <LoaderIndicator type={item.type} />
    </div>;
  }

  if (item.type === 'image') {
    return <img src={resolvedUrl} className="w-full h-32 object-cover rounded-lg border border-white/5" referrerPolicy="no-referrer" />;
  }
  
  if (item.type === 'video') {
    return <video src={resolvedUrl} className="w-full h-32 object-cover rounded-lg border border-white/5" muted playsInline />;
  }
  
  return (
    <div className="w-full h-32 bg-cyan-950/20 rounded-lg border border-white/5 flex flex-col items-center justify-center p-4">
      <Music className="w-8 h-8 text-cyan-400 mb-2" />
      <div className="w-full space-y-1">
        <div className="h-1 bg-cyan-400/20 rounded-full w-full" />
        <div className="h-1 bg-cyan-400/40 rounded-full w-3/4" />
      </div>
    </div>
  );
}

function LoaderIndicator({ type }: { type: 'image' | 'video' | 'audio' }) {
  if (type === 'image') return <Image className="w-6 h-6 text-zinc-600" />;
  if (type === 'video') return <Video className="w-6 h-6 text-zinc-600" />;
  return <Music className="w-6 h-6 text-zinc-600" />;
}

export default function MentionEditor({
  value,
  onChange,
  mediaList,
  placeholder = "输入提示词，输入 @ 调用附件...",
  className = "",
  expanded = false
}: MentionEditorProps) {
  const [showList, setShowList] = useState(false);
  const [cursorPos, setCursorPos] = useState({ top: 0, left: 0 });
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  useEffect(() => {
    if (expanded && textareaRef.current && isFirstRender.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
      isFirstRender.current = false;
    }
  }, [expanded]);

  // Group and label media
  const labeledMedia = React.useMemo(() => {
    const counts = { image: 0, video: 0, audio: 0 };
    return mediaList.map(item => {
      counts[item.type]++;
      return {
        ...item,
        label: `@${item.type}${counts[item.type]}`
      };
    });
  }, [mediaList]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showList) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(prev => (prev + 1) % labeledMedia.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(prev => (prev - 1 + labeledMedia.length) % labeledMedia.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        insertMention(labeledMedia[focusedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowList(false);
      }
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const start = e.target.selectionStart;
    const lastChar = newValue.slice(start - 1, start);

    if (lastChar === '@') {
      const coords = getCaretCoordinates(e.target, start);
      const rect = e.target.getBoundingClientRect();
      setCursorPos({
        top: rect.top + coords.top + 20,
        left: rect.left + coords.left
      });
      setTriggerPos(start);
      setShowList(true);
      setFocusedIndex(0);
    } else if (showList) {
      // If user typed something after @, we might filter, but requirement says just show list on @
      // Let's hide if space or no @ behind
      const textBefore = newValue.slice(0, start);
      if (!textBefore.includes('@') || lastChar === ' ') {
        setShowList(false);
      }
    }

    onChange(newValue);
  };

  const insertMention = (item: typeof labeledMedia[0]) => {
    if (triggerPos === null || !textareaRef.current) return;
    
    const before = value.slice(0, triggerPos - 1);
    const after = value.slice(textareaRef.current.selectionStart);
    const mention = `${item.label} `;
    
    const nextValue = before + mention + after;
    onChange(nextValue);
    setShowList(false);
    
    // Focus back and set cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const nextPos = before.length + mention.length;
        textareaRef.current.setSelectionRange(nextPos, nextPos);
      }
    }, 0);
  };

  // Atomic deletion logic for @ labels
  const handleKeyUpOrDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Backspace' && textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      
      if (start === end && start > 0) {
        const textBefore = value.slice(0, start);
        // Check if we are at the end of a mention label e.g. "@image1 "
        const match = textBefore.match(/(@(image|video|audio)\d+)\s$/);
        if (match) {
          const fullMatch = match[0];
          e.preventDefault();
          const nextValue = value.slice(0, start - fullMatch.length) + value.slice(start);
          onChange(nextValue);
        }
      }
    }
  };

  // Rendering the "pill" overlay
  // We use the same font and padding as the textarea
  const renderHighlights = () => {
    const parts = value.split(/(@(?:image|video|audio)\d+)/g);
    return parts.map((part, i) => {
      if (part.match(/^@(?:image|video|audio)\d+$/)) {
        return (
          <span key={i} className="text-green-400 font-bold bg-green-500/20 rounded shadow-[0_0_0_1px_rgba(34,197,94,0.3)]">
            {part}
          </span>
        );
      }
      return <span key={i} className="text-zinc-200">{part}</span>;
    });
  };

  const focusedItem = labeledMedia[focusedIndex];

  return (
    <div 
      className={`relative w-full overflow-hidden border border-white/5 rounded-xl bg-black/40 focus-within:border-green-500/30 transition-all ${expanded ? 'h-full flex flex-col' : 'h-28'} ${className}`}
    >
      {/* Highlight Backdrop */}
      <div 
        ref={backdropRef}
        className={`absolute inset-0 pointer-events-none whitespace-pre-wrap break-words overflow-y-auto overflow-x-hidden font-sans scrollbar-none border border-transparent ${expanded ? 'p-6 text-xl leading-relaxed' : 'p-4 text-[13px] leading-relaxed'}`}
        style={{ 
          color: 'transparent',
          letterSpacing: 'normal',
          wordSpacing: 'normal'
        }}
        aria-hidden="true"
      >
        {renderHighlights()}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUpOrDown}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
        className={`w-full h-full bg-transparent border-none text-transparent caret-zinc-200 outline-none resize-none transition-all placeholder:text-zinc-700 font-sans relative z-10 scrollbar-custom ${expanded ? 'p-6 text-xl leading-relaxed' : 'p-4 text-[13px] leading-relaxed'}`}
        style={{
          letterSpacing: 'normal',
          wordSpacing: 'normal'
        }}
      />

      {showList && labeledMedia.length > 0 && createPortal(
        <div 
          className="fixed z-[10001] flex gap-2 pointer-events-none"
          style={{ top: cursorPos.top, left: cursorPos.left }}
        >
          {/* Mention List */}
          <div 
            ref={listRef}
            className="w-48 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden py-1 pointer-events-auto"
          >
            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest font-mono">插入附件</span>
            </div>
            <div className="max-h-64 overflow-y-auto scrollbar-none">
              {labeledMedia.map((item, i) => (
                <div
                  key={i}
                  onMouseEnter={() => setFocusedIndex(i)}
                  onClick={() => insertMention(item)}
                  className={`px-3 py-2 flex items-center justify-between cursor-pointer transition-colors ${i === focusedIndex ? 'bg-green-500/20 text-white' : 'text-zinc-400 hover:text-white'}`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    {item.type === 'image' && <Image className="w-3 h-3 text-emerald-400 shrink-0" />}
                    {item.type === 'video' && <Video className="w-3 h-3 text-blue-400 shrink-0" />}
                    {item.type === 'audio' && <Music className="w-3 h-3 text-cyan-400 shrink-0" />}
                    <span className="text-xs font-mono font-bold">{item.label}</span>
                  </div>
                  <span className="text-[9px] opacity-30 truncate ml-2">{item.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Preview Box */}
          <AnimatePresence>
            {focusedItem && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="w-40 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-2 pointer-events-auto flex flex-col gap-2"
              >
                <MediaPreview item={focusedItem} />
                <div className="text-[10px] font-bold text-zinc-300 truncate px-1">
                  {focusedItem.name}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      , document.body)}
    </div>
  );
}
