import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, FilePlus2, ImageIcon, Link2, Loader2, Music, Pause, Play, Save, Scissors, Search, Sparkles, Trash2, UploadCloud, Volume2, Wand2, ZoomIn, ZoomOut } from 'lucide-react';
import { createEditingProject, createProductionAsset, fetchEditingAssets, fetchEditingProject, fetchEditingProjects, saveEditingTimeline, submitProductionAssetReview } from '../lib/db';
import { EditingAsset, EditingClip, EditingProject, EditingTimeline, EditingTimelineEffect, EditingTimelineMarker, EditingTimelineTransition, EditingTrack, SlashAssetResolveResult } from '../types';
import { isStaleProductionAssetError, notifyProductionAssetsChanged, staleProductionAssetMessage } from '../utils/productionAssetErrors';
import SlashAssetPicker from './SlashAssetPicker';
import { EmptyState, InlineStatus, PageNotice } from './ui/State';

const PX_PER_SECOND_DEFAULT = 24;
const MIN_CLIP_MS = 300;
const SNAP_MS = 120;

function defaultTimeline(): EditingTimeline {
  return {
    version: 1,
    durationMs: 0,
    settings: { fps: 30, width: 1920, height: 1080, aspectRatio: '16:9' },
    tracks: [
      { id: 'v1', type: 'VIDEO', name: 'V1 主视频', clips: [] },
      { id: 'a1', type: 'AUDIO', name: 'A1 音频', clips: [] },
      { id: 't1', type: 'TEXT', name: 'T1 字幕', clips: [] }
    ]
  };
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(total / 60).toString().padStart(2, '0');
  const sec = (total % 60).toString().padStart(2, '0');
  const frame = Math.floor((ms % 1000) / 33).toString().padStart(2, '0');
  return `${min}:${sec}:${frame}`;
}

function msToPx(ms: number, pxPerSecond: number) {
  return (ms / 1000) * pxPerSecond;
}

function pxToMs(px: number, pxPerSecond: number) {
  return Math.max(0, Math.round((px / pxPerSecond) * 1000));
}

function pxDeltaToMs(px: number, pxPerSecond: number) {
  return Math.round((px / pxPerSecond) * 1000);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return '请求失败，请稍后重试。';
}

function isAssetAllowedOnTrack(asset: EditingAsset, track: EditingTrack) {
  if (track.type === 'VIDEO') return asset.kind === 'VIDEO' || asset.kind === 'IMAGE';
  if (track.type === 'AUDIO') return asset.kind === 'AUDIO';
  return false;
}

function defaultDurationForAsset(asset: EditingAsset) {
  if (asset.kind === 'IMAGE') return 5000;
  if (asset.kind === 'AUDIO') return 10000;
  return 6000;
}

function normalizeTimeline(timeline: EditingTimeline): EditingTimeline {
  const durationMs = timeline.tracks.reduce((max, track) => {
    return Math.max(max, ...track.clips.map((clip) => clip.startMs + clip.durationMs), 0);
  }, 0);
  return { ...timeline, durationMs };
}

function normalizeTimelineMarker(item: any, index: number): EditingTimelineMarker {
  const atMs = Math.max(0, Number(item.atMs ?? item.timeMs ?? item.startMs ?? item.atSeconds * 1000 ?? 0) || 0);
  return {
    id: String(item.id || `marker_ai_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`),
    atMs,
    label: String(item.label || item.name || item.text || `标记 ${index + 1}`).slice(0, 120),
    color: item.color ? String(item.color).slice(0, 32) : undefined
  };
}

function normalizeTimelineTransition(item: any, index: number): EditingTimelineTransition {
  const atMs = Math.max(0, Number(item.atMs ?? item.timeMs ?? item.startMs ?? item.atSeconds * 1000 ?? 0) || 0);
  return {
    id: String(item.id || `transition_ai_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`),
    atMs,
    type: String(item.type || item.name || 'transition').slice(0, 80),
    durationMs: item.durationMs || item.durationSeconds ? Math.max(100, Math.min(20_000, Number(item.durationMs || item.durationSeconds * 1000) || 800)) : undefined,
    fromClipId: item.fromClipId ? String(item.fromClipId) : undefined,
    toClipId: item.toClipId ? String(item.toClipId) : undefined
  };
}

function normalizeTimelineEffect(item: any, index: number): EditingTimelineEffect {
  const atMs = Math.max(0, Number(item.atMs ?? item.timeMs ?? item.startMs ?? item.atSeconds * 1000 ?? 0) || 0);
  return {
    id: String(item.id || `effect_ai_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`),
    atMs,
    type: String(item.type || item.name || 'effect').slice(0, 80),
    targetClipId: item.targetClipId ? String(item.targetClipId) : undefined,
    durationMs: item.durationMs || item.durationSeconds ? Math.max(100, Math.min(120_000, Number(item.durationMs || item.durationSeconds * 1000) || 1000)) : undefined,
    note: item.note || item.text ? String(item.note || item.text).slice(0, 240) : undefined
  };
}

function mergeTimelineMetadata(prev: EditingTimeline, patch: any): EditingTimeline['metadata'] {
  const metadata = prev.metadata || {};
  const markers = Array.isArray(patch.markers) ? patch.markers.map(normalizeTimelineMarker) : [];
  const transitions = Array.isArray(patch.transitions) ? patch.transitions.map(normalizeTimelineTransition) : [];
  const effects = Array.isArray(patch.effects) ? patch.effects.map(normalizeTimelineEffect) : [];
  return {
    ...metadata,
    markers: [...(metadata.markers || []), ...markers].slice(-100),
    transitions: [...(metadata.transitions || []), ...transitions].slice(-100),
    effects: [...(metadata.effects || []), ...effects].slice(-100)
  };
}

function productionAssetClipId(assetId: string, snapshotId?: string | null) {
  return `production:${assetId}:${snapshotId || ''}`;
}

function clipKindFromMime(mimeType?: string | null): Extract<EditingClip['kind'], 'VIDEO' | 'IMAGE' | 'AUDIO'> | null {
  if (mimeType?.startsWith('video/')) return 'VIDEO';
  if (mimeType?.startsWith('image/')) return 'IMAGE';
  if (mimeType?.startsWith('audio/')) return 'AUDIO';
  return null;
}

function staleAssetIdFromError(error: unknown) {
  const details = (error as { details?: { assetId?: unknown } } | null | undefined)?.details;
  return details?.assetId ? String(details.assetId) : null;
}

function sortClips(clips: EditingClip[]) {
  return [...clips].sort((a, b) => a.startMs - b.startMs);
}

