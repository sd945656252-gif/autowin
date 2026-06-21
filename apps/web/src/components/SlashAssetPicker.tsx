import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSlashAssets, resolveSlashAsset } from '../lib/db';
import { ProductionStage, SlashProductionAsset, SlashAssetResolveResult } from '../types';
import { isStaleProductionAssetError, notifyProductionAssetsChanged, staleProductionAssetMessage } from '../utils/productionAssetErrors';
import { EmptyState, InlineStatus, PageNotice } from './ui/State';

type SlashAssetPickerProps = {
  projectId: string;
  fromStage: ProductionStage;
  query: string;
  anchor: { top: number; left: number };
  onClose: () => void;
  onResolved: (resolved: SlashAssetResolveResult) => void;
};

function labelForStage(stage: ProductionStage | null | undefined) {
  if (stage === 'SCRIPT_01') return '01 剧本';
  if (stage === 'DIRECTOR_02') return '历史导演讲戏';
  if (stage === 'ART_03') return '02 美术设计';
  if (stage === 'SHOT_04') return '03 镜头设计';
  if (stage === 'EDIT_05') return '04 剪辑';
  return '上游';
}

function assetTypeLabel(asset: SlashProductionAsset) {
  if (asset.mimeType?.startsWith('text/')) return 'TXT';
  if (asset.mimeType?.startsWith('image/')) return 'IMG';
  if (asset.mimeType?.startsWith('video/')) return 'VID';
  if (asset.mimeType?.startsWith('audio/')) return 'AUD';
  if (asset.mimeType === 'application/json') return 'JSON';
  return asset.mimeType || 'ASSET';
}

function isCallableSlashAsset(asset: SlashProductionAsset) {
  return asset.scope === 'TEAM' && asset.reviewStatus === 'APPROVED' && !asset.archivedAt && !asset.deletedAt;
}

export default function SlashAssetPicker({ projectId, fromStage, query, anchor, onClose, onResolved }: SlashAssetPickerProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(query);
  const [activeIndex, setActiveIndex] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setSearch(query);
    setActiveIndex(0);
  }, [query]);

  const assetsQuery = useQuery({
    queryKey: ['slash-assets', projectId, fromStage, search],
    queryFn: () => fetchSlashAssets({ projectId, fromStage, query: search }),
    enabled: Boolean(projectId),
    staleTime: 10_000
  });

  const assets = (assetsQuery.data?.assets || []).filter(isCallableSlashAsset);
  const sourceStage = assetsQuery.data?.sourceStage || null;
  const visibleAssets = useMemo(() => assets.slice(0, 20), [assets]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((value) => Math.min(value + 1, Math.max(visibleAssets.length - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((value) => Math.max(value - 1, 0));
      } else if (event.key === 'Enter' && visibleAssets[activeIndex]) {
        event.preventDefault();
        void chooseAsset(visibleAssets[activeIndex]);
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [activeIndex, visibleAssets]);

  async function chooseAsset(asset: SlashProductionAsset) {
    setResolvingId(asset.id);
    setError('');
    try {
      const resolved = await resolveSlashAsset({
        projectId,
        fromStage,
        assetId: asset.id,
        snapshotId: asset.currentSnapshotId || undefined
      });
      onResolved(resolved);
    } catch (err: any) {
      if (isStaleProductionAssetError(err)) {
        queryClient.invalidateQueries({ queryKey: ['slash-assets'] });
        queryClient.invalidateQueries({ queryKey: ['production-assets'] });
        void queryClient.refetchQueries({ queryKey: ['slash-assets'], type: 'active' });
        void queryClient.refetchQueries({ queryKey: ['production-assets'], type: 'active' });
        notifyProductionAssetsChanged({ reason: 'slash_asset_stale', projectId, fromStage });
        setError(staleProductionAssetMessage('调用失败'));
      } else {
        setError(err?.message || '团队资产调用失败');
      }
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div
      className="fixed z-[120] w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-md border border-cyan-500/40 bg-[#050708] shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
      style={{ top: Math.min(anchor.top, window.innerHeight - 360), left: Math.min(anchor.left, window.innerWidth - 380) }}
    >
      <div className="flex items-center justify-between border-b border-cyan-900/40 bg-cyan-950/30 px-3 py-2">
        <div>
          <div className="text-[10px] font-mono tracking-widest text-cyan-500">TEAM ASSET SLASH</div>
          <div className="text-xs font-semibold text-cyan-100">{labelForStage(fromStage)} 调用 {labelForStage(sourceStage)}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-cyan-600 hover:bg-cyan-950/60 hover:text-cyan-200" title="关闭">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-cyan-900/30 p-2">
        <label className="flex h-8 items-center gap-2 rounded border border-cyan-900/50 bg-black/50 px-2">
          <Search className="h-3.5 w-3.5 text-cyan-700" />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIndex(0);
            }}
            autoFocus
            placeholder="搜索上游团队资产"
            className="min-w-0 flex-1 bg-transparent text-xs text-cyan-100 outline-none placeholder:text-cyan-800"
          />
        </label>
      </div>

      <div className="max-h-64 overflow-y-auto p-2">
        {assetsQuery.isLoading ? (
          <div className="flex justify-center py-6"><InlineStatus loading tone="info">正在读取团队资产...</InlineStatus></div>
        ) : assetsQuery.error ? (
          <PageNotice tone="error">上游团队资产读取失败，请稍后重试。</PageNotice>
        ) : visibleAssets.length === 0 ? (
          <EmptyState
            tone="info"
            title={search.trim() ? '没有匹配的上游团队资产' : '暂无可调用的上游团队资产'}
            description={sourceStage ? `需要先在 ${labelForStage(sourceStage)} 阶段保存资产并通过团队审核，之后才能从这里插入。` : '当前阶段暂未配置可调用的上游资源。'}
          />
        ) : (
          <div className="space-y-1">
            {visibleAssets.map((asset, index) => (
              <button
                key={asset.id}
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void chooseAsset(asset)}
                className={`grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 py-2 text-left transition-colors ${activeIndex === index ? 'bg-cyan-500/15 text-cyan-100' : 'text-cyan-300 hover:bg-cyan-950/40'}`}
              >
                <span className="text-center text-[10px] font-bold text-cyan-600">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{asset.displayName || asset.originalName}</span>
                  <span className="block truncate text-[10px] text-cyan-700">{asset.projectName || asset.projectId || '当前项目'}</span>
                </span>
                <span className="rounded border border-cyan-900/50 px-1.5 py-0.5 text-[9px] text-cyan-600">
                  {resolvingId === asset.id ? <Loader2 className="h-3 w-3 animate-spin" /> : assetTypeLabel(asset)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="border-t border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-200">{error}</div>}
      <div className="border-t border-cyan-900/30 px-3 py-2 text-[10px] text-cyan-800">↑ ↓ 选择，Enter 插入，Esc 关闭</div>
    </div>
  );
}
