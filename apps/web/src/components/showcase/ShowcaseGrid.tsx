import { ChevronRight, Pencil, Plus, Video } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import {
  FALLBACK_SHOWCASE_METADATA,
  MAIN_SHOWCASE_KEYS,
  getNextExtraShowcaseKey,
  sortShowcaseKeys,
  type ShowcaseMetadata
} from '../../data/showcase';

type ShowcaseGridProps = {
  videos: Record<string, string | null>;
  metadata: Record<string, ShowcaseMetadata>;
  uploadingKeys: Record<string, boolean>;
  uploadProgress: Record<string, number>;
  canEdit: boolean;
  onAddSlot: (key: string) => void;
  onEditSlot: (key: string) => void;
  onCardClick: (key: string, title: string) => void;
  onSelectWork: (key: string) => void;
  onVideoTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void;
};

function setPreviewAudio(card: HTMLDivElement, muted: boolean) {
  const video = card.querySelector('video');
  if (!video) return;
  video.muted = muted;
  if (!muted) {
    video.play().catch(() => {
      video.muted = true;
    });
  }
}

export function ShowcaseGrid({
  videos,
  metadata,
  uploadingKeys,
  uploadProgress,
  canEdit,
  onAddSlot,
  onEditSlot,
  onCardClick,
  onSelectWork,
  onVideoTimeUpdate
}: ShowcaseGridProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold border-l-4 border-white pl-3">精选作品</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => onAddSlot(getNextExtraShowcaseKey(videos))}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg text-xs font-bold transition-all cursor-pointer group"
          >
            <Plus className="w-3.5 h-3.5 text-gray-400 group-hover:text-indigo-400 transition-colors" />
            <span>添加作品</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
        {Object.keys(videos)
          .filter((key) => videos[key] !== null || MAIN_SHOWCASE_KEYS.includes(key))
          .sort(sortShowcaseKeys)
          .map((key) => {
            const itemMetadata = metadata[key] || FALLBACK_SHOWCASE_METADATA;
            const videoUrl = videos[key];
            const isUploading = uploadingKeys[key];

            return (
              <div
                key={key}
                onClick={() => onCardClick(key, itemMetadata.title)}
                onMouseEnter={(event) => setPreviewAudio(event.currentTarget, false)}
                onMouseLeave={(event) => setPreviewAudio(event.currentTarget, true)}
                className="glass-panel rounded-xl aspect-video relative group cursor-pointer overflow-hidden border border-white/10 shadow-[0_4px_24px_rgba(0,0,0,0.4)] hover:border-white/20 transition-all duration-300"
              >
                {videoUrl ? (
                  <video
                    key={videoUrl}
                    src={videoUrl}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-102"
                    onTimeUpdate={onVideoTimeUpdate}
                    onError={() => console.warn(`Showcase preview playback failed for ${key}.`)}
                  />
                ) : (
                  <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center text-gray-500 transition-colors duration-300 gap-2">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/5">
                      <Video className="w-4 h-4 text-zinc-600" />
                    </div>
                    <p className="text-[11px] font-medium text-zinc-500">等待上传视频</p>
                  </div>
                )}

                {isUploading && (
                  <div className="absolute top-3 left-3 z-30 bg-black/85 border border-indigo-500/40 backdrop-blur-md rounded-lg px-2.5 py-1 flex items-center gap-2 select-none pointer-events-none">
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-ping" />
                    <span className="text-[10px] font-bold text-indigo-400 font-mono uppercase tracking-wider">
                      {uploadProgress[key] !== undefined ? `同步中 ${uploadProgress[key]}%` : '同步中...'}
                    </span>
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex justify-between items-end z-20">
                  <div>
                    <p className="text-[10px] font-medium text-gray-400 tracking-wider uppercase font-mono">{itemMetadata.category}</p>
                    <h3 className="text-base font-bold text-white tracking-wider mt-0.5">{itemMetadata.title}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectWork(key);
                    }}
                    className="text-[10px] text-blue-300 hover:text-white font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    详情 <ChevronRight className="w-3" />
                  </button>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditSlot(key);
                    }}
                    className="absolute top-3 right-3 z-30 rounded-full border border-white/10 bg-black/60 p-2 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                    title="编辑精选作品"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </>
  );
}
