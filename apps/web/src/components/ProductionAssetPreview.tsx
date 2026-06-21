import { FileText, Film, Image, Music } from 'lucide-react';
import type { InternalAssetItem, ProductionAsset, ProductionAssetSnapshot } from '../types';

type PreviewInput = {
  item?: InternalAssetItem;
  asset?: ProductionAsset | null;
  snapshot?: ProductionAssetSnapshot | null;
  heightClassName?: string;
};

function fileExtension(name?: string | null, mimeType?: string | null) {
  const ext = (name || '').split('.').pop();
  if (ext && ext !== name) return ext.toUpperCase().slice(0, 8);
  if (mimeType?.includes('/')) return mimeType.split('/').pop()?.toUpperCase().slice(0, 8) || 'FILE';
  return 'FILE';
}

export function ProductionAssetPreview({ item, asset: directAsset, snapshot: directSnapshot, heightClassName = 'h-44' }: PreviewInput) {
  const snapshot = directSnapshot || item?.snapshot || null;
  const asset = directAsset || item?.asset || snapshot?.asset || null;
  const streamUrl = snapshot?.streamUrl || asset?.streamUrl;
  const mimeType = item?.mimeType || snapshot?.mimeType || asset?.mimeType || '';
  const originalName = item?.originalName || snapshot?.originalName || asset?.originalName || '';
  const name = item?.displayName || snapshot?.displayName || asset?.displayName || originalName || '素材预览';

  if (!streamUrl) {
    return (
      <div className="mt-3 flex min-h-24 items-center gap-3 rounded border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-zinc-400">
        <FileText className="h-4 w-4 text-zinc-500" />
        <span>该素材暂无可预览文件，保留文本或结构化内容。</span>
      </div>
    );
  }

  if (mimeType.startsWith('image/')) {
    return (
      <a href={streamUrl} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded border border-white/10 bg-black/40 hover:border-cyan-400/30" title="点击查看图片">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[11px] font-semibold text-zinc-300">
          <Image className="h-3.5 w-3.5 text-cyan-300" /> 图片预览
        </div>
        <img src={streamUrl} alt={name} loading="lazy" className={`${heightClassName} w-full object-contain`} />
      </a>
    );
  }

  if (mimeType.startsWith('video/')) {
    return (
      <a href={streamUrl} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded border border-white/10 bg-black/40 hover:border-cyan-400/30" title="点击查看视频">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[11px] font-semibold text-zinc-300">
          <Film className="h-3.5 w-3.5 text-cyan-300" /> 视频帧预览
        </div>
        <video src={`${streamUrl}#t=0.1`} preload="metadata" muted playsInline className={`pointer-events-none ${heightClassName} w-full bg-black object-contain`} />
      </a>
    );
  }

  if (mimeType.startsWith('audio/')) {
    return (
      <div className="mt-3 rounded border border-white/10 bg-black/30 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-zinc-300">
          <Music className="h-3.5 w-3.5 text-cyan-300" /> 音频预览
        </div>
        <audio src={streamUrl} controls className="w-full" />
      </div>
    );
  }

  return (
    <a href={streamUrl} target="_blank" rel="noreferrer" className="mt-3 flex min-h-24 items-center gap-3 rounded border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-semibold text-zinc-200 hover:border-cyan-400/30 hover:bg-white/[0.08]" title="点击查看文件">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-cyan-400/20 bg-cyan-400/10 font-mono text-[11px] text-cyan-100">
        {fileExtension(originalName, mimeType)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-white">{originalName || name}</span>
        <span className="mt-1 block text-[11px] text-zinc-500">点击打开查看完整内容</span>
      </span>
    </a>
  );
}