function clampClipToTrack(track: EditingTrack, clip: EditingClip) {
  const others = sortClips(track.clips.filter((item) => item.id !== clip.id));
  let nextStart = Math.max(0, clip.startMs);
  for (const other of others) {
    if (Math.abs(nextStart - (other.startMs + other.durationMs)) <= SNAP_MS) nextStart = other.startMs + other.durationMs;
    if (Math.abs(nextStart - other.startMs) <= SNAP_MS) nextStart = other.startMs;
  }
  let nextClip = { ...clip, startMs: nextStart };
  for (const other of others) {
    const overlap = nextClip.startMs < other.startMs + other.durationMs && nextClip.startMs + nextClip.durationMs > other.startMs;
    if (overlap && nextClip.startMs >= other.startMs) nextClip = { ...nextClip, startMs: other.startMs + other.durationMs };
  }
  return nextClip;
}

function clipAtTime(timeline: EditingTimeline, timeMs: number, assetsById: Map<string, EditingAsset>) {
  const videoTrack = timeline.tracks.find((track) => track.type === 'VIDEO');
  const clip = videoTrack?.clips.find((item) => timeMs >= item.startMs && timeMs < item.startMs + item.durationMs);
  if (!clip?.assetId) return null;
  const asset = assetsById.get(clip.assetId);
  return asset ? { clip, asset } : null;
}

function AssetCard({ asset }: { asset: EditingAsset }) {
  const Icon = asset.kind === 'AUDIO' ? Music : asset.kind === 'IMAGE' ? ImageIcon : Play;
  return (
    <div
      draggable
      onDragStart={(event) => event.dataTransfer.setData('application/x-jiying-asset-id', asset.id)}
      className="group grid cursor-grab grid-cols-[56px_minmax(0,1fr)] gap-2 rounded border border-white/10 bg-white/[0.03] p-2 active:cursor-grabbing hover:border-cyan-400/40 hover:bg-cyan-400/5"
    >
      <div className="flex h-12 items-center justify-center overflow-hidden rounded bg-black/50 border border-white/10">
        {asset.kind === 'IMAGE' ? <img src={asset.url} className="h-full w-full object-cover" /> : <Icon className="h-5 w-5 text-cyan-300" />}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-zinc-100">{asset.title}</div>
        <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-zinc-500">
          <span>{asset.kind}</span>
          <span>{asset.mimeType || 'media'}</span>
        </div>
      </div>
    </div>
  );
}

interface VideoEditorProps {
  currentProjectId?: string | null;
}

function Player({ timeline, playheadMs, assetsById, playing, onToggle }: { timeline: EditingTimeline; playheadMs: number; assetsById: Map<string, EditingAsset>; playing: boolean; onToggle: () => void }) {
  const active = clipAtTime(timeline, playheadMs, assetsById);
  return (
    <div className="flex h-full flex-col bg-[#090909]">
      <div className="flex h-10 items-center justify-between border-b border-white/10 px-4 text-xs text-zinc-400">
        <span className="font-mono text-zinc-200">播放器 / Program Monitor</span>
        <span className="font-mono text-cyan-300">{formatTime(playheadMs)} / {formatTime(timeline.durationMs)}</span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        {active ? (
          active.asset.kind === 'IMAGE' ? (
            <img src={active.asset.url} className="max-h-full max-w-full object-contain" />
          ) : (
            <video key={`${active.asset.id}-${active.clip.id}`} src={active.asset.url} className="max-h-full max-w-full object-contain" muted controls={false} autoPlay={playing} />
          )
        ) : (
          <div className="text-center font-mono text-xs uppercase tracking-widest text-zinc-600">Black Frame</div>
        )}
      </div>
      <div className="flex h-12 items-center justify-between border-t border-white/10 px-4">
        <button onClick={onToggle} className="flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 text-zinc-100 hover:bg-white/10" title={playing ? '暂停' : '播放'}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <div className="text-[10px] font-mono text-zinc-500">{active?.asset.title || '当前无命中素材'}</div>
      </div>
    </div>
  );
}

