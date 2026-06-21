import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, FileText, Loader2, Search, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { deleteProductionAsset, fetchProductionAssets, submitProductionAssetReview } from '../lib/db';
import { EmptyState, InlineStatus, PageNotice, PermissionHint } from './ui/State';
import type { ProductionAsset, ProductionStage } from '../types';

interface SidebarProps {
  activeNode: string;
  currentProjectId?: string | null;
  onSelectNode?: (nodeName: string) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

type AssetTab = 'personal' | 'team';

const stageByNode: Record<string, ProductionStage> = {
  '02': 'SCRIPT_01',
  '04': 'ART_03',
  '05': 'SHOT_04',
  '06': 'EDIT_05'
};

const sidebarTitleByNode: Record<string, string> = {
  '02': '剧本文档库',
  '04': '美术资产库',
  '05': '镜头资产库',
  '06': '剪辑媒体库'
};

const searchPlaceholderByNode: Record<string, string> = {
  '02': '搜索剧本文档...',
  '04': '搜索美术资产...',
  '05': '搜索镜头资产...',
  '06': '搜索剪辑资产...'
};

const emptyTextByNode: Record<string, string> = {
  '02': '暂无剧本文档资产',
  '04': '暂无美术资产',
  '05': '暂无镜头资产',
  '06': '暂无剪辑资产'
};

function statusLabel(status: ProductionAsset['reviewStatus']) {
  if (status === 'UNREVIEWED') return '未审核';
  if (status === 'IN_REVIEW') return '审核中';
  if (status === 'APPROVED') return '审核通过';
  if (status === 'REJECTED') return '审核未通过';
  if (status === 'ARCHIVED') return '封存';
  if (status === 'REFERENCE') return '参考素材';
  return status;
}

function statusClass(status: ProductionAsset['reviewStatus']) {
  if (status === 'APPROVED') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (status === 'IN_REVIEW') return 'border-amber-400/30 bg-amber-400/10 text-amber-200';
  if (status === 'REJECTED') return 'border-red-400/30 bg-red-400/10 text-red-200';
  if (status === 'ARCHIVED') return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
  return 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200';
}

function statusIcon(status: ProductionAsset['reviewStatus']) {
  if (status === 'APPROVED') return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === 'IN_REVIEW') return <Clock3 className="h-3.5 w-3.5" />;
  if (status === 'REJECTED') return <XCircle className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
}

function fileType(asset: ProductionAsset) {
  if (asset.mimeType?.startsWith('text/')) return 'TXT';
  if (asset.mimeType?.startsWith('image/')) return 'IMG';
  if (asset.mimeType?.startsWith('video/')) return 'VID';
  if (asset.mimeType?.startsWith('audio/')) return 'AUD';
  return asset.mimeType || asset.sourceType || 'ASSET';
}

function isVisibleSidebarAsset(asset: ProductionAsset, tab: AssetTab) {
  if (asset.deletedAt) return false;
  if (tab === 'team') return asset.scope === 'TEAM' && asset.reviewStatus === 'APPROVED' && !asset.archivedAt;
  return asset.scope === 'PERSONAL';
}

function canDeletePersonalAsset(asset: ProductionAsset) {
  return asset.scope === 'PERSONAL' && (asset.reviewStatus === 'UNREVIEWED' || asset.reviewStatus === 'REJECTED');
}

