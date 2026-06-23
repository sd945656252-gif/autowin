import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, FileText, FolderOpen, Image as ImageIcon, Loader2, Music, RefreshCw, Search, Video } from 'lucide-react';
import { fetchTeamAssetLibrary } from '../../lib/db';
import type { ProductionAsset, ProductionStage } from '../../types';
import { downloadMedia } from '../../utils/download';
import { ProductionAssetPreview } from '../ProductionAssetPreview';

type LibraryType = 'all' | 'image' | 'video' | 'audio' | 'document';

const stageOptions: Array<{ value: 'all' | ProductionStage; label: string }> = [
  { value: 'all', label: '全部阶段' },
  { value: 'SCRIPT_01', label: '01 剧本' },
  { value: 'DIRECTOR_02', label: '历史导演讲戏' },
  { value: 'ART_03', label: '02 美术设计' },
  { value: 'SHOT_04', label: '03 镜头设计' },
  { value: 'EDIT_05', label: '04 剪辑' }
];

const libraryTypeOptions: Array<{ value: LibraryType; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'document', label: '文档' }
];

function formatBytes(bytes?: number | null) {
  if (!bytes) return '未知大小';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function assetType(asset: ProductionAsset): LibraryType {
  const mimeType = asset.mimeType || '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

function assetTypeLabel(asset: ProductionAsset) {
  return libraryTypeOptions.find((item) => item.value === assetType(asset))?.label || '文档';
}

function assetTypeIcon(asset: ProductionAsset) {
  const type = assetType(asset);
  if (type === 'image') return <ImageIcon className="h-4 w-4 text-cyan-300" />;
  if (type === 'video') return <Video className="h-4 w-4 text-cyan-300" />;
  if (type === 'audio') return <Music className="h-4 w-4 text-cyan-300" />;
  return <FileText className="h-4 w-4 text-cyan-300" />;
}

function stageLabel(stage?: ProductionStage | null) {
  return stageOptions.find((item) => item.value === stage)?.label || stage || '未分类';
}

export function DeveloperAssetLibraryPanel() {
  const queryClient = useQueryClient();
  const [libraryStage, setLibraryStage] = useState<'all' | ProductionStage>('all');
  const [libraryType, setLibraryType] = useState<LibraryType>('all');
  const [libraryProjectId, setLibraryProjectId] = useState('all');
  const [librarySearch, setLibrarySearch] = useState('');

  const libraryQuery = useQuery({
    queryKey: ['team-asset-library', libraryStage, libraryType, libraryProjectId, librarySearch],
    queryFn: () => fetchTeamAssetLibrary({
      projectId: libraryProjectId === 'all' ? null : libraryProjectId,
      stage: libraryStage,
      type: libraryType,
      query: librarySearch.trim()
    }),
    refetchInterval: 3000,
    staleTime: 1000
  });

  useEffect(() => {
    const refreshLibrary = () => {
      void queryClient.invalidateQueries({ queryKey: ['team-asset-library'] });
    };
    window.addEventListener('jiying:production-assets-changed', refreshLibrary);
    return () => window.removeEventListener('jiying:production-assets-changed', refreshLibrary);
  }, [queryClient]);

  const libraryAssets = libraryQuery.data || [];
  const libraryProjects = useMemo(() => {
    const projects = new Map<string, string>();
    for (const asset of libraryAssets) {
      if (asset.projectId) projects.set(asset.projectId, asset.projectName || asset.projectId);
    }
    return Array.from(projects, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [libraryAssets]);
  const libraryCounts = useMemo(() => {
    const counts = { all: libraryAssets.length, image: 0, video: 0, audio: 0, document: 0 };
    for (const asset of libraryAssets) counts[assetType(asset)] += 1;
    return counts;
  }, [libraryAssets]);

  return (
    <div className="space-y-4">
      <div className="border border-white/10 bg-white/[0.03] rounded-lg p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2"><FolderOpen className="h-5 w-5 text-cyan-300" />素材库</h2>
            <p className="text-sm text-zinc-400 mt-1">所有项目通过审核并转为团队资源的素材会自动同步到这里，当前每 3 秒刷新一次。</p>
          </div>
          <button
            type="button"
            onClick={() => void libraryQuery.refetch()}
            className="inline-flex items-center justify-center gap-2 rounded bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15"
          >
            <RefreshCw className={`h-4 w-4 ${libraryQuery.isFetching ? 'animate-spin' : ''}`} />刷新
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-zinc-500">项目</span>
            <select value={libraryProjectId} onChange={(event) => setLibraryProjectId(event.target.value)} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40">
              <option value="all">全部项目</option>
              {libraryProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-zinc-500">阶段分类</span>
            <select value={libraryStage} onChange={(event) => setLibraryStage(event.target.value as 'all' | ProductionStage)} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40">
              {stageOptions.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-zinc-500">素材类型</span>
            <select value={libraryType} onChange={(event) => setLibraryType(event.target.value as LibraryType)} className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40">
              {libraryTypeOptions.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-zinc-500">搜索</span>
            <span className="flex items-center gap-2 rounded border border-white/10 bg-black/40 px-3 py-2 focus-within:border-cyan-400/40">
              <Search className="h-4 w-4 text-zinc-500" />
              <input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="名称、描述" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600" />
            </span>
          </label>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          {libraryTypeOptions.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => setLibraryType(type.value)}
              className={`rounded border px-3 py-2 text-left text-xs ${libraryType === type.value ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100' : 'border-white/10 bg-black/20 text-zinc-400 hover:bg-white/5 hover:text-white'}`}
            >
              <span className="block font-semibold">{type.label}</span>
              <span className="mt-1 block font-mono text-[10px] opacity-70">{libraryCounts[type.value]} 项</span>
            </button>
          ))}
        </div>
      </div>

      {libraryQuery.error && (
        <div className="border border-red-500/30 bg-red-950/20 text-red-200 rounded p-3 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4" />{libraryQuery.error instanceof Error ? libraryQuery.error.message : '素材库读取失败。'}
        </div>
      )}

      {libraryQuery.isLoading ? (
        <div className="text-zinc-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />正在加载素材库...</div>
      ) : libraryAssets.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-8 text-center text-sm text-zinc-500">
          暂无团队资源。项目资源审核通过并转为团队资源后，会自动同步显示在这里。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {libraryAssets.map((asset) => (
            <article key={asset.id} className="rounded-lg border border-white/10 bg-black/20 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span className="inline-flex items-center gap-1 rounded border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-cyan-100">{assetTypeIcon(asset)}{assetTypeLabel(asset)}</span>
                    <span>{stageLabel(asset.stage)}</span>
                    <span>{formatBytes(asset.sizeBytes)}</span>
                  </div>
                  <h3 className="mt-3 truncate text-sm font-bold text-white" title={asset.displayName || asset.originalName}>{asset.displayName || asset.originalName}</h3>
                  <p className="mt-1 truncate text-xs text-zinc-500">{asset.projectName || '已删除项目'} / v{asset.version} / 更新 {asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : '未知'}</p>
                  {asset.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-400">{asset.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {asset.streamUrl && (
                    <>
                      <a href={asset.streamUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10" title="观看">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <button type="button" onClick={() => void downloadMedia(asset.streamUrl!, asset.originalName || asset.displayName || `${asset.id}.bin`)} className="inline-flex h-9 w-9 items-center justify-center rounded border border-cyan-400/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20" title="下载">
                        <Download className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <ProductionAssetPreview asset={asset} heightClassName="h-52" />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