function TimelineTrack({ track, selectedClipId, pxPerSecond, assetsById, staleAssetIds, onSelectClip, onMoveClip, onTrimClip, onDropAsset }: {
  track: EditingTrack;
  selectedClipId: string | null;
  pxPerSecond: number;
  assetsById: Map<string, EditingAsset>;
  staleAssetIds: Set<string>;
  onSelectClip: (clipId: string) => void;
  onMoveClip: (trackId: string, clipId: string, startMs: number) => void;
  onTrimClip: (trackId: string, clipId: string, nextClip: EditingClip) => void;
  onDropAsset: (trackId: string, assetId: string, startMs: number) => void;
}) {
  const [dragClip, setDragClip] = useState<{ id: string; startX: number; originalStartMs: number } | null>(null);
  const [trimClip, setTrimClip] = useState<{ id: string; edge: 'left' | 'right'; startX: number; original: EditingClip } | null>(null);
  const width = Math.max(1400, ...track.clips.map((clip) => msToPx(clip.startMs + clip.durationMs, pxPerSecond) + 240), 1400);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (dragClip) {
        onMoveClip(track.id, dragClip.id, dragClip.originalStartMs + pxDeltaToMs(event.clientX - dragClip.startX, pxPerSecond));
      }
      if (trimClip) {
        const deltaMs = pxDeltaToMs(event.clientX - trimClip.startX, pxPerSecond);
        if (trimClip.edge === 'left') {
          const maxShrink = trimClip.original.durationMs - MIN_CLIP_MS;
          const minExtend = Math.max(-trimClip.original.sourceInMs, -trimClip.original.startMs);
          const consumed = Math.max(minExtend, Math.min(deltaMs, maxShrink, trimClip.original.startMs));
          onTrimClip(track.id, trimClip.id, {
            ...trimClip.original,
            startMs: trimClip.original.startMs + consumed,
            durationMs: trimClip.original.durationMs - consumed,
            sourceInMs: trimClip.original.sourceInMs + consumed
          });
          return;
        }
        const nextDuration = Math.max(MIN_CLIP_MS, trimClip.original.durationMs + deltaMs);
        onTrimClip(track.id, trimClip.id, {
          ...trimClip.original,
          durationMs: nextDuration,
          sourceOutMs: Math.max(trimClip.original.sourceInMs + MIN_CLIP_MS, trimClip.original.sourceOutMs + deltaMs)
        });
      }
    };
    const onUp = () => {
      setDragClip(null);
      setTrimClip(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragClip, trimClip, pxPerSecond, track.id, onMoveClip, onTrimClip]);

  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] border-b border-white/10">
      <div className="flex h-16 items-center border-r border-white/10 bg-[#161616] px-3 text-xs font-bold text-zinc-300">{track.name}</div>
      <div
        className="relative h-16 bg-[#101010]"
        style={{ width }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const assetId = event.dataTransfer.getData('application/x-jiying-asset-id');
          if (!assetId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onDropAsset(track.id, assetId, pxToMs(event.clientX - rect.left, pxPerSecond));
        }}
      >
        {track.clips.map((clip) => {
          const asset = clip.assetId ? assetsById.get(clip.assetId) : null;
          const selected = selectedClipId === clip.id;
          const isStale = Boolean(clip.assetId && staleAssetIds.has(clip.assetId));
          const bg = clip.kind === 'AUDIO' ? 'bg-teal-700/80 border-teal-300/60' : clip.kind === 'IMAGE' ? 'bg-amber-700/80 border-amber-200/60' : clip.kind === 'TEXT' ? 'bg-violet-700/80 border-violet-200/60' : 'bg-blue-700/80 border-blue-200/60';
          return (
            <div
              key={clip.id}
              onMouseDown={(event) => {
                event.stopPropagation();
                onSelectClip(clip.id);
                setDragClip({ id: clip.id, startX: event.clientX, originalStartMs: clip.startMs });
              }}
              className={`absolute top-2 h-12 rounded border px-2 py-1 text-xs text-white shadow ${isStale ? 'border-red-300/70 bg-red-900/80 ring-1 ring-red-400/40' : bg} ${selected ? 'ring-2 ring-white' : ''}`}
              style={{ left: msToPx(clip.startMs, pxPerSecond), width: Math.max(36, msToPx(clip.durationMs, pxPerSecond)) }}
              title={isStale ? '该团队素材已失效，请移除后重新选择。' : undefined}
            >
              <button onMouseDown={(event) => { event.stopPropagation(); setTrimClip({ id: clip.id, edge: 'left', startX: event.clientX, original: clip }); onSelectClip(clip.id); }} className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-white/20" title="裁剪左边界" />
              <div className="truncate pl-1 pr-1 font-semibold">{clip.name || asset?.title || clip.kind}</div>
              <div className="mt-1 truncate text-[10px] opacity-75">{isStale ? '需重选' : `${formatTime(clip.startMs)} · ${formatTime(clip.durationMs)}`}</div>
              {isStale && <AlertTriangle className="absolute right-3 top-1.5 h-3.5 w-3.5 text-red-100" />}
              <button onMouseDown={(event) => { event.stopPropagation(); setTrimClip({ id: clip.id, edge: 'right', startX: event.clientX, original: clip }); onSelectClip(clip.id); }} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white/20" title="裁剪右边界" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineAssistantLayer({ timeline, pxPerSecond }: { timeline: EditingTimeline; pxPerSecond: number }) {
  const markers = timeline.metadata?.markers || [];
  const transitions = timeline.metadata?.transitions || [];
  const effects = timeline.metadata?.effects || [];
  if (markers.length === 0 && transitions.length === 0 && effects.length === 0) return null;
  const width = Math.max(
    1400,
    ...markers.map((item) => msToPx(item.atMs, pxPerSecond) + 180),
    ...transitions.map((item) => msToPx(item.atMs, pxPerSecond) + 180),
    ...effects.map((item) => msToPx(item.atMs, pxPerSecond) + 180),
    1400
  );
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] border-b border-cyan-400/10 bg-cyan-950/10">
      <div className="flex h-10 items-center gap-1.5 border-r border-white/10 bg-[#151b1d] px-3 text-[10px] font-bold text-cyan-200">
        <Sparkles className="h-3.5 w-3.5" /> AI
      </div>
      <div className="relative h-10 bg-[#0f1517]" style={{ width }}>
        {markers.map((marker) => (
          <div
            key={marker.id}
            className="absolute top-1 h-8 min-w-16 max-w-40 rounded border border-cyan-300/40 bg-cyan-400/15 px-2 py-0.5 text-[10px] text-cyan-50 shadow"
            style={{ left: msToPx(marker.atMs, pxPerSecond) }}
            title={`${formatTime(marker.atMs)} ${marker.label}`}
          >
            <div className="truncate font-semibold">{marker.label}</div>
            <div className="font-mono text-cyan-200/70">{formatTime(marker.atMs)}</div>
          </div>
        ))}
        {transitions.map((transition) => (
          <div
            key={transition.id}
            className="absolute bottom-1 flex h-4 items-center gap-1 rounded border border-amber-300/40 bg-amber-400/15 px-1.5 text-[9px] font-semibold text-amber-100"
            style={{ left: msToPx(transition.atMs, pxPerSecond), width: Math.max(28, msToPx(transition.durationMs || 800, pxPerSecond)) }}
            title={`${formatTime(transition.atMs)} 转场 ${transition.type}`}
          >
            <Wand2 className="h-2.5 w-2.5" />
            <span className="truncate">{transition.type}</span>
          </div>
        ))}
        {effects.map((effect) => (
          <div
            key={effect.id}
            className="absolute top-1 h-2 rounded-full bg-fuchsia-300 shadow-[0_0_8px_rgba(240,171,252,0.7)]"
            style={{ left: msToPx(effect.atMs, pxPerSecond), width: Math.max(10, msToPx(effect.durationMs || 1000, pxPerSecond)) }}
            title={`${formatTime(effect.atMs)} 特效 ${effect.type}${effect.note ? `：${effect.note}` : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function VideoEditor({ currentProjectId }: VideoEditorProps) {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<EditingTimeline>(defaultTimeline());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'VIDEO' | 'IMAGE' | 'AUDIO'>('ALL');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerSecond, setPxPerSecond] = useState(PX_PER_SECOND_DEFAULT);
  const [dirty, setDirty] = useState(false);
  const [assetSavingMode, setAssetSavingMode] = useState<'save' | 'submit' | null>(null);
  const [assetSaveMessage, setAssetSaveMessage] = useState('');
  const [slashImportedAssets, setSlashImportedAssets] = useState<EditingAsset[]>([]);
  const [slashPickerAnchor, setSlashPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const [slashImportMessage, setSlashImportMessage] = useState('');
  const [staleTimelineAssetIds, setStaleTimelineAssetIds] = useState<Set<string>>(new Set());
  const timerRef = useRef<number | null>(null);
  const slashButtonRef = useRef<HTMLButtonElement>(null);

  function resetEditingWorkspace() {
    setProjectId(null);
    setTimeline(defaultTimeline());
    setSearch('');
    setFilter('ALL');
    setSelectedClipId(null);
    setPlayheadMs(0);
    setPlaying(false);
    setDirty(false);
    setAssetSavingMode(null);
    setAssetSaveMessage('');
    setSlashImportedAssets([]);
    setSlashPickerAnchor(null);
    setSlashImportMessage('');
    setStaleTimelineAssetIds(new Set());
  }

  const projectsQuery = useQuery({
    queryKey: ['editing-projects', currentProjectId || 'no-project'],
    queryFn: () => fetchEditingProjects({ productionProjectId: currentProjectId })
  });
  const createProjectMutation = useMutation({
    mutationFn: () => createEditingProject('智能出片剪辑工程', { productionProjectId: currentProjectId }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['editing-projects'] });
      setProjectId(project.id);
    }
  });
  const projectQuery = useQuery({ queryKey: ['editing-project', projectId], queryFn: () => fetchEditingProject(projectId!), enabled: !!projectId });
  const assetsQuery = useQuery({ queryKey: ['editing-assets', projectId], queryFn: () => fetchEditingAssets(projectId!), enabled: !!projectId });
  const timelineWithImportedAssets = useMemo<EditingTimeline>(() => ({
    ...timeline,
    metadata: {
      ...(timeline.metadata || {}),
      importedAssets: slashImportedAssets
    }
  }), [timeline, slashImportedAssets]);
  const staleTimelineClipCount = useMemo(() => timeline.tracks.reduce((count, track) => (
    count + track.clips.filter((clip) => clip.assetId && staleTimelineAssetIds.has(clip.assetId)).length
  ), 0), [timeline, staleTimelineAssetIds]);
  const hasStaleTimelineClips = staleTimelineClipCount > 0;

  function productionClipAssetIds(snapshot: EditingTimeline = timeline) {
    return Array.from(new Set(snapshot.tracks.flatMap((track) => (
      track.clips.map((clip) => clip.assetId).filter((assetId): assetId is string => Boolean(assetId?.startsWith('production:')))
    ))));
  }

  function markStaleTimelineAsset(assetId: string | null) {
    setStaleTimelineAssetIds((prev) => {
      const next = new Set(prev);
      if (assetId) {
        next.add(assetId);
      } else {
        productionClipAssetIds().forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearStaleTimelineClips() {
    if (!hasStaleTimelineClips) {
      setAssetSaveMessage('当前没有可移除的失效片段。');
      window.setTimeout(() => setAssetSaveMessage(''), 2600);
      return;
    }
    updateTimeline((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => !clip.assetId || !staleTimelineAssetIds.has(clip.assetId))
      }))
    }));
    if (selectedClip?.assetId && staleTimelineAssetIds.has(selectedClip.assetId)) setSelectedClipId(null);
    setStaleTimelineAssetIds(new Set());
    setAssetSaveMessage('已移除失效片段，请重新选择团队镜头。');
    window.setTimeout(() => setAssetSaveMessage(''), 2600);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (hasStaleTimelineClips) throw Object.assign(new Error('时间线包含失效团队素材，请先移除后重新选择。'), { status: 409, code: 'STALE_REVIEW_SNAPSHOT' });
      return saveEditingTimeline(projectId!, normalizeTimeline(timelineWithImportedAssets));
    },
    onSuccess: (project) => {
      setDirty(false);
      setTimeline(project.timelineJson);
      setSlashImportedAssets(project.timelineJson.metadata?.importedAssets || []);
      queryClient.invalidateQueries({ queryKey: ['editing-projects'] });
      queryClient.invalidateQueries({ queryKey: ['editing-project', projectId] });
    },
    onError: (error) => {
      if (!isStaleProductionAssetError(error)) return;
      markStaleTimelineAsset(staleAssetIdFromError(error));
      queryClient.invalidateQueries({ queryKey: ['production-assets'] });
      queryClient.invalidateQueries({ queryKey: ['slash-assets'] });
      queryClient.invalidateQueries({ queryKey: ['editing-assets'] });
      notifyProductionAssetsChanged({ reason: 'editing_timeline_asset_stale', projectId });
      setAssetSaveMessage(staleProductionAssetMessage('时间线保存失败'));
    }
  });

  useEffect(() => {
    resetEditingWorkspace();
  }, [currentProjectId]);

  useEffect(() => {
    if (!projectsQuery.data) return;
    const projectStillBelongsToCurrentScope = projectId
      ? projectsQuery.data.some((project) => project.id === projectId)
      : false;
    if (projectId && !projectStillBelongsToCurrentScope) {
      setProjectId(null);
      setTimeline(defaultTimeline());
      setSlashImportedAssets([]);
      setDirty(false);
      return;
    }
    if (!projectId && projectsQuery.data[0]) setProjectId(projectsQuery.data[0].id);
    if (!projectId && projectsQuery.data.length === 0 && !createProjectMutation.isPending) createProjectMutation.mutate();
  }, [projectsQuery.data, projectId, currentProjectId, createProjectMutation.isPending]);

  useEffect(() => {
    if (projectQuery.data?.timelineJson) {
      setTimeline(projectQuery.data.timelineJson);
      setSlashImportedAssets(projectQuery.data.timelineJson.metadata?.importedAssets || []);
      setStaleTimelineAssetIds(new Set());
      setDirty(false);
      setSelectedClipId(null);
      setPlayheadMs(0);
    }
  }, [projectQuery.data?.id]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = window.setInterval(() => {
      setPlayheadMs((prev) => {
        const next = prev + 100;
        if (next >= timeline.durationMs) {
          setPlaying(false);
          return timeline.durationMs;
        }
        return next;
      });
    }, 100);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, timeline.durationMs]);

  const assets = assetsQuery.data || [];
  const allAssets = useMemo(() => {
    const byId = new Map<string, EditingAsset>();
    for (const asset of assets) byId.set(asset.id, asset);
    for (const asset of slashImportedAssets) byId.set(asset.id, asset);
    return Array.from(byId.values());
  }, [assets, slashImportedAssets]);
  const assetsById = useMemo(() => new Map(allAssets.map((asset) => [asset.id, asset])), [allAssets]);
  const selectedClip = timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId) || null;
  const selectedClipIsStale = Boolean(selectedClip?.assetId && staleTimelineAssetIds.has(selectedClip.assetId));
  const filteredAssets = allAssets.filter((asset) => (filter === 'ALL' || asset.kind === filter) && asset.title.toLowerCase().includes(search.toLowerCase()));
  const hasTimelineClips = timeline.tracks.some((track) => track.clips.length > 0);
  const assetEmptyTitle = search.trim()
    ? '没有匹配的剪辑素材'
    : filter === 'ALL'
      ? '暂无可用剪辑素材'
      : `暂无 ${filter} 类型素材`;
  const assetEmptyDescription = search.trim()
    ? '换一个关键词，或先从团队镜头导入素材后再拖入时间线。'
    : currentProjectId
      ? '从左上角“团队镜头”调用已通过审核的团队资源，或继续在前序工作流生成素材。'
      : '请先从工作台选择团队影视项目，再调用团队镜头并保存剪辑资产。';

  function updateTimeline(updater: (prev: EditingTimeline) => EditingTimeline) {
    setTimeline((prev) => normalizeTimeline(updater(prev)));
    setDirty(true);
  }

  useEffect(() => {
    const onAssistantConfirmed = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.stage !== 'EDIT_05') return;
      const patch = detail.action?.executionResult?.patch || {};
      const text = String(patch.text || detail.action?.previewText || '').trim();
      if (!text) return;

      let timelineToSave: EditingTimeline | null = null;
      setTimeline((prev) => {
        const trackId = patch.trackId || 't1';
        const durationMs = Math.max(MIN_CLIP_MS, Math.min(60_000, Number(patch.durationMs) || 5000));
        const startMs = Math.max(0, Number(patch.startMs) || prev.durationMs || 0);
        const incomingClips = Array.isArray(patch.clips) && patch.clips.length > 0
          ? patch.clips
          : [{ kind: 'TEXT', text, name: patch.mode === 'rough-cut' ? 'AI 粗剪方案' : 'AI 剪辑建议', trackId, startMs, durationMs }];
        const clipsByTrack = new Map<string, EditingClip[]>();
        incomingClips.forEach((item: any, index: number) => {
          const itemKind = String(item.kind || 'TEXT').toUpperCase() as EditingClip['kind'];
          const itemDurationMs = Math.max(MIN_CLIP_MS, Math.min(120_000, Number(item.durationMs) || durationMs));
          const itemStartMs = Math.max(0, Number(item.startMs) || (startMs + index * itemDurationMs));
          const itemTrackId = String(item.trackId || (itemKind === 'AUDIO' ? 'a1' : itemKind === 'VIDEO' || itemKind === 'IMAGE' ? 'v1' : 't1'));
          const clip: EditingClip = {
            id: `clip_ai_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`,
            assetId: item.assetId,
            kind: itemKind,
            text: String(item.text || item.name || text).trim(),
            name: String(item.name || (patch.mode === 'rough-cut' ? `AI 粗剪片段 ${index + 1}` : 'AI 剪辑建议')).slice(0, 120),
            startMs: itemStartMs,
            durationMs: itemDurationMs,
            sourceInMs: 0,
            sourceOutMs: itemDurationMs,
            volume: 1,
            muted: false,
            fadeInMs: 0,
            fadeOutMs: 0
          };
          clipsByTrack.set(itemTrackId, [...(clipsByTrack.get(itemTrackId) || []), clip]);
        });
        timelineToSave = normalizeTimeline({
          ...prev,
          metadata: mergeTimelineMetadata(prev, patch),
          tracks: prev.tracks.map((track) => (
            clipsByTrack.has(track.id) || (track.type === 'TEXT' && clipsByTrack.has('t1'))
              ? { ...track, clips: sortClips([...track.clips, ...(clipsByTrack.get(track.id) || (track.type === 'TEXT' ? clipsByTrack.get('t1') || [] : []))]) }
              : track
          ))
        });
        return timelineToSave;
      });
      setDirty(true);
      setAssetSaveMessage(detail.action?.executionResult?.message || 'AI 剪辑建议已写入时间线');
      window.setTimeout(() => setAssetSaveMessage(''), 2600);
      window.setTimeout(() => {
        if (!projectId || !timelineToSave) return;
        saveEditingTimeline(projectId, timelineToSave)
          .then((project) => {
            setDirty(false);
            setTimeline(project.timelineJson);
            queryClient.invalidateQueries({ queryKey: ['editing-projects'] });
            queryClient.invalidateQueries({ queryKey: ['editing-project', projectId] });
          })
          .catch((error) => {
            if (isStaleProductionAssetError(error)) {
              markStaleTimelineAsset(staleAssetIdFromError(error));
              queryClient.invalidateQueries({ queryKey: ['production-assets'] });
              queryClient.invalidateQueries({ queryKey: ['slash-assets'] });
              notifyProductionAssetsChanged({ reason: 'editing_assistant_timeline_asset_stale', projectId });
              setAssetSaveMessage(staleProductionAssetMessage('AI 时间线保存失败'));
              return;
            }
            setAssetSaveMessage(error instanceof Error ? error.message : 'AI 时间线保存失败');
          });
      }, 0);
    };
    window.addEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantConfirmed);
    return () => window.removeEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantConfirmed);
  }, [projectId, queryClient]);

  function addAssetToTrack(trackId: string, assetId: string, startMs: number) {
    const asset = assetsById.get(assetId);
    if (!asset) return;
    updateTimeline((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => {
        if (track.id !== trackId || !isAssetAllowedOnTrack(asset, track)) return track;
        const durationMs = defaultDurationForAsset(asset);
        const clip: EditingClip = clampClipToTrack(track, {
          id: `clip_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          assetId: asset.id,
          kind: asset.kind,
          name: asset.title,
          startMs,
          durationMs,
          sourceInMs: 0,
          sourceOutMs: durationMs,
          volume: 1,
          muted: false,
          fadeInMs: 0,
          fadeOutMs: 0
        });
        return { ...track, clips: sortClips([...track.clips, clip]) };
      })
    }));
  }

  function openSlashPicker() {
    if (!currentProjectId || !slashButtonRef.current) return;
    const rect = slashButtonRef.current.getBoundingClientRect();
    setSlashPickerAnchor({ top: rect.bottom + 8, left: rect.left });
  }

  function importSlashAsset(resolved: SlashAssetResolveResult) {
    const streamUrl = resolved.reference?.streamUrl;
    const kind = clipKindFromMime(resolved.asset.mimeType);
    if (!streamUrl || !kind) {
      setSlashImportMessage('所选团队资产不是可导入的图片、视频或音频。');
      window.setTimeout(() => setSlashImportMessage(''), 2600);
      return;
    }
    const imported: EditingAsset = {
      id: productionAssetClipId(resolved.asset.id, resolved.reference?.snapshotId || resolved.snapshot?.id || resolved.asset.currentSnapshotId),
      title: resolved.asset.displayName || resolved.asset.originalName,
      type: kind,
      kind,
      mimeType: resolved.asset.mimeType || null,
      sizeBytes: resolved.asset.sizeBytes || null,
      url: streamUrl,
      createdAt: new Date().toISOString()
    };
    setStaleTimelineAssetIds((prev) => {
      const next = new Set(prev);
      next.delete(imported.id);
      return next;
    });
    setSlashImportedAssets((prev) => {
      const rest = prev.filter((asset) => asset.id !== imported.id);
      return [imported, ...rest].slice(0, 100);
    });
    setDirty(true);
    setSlashImportMessage('团队镜头已加入剪辑素材池，可拖入时间线。');
    window.setTimeout(() => setSlashImportMessage(''), 2600);
  }

  function moveClip(trackId: string, clipId: string, startMs: number) {
    updateTimeline((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => {
        if (track.id !== trackId) return track;
        const clip = track.clips.find((item) => item.id === clipId);
        if (!clip) return track;
        const next = clampClipToTrack(track, { ...clip, startMs: Math.max(0, startMs) });
        return { ...track, clips: sortClips(track.clips.map((item) => item.id === clipId ? next : item)) };
      })
    }));
  }

  function trimClip(trackId: string, clipId: string, nextClip: EditingClip) {
    updateTimeline((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => {
        if (track.id !== trackId) return track;
        const half = Math.floor(nextClip.durationMs / 2);
        const boundedClip = { ...nextClip, fadeInMs: Math.min(nextClip.fadeInMs, half), fadeOutMs: Math.min(nextClip.fadeOutMs, half) };
        return {
          ...track,
          clips: sortClips(track.clips.map((clip) => clip.id === clipId ? boundedClip : clip))
        };
      })
    }));
  }

  function deleteSelectedClip() {
    if (!selectedClipId) return;
    updateTimeline((prev) => ({ ...prev, tracks: prev.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== selectedClipId) })) }));
    setSelectedClipId(null);
  }

  function splitSelectedClip() {
    if (!selectedClipId) return;
    updateTimeline((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => {
        const clip = track.clips.find((item) => item.id === selectedClipId);
        if (!clip || playheadMs <= clip.startMs + MIN_CLIP_MS || playheadMs >= clip.startMs + clip.durationMs - MIN_CLIP_MS) return track;
        const leftDuration = playheadMs - clip.startMs;
        const rightDuration = clip.durationMs - leftDuration;
        const rightClip: EditingClip = { ...clip, id: `clip_${Date.now()}_split`, startMs: playheadMs, durationMs: rightDuration, sourceInMs: clip.sourceInMs + leftDuration };
        const leftClip: EditingClip = { ...clip, durationMs: leftDuration, sourceOutMs: clip.sourceInMs + leftDuration };
        return { ...track, clips: sortClips(track.clips.flatMap((item) => item.id === clip.id ? [leftClip, rightClip] : [item])) };
      })
    }));
  }

  function buildEditTimelineText(timelineSnapshot: EditingTimeline) {
    const tracks = timelineSnapshot.tracks.map((track) => {
      const clips = track.clips.map((clip) => {
        const asset = clip.assetId ? assetsById.get(clip.assetId) : null;
        return `- ${formatTime(clip.startMs)} / ${formatTime(clip.durationMs)} / ${clip.name || asset?.title || clip.kind}`;
      });
      return [`## ${track.name}`, clips.length ? clips.join('\n') : '- 空轨道'].join('\n');
    });
    const markers = (timelineSnapshot.metadata?.markers || []).map((marker) => `- ${formatTime(marker.atMs)} / ${marker.label}`);
    const transitions = (timelineSnapshot.metadata?.transitions || []).map((transition) => `- ${formatTime(transition.atMs)} / ${transition.type} / ${transition.durationMs ? `${transition.durationMs}ms` : '-'}`);
    const effects = (timelineSnapshot.metadata?.effects || []).map((effect) => `- ${formatTime(effect.atMs)} / ${effect.type}${effect.note ? ` / ${effect.note}` : ''}`);
    return [
      `剪辑工程：${projectQuery.data?.title || '智能出片剪辑工程'}`,
      `工程ID：${projectId || '-'}`,
      `总时长：${formatTime(timelineSnapshot.durationMs)}`,
      `画幅：${timelineSnapshot.settings.width}x${timelineSnapshot.settings.height} ${timelineSnapshot.settings.aspectRatio}`,
      '',
      '## AI 标记',
      markers.length ? markers.join('\n') : '- 无',
      '',
      '## AI 转场',
      transitions.length ? transitions.join('\n') : '- 无',
      '',
      '## AI 特效',
      effects.length ? effects.join('\n') : '- 无',
      '',
      ...tracks
    ].join('\n').trim();
  }

  async function saveEditTimelineAsset(submitReview: boolean) {
    if (!currentProjectId) {
      setAssetSaveMessage('请先选择团队项目');
      return;
    }
    if (!projectId || !projectQuery.data) {
      setAssetSaveMessage('请先创建或选择剪辑工程');
      return;
    }
    if (dirty) {
      setAssetSaveMessage('请先保存时间线');
      return;
    }
    if (hasStaleTimelineClips) {
      setAssetSaveMessage('时间线包含失效团队素材，请先移除后重新选择。');
      return;
    }

    const timelineSnapshot = normalizeTimeline(timeline);
    const text = buildEditTimelineText(timelineSnapshot);
    const payload = {
      text,
      editingProjectId: projectId,
      editingProjectTitle: projectQuery.data.title,
      durationMs: timelineSnapshot.durationMs,
      timeline: timelineSnapshot,
      assets: allAssets.map((asset) => ({
        id: asset.id,
        title: asset.title,
        kind: asset.kind,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        url: asset.url
      })),
      exportedAt: new Date().toISOString()
    };
    const sizeBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    setAssetSavingMode(submitReview ? 'submit' : 'save');
    setAssetSaveMessage(submitReview ? '正在保存并提审...' : '正在保存资产...');
    try {
      const asset = await createProductionAsset({
        projectId: currentProjectId,
        stage: 'EDIT_05',
        originalName: `${projectQuery.data.title || '剪辑工程'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        description: `剪辑工程时间线快照，总时长 ${formatTime(timelineSnapshot.durationMs)}。`,
        mimeType: 'application/json',
        sizeBytes,
        sourceType: 'video_editor_timeline',
        sourceId: projectId,
        sourcePayload: payload,
        metadata: {
          savedFrom: 'VideoEditor',
          stageName: 'EDIT_05',
          durationMs: timelineSnapshot.durationMs,
          clipCount: timelineSnapshot.tracks.reduce((sum, track) => sum + track.clips.length, 0)
        }
      });
      const finalAsset = submitReview ? await submitProductionAssetReview(asset.id) : asset;
      window.dispatchEvent(new CustomEvent('jiying:production-assets-changed', { detail: { assetId: finalAsset.id, stage: finalAsset.stage } }));
      setAssetSaveMessage(finalAsset.reviewStatus === 'IN_REVIEW' ? '已保存并提审' : '已保存到个人资产');
      window.setTimeout(() => setAssetSaveMessage(''), 2600);
    } catch (error) {
      if (isStaleProductionAssetError(error)) {
        markStaleTimelineAsset(staleAssetIdFromError(error));
        queryClient.invalidateQueries({ queryKey: ['production-assets'] });
        queryClient.invalidateQueries({ queryKey: ['slash-assets'] });
        queryClient.invalidateQueries({ queryKey: ['editing-assets'] });
        notifyProductionAssetsChanged({ reason: 'editing_asset_save_stale', projectId, stage: 'EDIT_05' });
        setAssetSaveMessage(staleProductionAssetMessage('保存资产失败'));
      } else {
        setAssetSaveMessage(error instanceof Error ? error.message : '保存资产失败');
      }
    } finally {
      setAssetSavingMode(null);
    }
  }

  const loading = projectsQuery.isLoading || projectQuery.isLoading || createProjectMutation.isPending;
  const bannerError = projectsQuery.error || projectQuery.error || assetsQuery.error || createProjectMutation.error || saveMutation.error;

  return (
    <div className="flex h-full w-full flex-col bg-[#111] text-zinc-100 select-none">
      <div className="flex h-12 items-center justify-between border-b border-white/10 bg-[#181818] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-cyan-200">04 剪辑</div>
          <select value={projectId || ''} onChange={(event) => setProjectId(event.target.value)} className="h-8 max-w-[260px] rounded border border-white/10 bg-black/40 px-2 text-xs outline-none">
            {(projectsQuery.data || []).map((project: EditingProject) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          {dirty && <span className="text-[10px] font-mono text-amber-300" title="时间线未保存，保存后才能导出资产或提审。">UNSAVED</span>}
        </div>
        <div className="flex items-center gap-2">
          {assetSaveMessage && (
            <span className={`hidden xl:inline max-w-[150px] truncate text-[10px] font-mono ${assetSaveMessage.includes('失败') || assetSaveMessage.includes('请先') || assetSaveMessage.includes('失效') ? 'text-red-300' : 'text-emerald-300'}`}>
              {assetSaveMessage}
            </span>
          )}
          {hasStaleTimelineClips && (
            <button onClick={clearStaleTimelineClips} className="flex h-8 items-center gap-1.5 rounded border border-red-400/30 bg-red-500/10 px-3 text-xs font-semibold text-red-100 hover:bg-red-500/20">
              <AlertTriangle className="h-3.5 w-3.5" /> 移除失效 {staleTimelineClipCount}
            </button>
          )}
          <button onClick={() => createProjectMutation.mutate()} className="flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-3 text-xs hover:bg-white/10"><FilePlus2 className="h-3.5 w-3.5" /> 新工程</button>
          <button onClick={() => setPxPerSecond((v) => Math.max(8, v - 4))} className="flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 hover:bg-white/10" title="缩小"><ZoomOut className="h-3.5 w-3.5" /></button>
          <button onClick={() => setPxPerSecond((v) => Math.min(80, v + 4))} className="flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-white/5 hover:bg-white/10" title="放大"><ZoomIn className="h-3.5 w-3.5" /></button>
          <button onClick={splitSelectedClip} disabled={!selectedClipId} className="flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-3 text-xs hover:bg-white/10 disabled:opacity-40"><Scissors className="h-3.5 w-3.5" /> 分割</button>
          <button onClick={deleteSelectedClip} disabled={!selectedClipId} className="flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-3 text-xs hover:bg-red-950/40 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> 删除</button>
          <button onClick={() => void saveEditTimelineAsset(false)} disabled={!projectId || dirty || hasStaleTimelineClips || !currentProjectId || Boolean(assetSavingMode)} className="flex h-8 items-center gap-1.5 rounded border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-40" title={hasStaleTimelineClips ? '请先移除失效片段' : currentProjectId ? '保存为个人剪辑资产' : '请先选择团队项目'}>
            {assetSavingMode === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 资产
          </button>
          <button onClick={() => void saveEditTimelineAsset(true)} disabled={!projectId || dirty || hasStaleTimelineClips || !currentProjectId || Boolean(assetSavingMode)} className="flex h-8 items-center gap-1.5 rounded border border-emerald-400/30 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-40" title={hasStaleTimelineClips ? '请先移除失效片段' : currentProjectId ? '保存并提交审核' : '请先选择团队项目'}>
            {assetSavingMode === 'submit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />} 提审
          </button>
          <button onClick={() => saveMutation.mutate()} disabled={!projectId || hasStaleTimelineClips || saveMutation.isPending} className="flex h-8 items-center gap-1.5 rounded bg-cyan-300 px-3 text-xs font-bold text-black hover:bg-cyan-200 disabled:opacity-50" title={hasStaleTimelineClips ? '请先移除失效片段' : '保存时间线'}>{saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存</button>
        </div>
      </div>

      {(bannerError || dirty || !currentProjectId) && (
        <div className="space-y-2 border-b border-white/10 bg-[#151515] px-4 py-2">
          {bannerError && <PageNotice tone="error">{errorMessage(bannerError)}</PageNotice>}
          {!currentProjectId && (
            <PageNotice tone="warning" title="请从工作台打开团队影视项目">
              当前剪辑工程只能本地编辑，无法保存为项目资产或提交制片审核。
            </PageNotice>
          )}
          {dirty && (
            <PageNotice tone="warning" title="时间线未保存">
              已有剪辑改动尚未写入工程，请先点击右上角“保存”，再保存为个人资产或提交团队审核。
            </PageNotice>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <InlineStatus loading tone="info">正在加载剪辑工程...</InlineStatus>
        </div>
      ) : projectId ? (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_260px]">
            <aside className="flex min-h-0 flex-col border-r border-white/10 bg-[#1a1a1a]">
              <div className="border-b border-white/10 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    ref={slashButtonRef}
                    type="button"
                    onClick={openSlashPicker}
                    disabled={!currentProjectId}
                    className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-40"
                    title={currentProjectId ? '从团队镜头资产导入' : '请先选择团队项目'}
                  >
                    <Link2 className="h-3.5 w-3.5" /> 团队镜头
                  </button>
                </div>
                {slashImportMessage && (
                  <div className={`mb-2 rounded border px-2 py-1.5 text-[10px] ${slashImportMessage.includes('不是') ? 'border-red-400/25 bg-red-950/20 text-red-200' : 'border-emerald-400/25 bg-emerald-950/20 text-emerald-200'}`}>
                    {slashImportMessage}
                  </div>
                )}
                <div className="mb-2 flex gap-1">
                  {(['ALL', 'VIDEO', 'IMAGE', 'AUDIO'] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded px-2 py-1 text-[10px] font-mono ${filter === item ? 'bg-cyan-300 text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}>{item}</button>)}
                </div>
                <div className="flex h-8 items-center gap-2 rounded border border-white/10 bg-black/40 px-2"><Search className="h-3.5 w-3.5 text-zinc-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索素材" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 custom-scrollbar">
                {assetsQuery.isLoading && <InlineStatus loading tone="info">素材加载中...</InlineStatus>}
                {!assetsQuery.isLoading && filteredAssets.length === 0 && (
                  <EmptyState title={assetEmptyTitle} description={assetEmptyDescription} tone={search.trim() ? 'info' : 'default'} />
                )}
                {filteredAssets.map((asset) => <div key={asset.id}><AssetCard asset={asset} /></div>)}
              </div>
            </aside>

            <main className="flex min-h-0 flex-col">
              <div className="min-h-0 flex-1"><Player timeline={timeline} playheadMs={playheadMs} assetsById={assetsById} playing={playing} onToggle={() => setPlaying((v) => !v)} /></div>
            </main>

            <aside className="border-l border-white/10 bg-[#181818] p-4">
              <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-zinc-500">Clip 属性</div>
              {selectedClip ? (
                <div className="space-y-3 text-xs">
                  {selectedClipIsStale && (
                    <div className="rounded border border-red-400/30 bg-red-950/30 px-3 py-2 text-[11px] text-red-100">
                      该团队素材已失效，请移除后重新选择。
                    </div>
                  )}
                  <div><label className="text-zinc-500">名称</label><input value={selectedClip.name || ''} onChange={(event) => updateTimeline((prev) => ({ ...prev, tracks: prev.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, name: event.target.value.slice(0, 120) } : clip) })) }))} className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 outline-none" /></div>
                  <div className="grid grid-cols-2 gap-2"><div><label className="text-zinc-500">开始</label><div className="mt-1 font-mono text-cyan-300">{formatTime(selectedClip.startMs)}</div></div><div><label className="text-zinc-500">时长</label><div className="mt-1 font-mono text-cyan-300">{formatTime(selectedClip.durationMs)}</div></div></div>
                  <div><label className="text-zinc-500">音量</label><input type="range" min={0} max={1} step={0.01} value={selectedClip.volume} onChange={(event) => updateTimeline((prev) => ({ ...prev, tracks: prev.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, volume: Number(event.target.value) } : clip) })) }))} className="mt-2 w-full accent-cyan-300" /></div>
                  <button onClick={() => updateTimeline((prev) => ({ ...prev, tracks: prev.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, muted: !clip.muted } : clip) })) }))} className={`flex h-8 items-center gap-2 rounded border px-3 ${selectedClip.muted ? 'border-red-400/40 bg-red-950/30 text-red-200' : 'border-white/10 bg-white/5 text-zinc-300'}`}><Volume2 className="h-3.5 w-3.5" /> {selectedClip.muted ? '已静音' : '未静音'}</button>
                  <div className="grid grid-cols-2 gap-2"><div><label className="text-zinc-500">淡入 ms</label><input type="number" value={selectedClip.fadeInMs} min={0} onChange={(event) => updateTimeline((prev) => ({ ...prev, tracks: prev.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, fadeInMs: Math.max(0, Number(event.target.value) || 0) } : clip) })) }))} className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 outline-none" /></div><div><label className="text-zinc-500">淡出 ms</label><input type="number" value={selectedClip.fadeOutMs} min={0} onChange={(event) => updateTimeline((prev) => ({ ...prev, tracks: prev.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => clip.id === selectedClip.id ? { ...clip, fadeOutMs: Math.max(0, Number(event.target.value) || 0) } : clip) })) }))} className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 outline-none" /></div></div>
                </div>
              ) : <div className="rounded border border-white/10 bg-white/[0.03] p-4 text-xs text-zinc-500">选择时间线 clip 后编辑属性。</div>}
              {(timeline.metadata?.markers?.length || timeline.metadata?.transitions?.length || timeline.metadata?.effects?.length) ? (
                <div className="mt-4 rounded border border-cyan-400/20 bg-cyan-400/5 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-cyan-200">
                    <Sparkles className="h-3.5 w-3.5" /> AI 剪辑要点
                  </div>
                  <div className="space-y-2 text-[11px] text-zinc-300">
                    {(timeline.metadata?.markers || []).slice(-4).map((marker) => (
                      <div key={marker.id} className="flex gap-2">
                        <span className="font-mono text-cyan-300">{formatTime(marker.atMs)}</span>
                        <span className="min-w-0 flex-1 truncate">{marker.label}</span>
                      </div>
                    ))}
                    {(timeline.metadata?.transitions || []).slice(-3).map((transition) => (
                      <div key={transition.id} className="flex gap-2 text-amber-100">
                        <span className="font-mono text-amber-300">{formatTime(transition.atMs)}</span>
                        <span className="min-w-0 flex-1 truncate">转场：{transition.type}</span>
                      </div>
                    ))}
                    {(timeline.metadata?.effects || []).slice(-3).map((effect) => (
                      <div key={effect.id} className="flex gap-2 text-fuchsia-100">
                        <span className="font-mono text-fuchsia-300">{formatTime(effect.atMs)}</span>
                        <span className="min-w-0 flex-1 truncate">特效：{effect.type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </aside>
          </div>

          <section className="relative h-[250px] border-t border-white/10 bg-[#121212]">
            <div className="flex h-8 items-center border-b border-white/10 bg-[#181818] text-[10px] font-mono text-zinc-500">
              <div className="w-[92px] px-3">TRACK</div>
              <div className="relative flex-1 overflow-hidden" onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setPlayheadMs(pxToMs(event.clientX - rect.left, pxPerSecond));
              }}>
                <div className="h-8 min-w-[1400px]" style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,.16) 0 1px, transparent 1px 120px)' }} />
              </div>
            </div>
            {!hasTimelineClips && (
              <div className="pointer-events-none absolute left-[112px] top-12 z-20 w-[420px] max-w-[calc(100%-132px)]">
                <PageNotice tone="info" title="时间线为空">
                  从左侧素材库拖入视频、图片或音频；也可以先调用团队镜头，再整理为可提审的剪辑资产。
                </PageNotice>
              </div>
            )}
            <div className="relative overflow-x-auto overflow-y-hidden custom-scrollbar">
              <div className="absolute top-0 bottom-0 z-30 w-px bg-white" style={{ left: 92 + msToPx(playheadMs, pxPerSecond) }}><Clock className="absolute -top-6 -left-2 h-4 w-4 text-white" /></div>
              <TimelineAssistantLayer timeline={timeline} pxPerSecond={pxPerSecond} />
              {timeline.tracks.map((track) => <div key={track.id}><TimelineTrack track={track} selectedClipId={selectedClipId} pxPerSecond={pxPerSecond} assetsById={assetsById} staleAssetIds={staleTimelineAssetIds} onSelectClip={setSelectedClipId} onMoveClip={moveClip} onTrimClip={trimClip} onDropAsset={addAssetToTrack} /></div>)}
            </div>
          </section>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState title="无法创建或读取剪辑工程" description="请返回工作台确认已选择影视项目；如果本地服务刚启动，请稍后刷新剪辑阶段。" tone="error" />
        </div>
      )}
      {currentProjectId && slashPickerAnchor && (
        <SlashAssetPicker
          projectId={currentProjectId}
          fromStage="EDIT_05"
          query=""
          anchor={slashPickerAnchor}
          onClose={() => setSlashPickerAnchor(null)}
          onResolved={(resolved) => {
            importSlashAsset(resolved);
            setSlashPickerAnchor(null);
          }}
        />
      )}
    </div>
  );
}