function AssetCard({
  asset,
  tab,
  onSubmitReview,
  onDelete,
  busy
}: {
  key?: React.Key;
  asset: ProductionAsset;
  tab: AssetTab;
  onSubmitReview: (asset: ProductionAsset) => void;
  onDelete: (asset: ProductionAsset) => void;
  busy: boolean;
}) {
  return (
    <div className="group rounded border border-white/10 bg-white/[0.03] p-2 hover:bg-white/[0.06] transition-colors">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded border border-white/10 bg-black/30 p-1 text-cyan-300">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : statusIcon(asset.reviewStatus)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-white" title={asset.displayName || asset.originalName}>
            {asset.displayName || asset.originalName}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span>v{asset.version || 1}</span>
            <span>/</span>
            <span className="truncate">{fileType(asset)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`inline-flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${statusClass(asset.reviewStatus)}`}>
          {statusLabel(asset.reviewStatus)}
        </span>
        {tab === 'personal' && (
          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
            {asset.reviewStatus === 'UNREVIEWED' || asset.reviewStatus === 'REJECTED' ? (
              <button
                type="button"
                onClick={() => onSubmitReview(asset)}
                disabled={busy}
                className="rounded border border-cyan-500/30 bg-cyan-500/10 p-1 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
                title="提交审核"
              >
                <UploadCloud className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {canDeletePersonalAsset(asset) ? (
              <button
                type="button"
                onClick={() => onDelete(asset)}
                disabled={busy}
                className="rounded border border-red-500/20 bg-red-500/10 p-1 text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                title="删除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Sidebar({ activeNode, currentProjectId, collapsed, setCollapsed }: SidebarProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AssetTab>('personal');
  const [query, setQuery] = useState('');
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const stage = stageByNode[activeNode];
  const title = sidebarTitleByNode[activeNode] || '项目资产库';

  const assetsQuery = useQuery({
    queryKey: ['production-assets', tab, currentProjectId || 'no-project', stage, query],
    queryFn: () => fetchProductionAssets({ scope: tab, projectId: currentProjectId, stage, query }),
    enabled: Boolean(stage) && (tab === 'personal' || Boolean(currentProjectId)),
    staleTime: 10_000
  });

  const submitMutation = useMutation({
    mutationFn: submitProductionAssetReview,
    onMutate: (assetId) => setBusyAssetId(assetId),
    onSettled: () => {
      setBusyAssetId(null);
      queryClient.invalidateQueries({ queryKey: ['production-assets'] });
      queryClient.invalidateQueries({ queryKey: ['slash-assets'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProductionAsset,
    onMutate: (assetId) => setBusyAssetId(assetId),
    onSettled: () => {
      setBusyAssetId(null);
      queryClient.invalidateQueries({ queryKey: ['production-assets'] });
      queryClient.invalidateQueries({ queryKey: ['slash-assets'] });
    }
  });

  useEffect(() => {
    const refreshAssets = () => {
      queryClient.invalidateQueries({ queryKey: ['production-assets'] });
      queryClient.invalidateQueries({ queryKey: ['slash-assets'] });
      void queryClient.refetchQueries({ queryKey: ['production-assets'], type: 'active' });
      void queryClient.refetchQueries({ queryKey: ['slash-assets'], type: 'active' });
    };
    window.addEventListener('jiying:production-assets-changed', refreshAssets);
    return () => window.removeEventListener('jiying:production-assets-changed', refreshAssets);
  }, [queryClient]);

  const assets = (assetsQuery.data || []).filter((asset) => isVisibleSidebarAsset(asset, tab));
  const error = assetsQuery.error || submitMutation.error || deleteMutation.error;

  function submitReview(asset: ProductionAsset) {
    if (!window.confirm(`确认提交审核：${asset.displayName || asset.originalName}？`)) return;
    submitMutation.mutate(asset.id);
  }

  function softDelete(asset: ProductionAsset) {
    if (!window.confirm(`确认删除个人资产：${asset.displayName || asset.originalName}？数据库审计记录会保留。`)) return;
    deleteMutation.mutate(asset.id);
  }

  if (collapsed) return null;

  return (
    <aside className="w-72 shrink-0 bg-[#0a0a0a] flex flex-col z-20 border-r border-[rgba(255,255,255,0.08)] relative h-full select-none">
      <div className="p-6 h-full flex flex-col w-72">
        <div className="flex justify-between items-center mb-6">
          <div className="min-w-0">
            <div className="text-[10px] text-gray-500 tracking-widest uppercase font-bold truncate">{title}</div>
            {currentProjectId && <div className="mt-1 truncate text-[9px] font-mono text-zinc-600">{currentProjectId}</div>}
          </div>
          <button onClick={() => setCollapsed(true)} className="text-gray-500 hover:text-white transition-colors cursor-pointer" title="收起面板">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <div className="flex bg-white/5 rounded-lg p-1 mb-4">
          <button
            type="button"
            onClick={() => setTab('personal')}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${tab === 'personal' ? 'bg-white/10 text-white font-bold shadow' : 'text-gray-500 hover:text-white'}`}
          >
            个人资产
          </button>
          <button
            type="button"
            onClick={() => setTab('team')}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${tab === 'team' ? 'bg-white/10 text-white font-bold shadow' : 'text-gray-500 hover:text-white'}`}
          >
            团队资产
          </button>
        </div>

        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-2 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholderByNode[activeNode] || '搜索资产...'}
            className="w-full bg-transparent border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/30"
          />
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {!stage ? (
            <EmptyState title="当前阶段暂未接入资产库" description="切换到剧本、导演、美术、镜头或剪辑阶段后，可查看对应资产。" />
          ) : tab === 'team' && !currentProjectId ? (
            <PermissionHint title="请选择项目后查看团队资产">
              团队资产只在具体个人/团队项目中生效，请从工作台打开项目后再调用已审核资源。
            </PermissionHint>
          ) : assetsQuery.isLoading ? (
            <InlineStatus loading>正在读取资产...</InlineStatus>
          ) : error ? (
            <PageNotice tone="error">{(error as any)?.message || '资产读取失败，请稍后重试。'}</PageNotice>
          ) : assets.length === 0 ? (
            <EmptyState
              title={query.trim() ? '没有匹配的资产' : (emptyTextByNode[activeNode] || '暂无资产')}
              description={query.trim()
                ? '请尝试更换关键词，或切换个人资产/团队资产范围。'
                : tab === 'personal'
                  ? '在当前阶段生成内容后，可以保存为个人资产；需要复用时再提交团队审核。'
                  : '团队资产需要由制片审核通过后才会出现在这里。'}
            />
          ) : (
            <div className="space-y-2">
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  tab={tab}
                  busy={busyAssetId === asset.id}
                  onSubmitReview={submitReview}
                  onDelete={softDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
