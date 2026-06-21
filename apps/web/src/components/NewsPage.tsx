import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, ArrowRight, ExternalLink, Newspaper, Radar, RefreshCw, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

type NewsItem = {
  id?: string;
  dateGroup: string;
  title: string;
  summary: string;
  category: string;
  sourceName: string;
  sourceUrl: string;
  credibilityStatus: 'VERIFIED' | 'PENDING_REVIEW';
  fetchedAt: string;
  updatedAt?: string;
};

type BroadcastResponse = {
  days: string[];
  groups: Array<{ dateGroup: string; items: NewsItem[] }>;
  items: NewsItem[];
  maxPerDay: number;
  retentionDays: number;
  stats: {
    updatedAt: string | null;
    status: 'ok' | 'failed' | 'empty';
    message?: string;
    sourceCount: number;
    fetchedCount: number;
    filteredCount: number;
    pendingReviewCount: number;
    translation?: {
      candidateModelCount: number;
      attemptedModelCount: number;
      successCount: number;
      failureCount: number;
      lastError: string | null;
    };
    cacheDateRange: { from: string; to: string };
    lastSuccessfulUpdateAt: string | null;
    sourceStatuses?: SourceStatus[];
    scheduler?: {
      schedulerEnabled: boolean;
      dailyRunTime: string;
      nextScheduledRunAt: string | null;
      lastScheduledRunAt: string | null;
      lastScheduledReason: 'cron' | 'startup-catchup' | 'manual' | null;
      lastScheduledStatus: 'idle' | 'running' | 'ok' | 'empty' | 'failed' | 'skipped';
      lastScheduledMessage?: string;
      runningRunId?: string | null;
      startedAt?: string | null;
      expiresAt?: string | null;
      lastCompletedRunId?: string | null;
      lastSuccessfulDateGroup?: string | null;
    };
  };
  updateFailed: boolean;
  statusMessage?: string;
  webSearch?: { tavilyConfigured: boolean; braveConfigured: boolean };
};

type SourceStatus = {
  sourceName: string;
  sourceUrl: string;
  category: string;
  trustLevel: 'OFFICIAL' | 'BENCHMARK' | 'GITHUB' | 'MEDIA' | 'COMMUNITY';
  parser: 'HTML_ARTICLE' | 'SITEMAP' | 'RSS' | 'GITHUB_RELEASES' | 'STATIC_JSON' | 'LEADERBOARD_PAGE';
  ok: boolean;
  statusCode?: number;
  linkCount: number;
  candidateCount: number;
  filteredCount: number;
  pendingReviewCount: number;
  fetchedAt: string;
  message?: string;
};

type RefreshState = {
  loading: boolean;
  message: string | null;
  error: string | null;
};

type ArenaModelType = 'MULTIMODAL' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OPEN_SOURCE' | 'TEXT' | 'UNKNOWN';

type MetricKey =
  | 'overallScore'
  | 'qualityScore'
  | 'reasoningScore'
  | 'codingScore'
  | 'multimodalScore'
  | 'speedScore'
  | 'costScore'
  | 'imageQualityScore'
  | 'promptAdherenceScore'
  | 'characterConsistencyScore'
  | 'imageEditingScore'
  | 'videoQualityScore'
  | 'motionStabilityScore'
  | 'videoCharacterConsistencyScore'
  | 'maxDurationScore';

type TrendSnapshot = {
  checkedAt: string;
  overallScore?: number | null;
  rank?: number | null;
  priceNote?: string | null;
  speedScore?: number | null;
  videoQualityScore?: number | null;
  motionStabilityScore?: number | null;
  costScore?: number | null;
  sourceUrl: string;
};

type ArenaItem = {
  modelName: string;
  provider: string;
  category: string;
  modelType: ArenaModelType;
  officialUrl?: string | null;
  source: string;
  sourceUrl: string;
  priceNote?: string | null;
  overallScore?: number | null;
  qualityScore?: number | null;
  reasoningScore?: number | null;
  codingScore?: number | null;
  multimodalScore?: number | null;
  speedScore?: number | null;
  costScore?: number | null;
  rank?: number | null;
  imageQualityScore?: number | null;
  promptAdherenceScore?: number | null;
  characterConsistencyScore?: number | null;
  imageEditingScore?: number | null;
  videoQualityScore?: number | null;
  motionStabilityScore?: number | null;
  videoCharacterConsistencyScore?: number | null;
  maxDurationScore?: number | null;
  trendSnapshots: TrendSnapshot[];
  lastCheckedAt: string;
  lastChangedAt?: string | null;
  impact: string;
};

type ArenaResponse = {
  updatedAt: string | null;
  lastChangedAt?: string | null;
  sources: string[];
  scheduler?: {
    running: boolean;
    runId: string | null;
    reason: 'cron' | 'startup-catchup' | 'manual' | null;
    startedAt: string | null;
    expiresAt: string | null;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastSuccessDateGroup?: string | null;
    lastStatus: 'idle' | 'running' | 'ok' | 'empty' | 'failed' | 'skipped';
    lastMessage?: string;
    nextScheduledRunAt?: string | null;
  };
  sourceStatuses: Array<{ source: string; sourceUrl: string; ok: boolean; statusCode?: number; itemCount?: number; parsedMetricCount?: number; message?: string; fetchedAt: string }>;
  items: ArenaItem[];
  categoryCharts?: Array<{
    category: 'MULTIMODAL' | 'IMAGE' | 'VIDEO' | 'AUDIO';
    label: string;
    defaultMetric: 'quality' | 'price' | 'speed' | 'costPerformance';
    availableMetrics: Array<'quality' | 'price' | 'speed' | 'costPerformance'>;
    bars: Record<'quality' | 'price' | 'speed' | 'costPerformance', ArenaBarDatum[]>;
  }>;
  topModelsByCategory?: Array<{
    category: 'MULTIMODAL' | 'IMAGE' | 'VIDEO' | 'AUDIO';
    label: string;
    item: ArenaItem | null;
  }>;
  radar: { model: ArenaItem | null; peerAverage: Partial<Record<MetricKey, number | null>>; metrics: MetricKey[] };
  imageRanking: ArenaItem[];
  videoTrendModels: ArenaItem[];
  representatives: Array<{ type: ArenaModelType; item: ArenaItem | null }>;
  maxTrendDays: number;
  status: 'ok' | 'empty' | 'failed';
  message?: string;
};

type ArenaCategoryKey = 'MULTIMODAL' | 'IMAGE' | 'VIDEO' | 'AUDIO';
type ArenaBarMetricKey = 'quality' | 'price' | 'speed' | 'costPerformance';

type ArenaBarDatum = {
  modelName: string;
  provider: string;
  modelType: ArenaCategoryKey;
  source: string;
  sourceUrl: string;
  officialUrl?: string | null;
  value: number;
  metric: ArenaBarMetricKey;
  displayValue: string;
  priceNote?: string | null;
  rank?: number | null;
  lastCheckedAt: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `Request failed: ${response.status}`);
  return data as T;
}

function formatDateTime(value?: string | null) {
  if (!value) return '暂无';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function shanghaiDateKey(value: Date | string | null | undefined = new Date()) {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function hasPassedShanghaiRefreshTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(map.hour);
  const minute = Number(map.minute);
  return hour > 8 || (hour === 8 && minute >= 55);
}

function schedulerStatusLabel(status?: NonNullable<BroadcastResponse['stats']['scheduler']>['lastScheduledStatus']) {
  if (status === 'running') return '运行中';
  if (status === 'ok') return '已更新';
  if (status === 'empty') return '无新增';
  if (status === 'failed') return '失败';
  if (status === 'skipped') return '已跳过';
  return '待执行';
}

function schedulerReasonLabel(reason?: NonNullable<BroadcastResponse['stats']['scheduler']>['lastScheduledReason']) {
  if (reason === 'cron') return '定时任务';
  if (reason === 'startup-catchup') return '启动补偿';
  if (reason === 'manual') return '手动刷新';
  return '暂无';
}

function arenaSchedulerStatusLabel(status?: NonNullable<ArenaResponse['scheduler']>['lastStatus']) {
  return schedulerStatusLabel(status as any);
}

function arenaSchedulerReasonLabel(reason?: NonNullable<ArenaResponse['scheduler']>['reason']) {
  return schedulerReasonLabel(reason as any);
}

function displayScore(value?: number | null) {
  return typeof value === 'number' ? String(value) : 'unknown';
}

const chartColors = ['#22d3ee', '#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#f472b6', '#2dd4bf', '#c084fc', '#f97316'];

function stableColor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return chartColors[hash % chartColors.length];
}

function shortModelName(value: string, max = 24) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function arenaCategoryLabel(category: ArenaCategoryKey) {
  if (category === 'MULTIMODAL') return '多模态模型';
  if (category === 'IMAGE') return '生图模型';
  if (category === 'VIDEO') return '生视频模型';
  return '音频模型';
}

function arenaCategoryDefaultMetric(category: ArenaCategoryKey): ArenaBarMetricKey {
  if (category === 'IMAGE') return 'quality';
  if (category === 'VIDEO') return 'quality';
  if (category === 'AUDIO') return 'quality';
  return 'quality';
}

function arenaMetricLabel(metric: ArenaBarMetricKey) {
  if (metric === 'quality') return '质量 / 综合分';
  if (metric === 'price') return '价格';
  if (metric === 'speed') return '速度';
  return '性价比';
}

function arenaMetricDescription(metric: ArenaBarMetricKey) {
  if (metric === 'quality') return '高越好';
  if (metric === 'price') return '低越便宜';
  if (metric === 'speed') return '高越好';
  return '高越好';
}

function arenaValueLabel(metric: ArenaBarMetricKey, value: number) {
  if (metric === 'price') return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
  return displayBarValue(value);
}

function priceAxisLabel(value: number) {
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function categoryModelRank(item: ArenaItem) {
  if (item.modelType === 'IMAGE') return item.imageQualityScore ?? item.overallScore ?? item.qualityScore ?? 0;
  if (item.modelType === 'VIDEO') return item.videoQualityScore ?? item.overallScore ?? item.qualityScore ?? 0;
  return item.overallScore ?? item.qualityScore ?? item.multimodalScore ?? item.codingScore ?? 0;
}

function displayBarValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function parsePriceValue(note?: string | null) {
  if (!note) return null;
  const normalized = note.replace(/,/g, ' ').toLowerCase();
  const hasCurrency = /(?:\$|usd|us\$)/i.test(normalized);
  const hasComparableUnit = /(?:1\s*(?:m|k)|per|\/)\s*(?:tokens?|token|images?|image|generations?|generation|requests?|request|seconds?|second|secs?|minutes?|minute|chars?|characters?|videos?|video|audios?|audio)/i.test(normalized)
    || /\b(?:tokens?|token|images?|image|generations?|generation|requests?|request|seconds?|second|secs?|minutes?|minute|chars?|characters?|videos?|video|audios?|audio)\b/i.test(normalized);
  if (!hasCurrency || !hasComparableUnit) return null;
  const matches =
    normalized.match(/(?:\$|usd|us\$)\s*(\d+(?:\.\d+)?)/i) ||
    normalized.match(/(\d+(?:\.\d+)?)\s*(?:\$|usd|us\$)/i) ||
    normalized.match(/(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(?:1\s*(?:m|k)|)\s*(?:tokens?|token|images?|image|generations?|generation|requests?|request|seconds?|second|secs?|minutes?|minute|chars?|characters?|videos?|video|audios?|audio)/i);
  if (!matches) return null;
  const value = Number(matches[1]);
  return Number.isFinite(value) ? value : null;
}

function deriveCategoryCharts(items: ArenaItem[]): NonNullable<ArenaResponse['categoryCharts']> {
  const categories: ArenaCategoryKey[] = ['MULTIMODAL', 'IMAGE', 'VIDEO', 'AUDIO'];
  return categories.map((category) => {
    const categoryItems = items.filter((item) => item.modelType === category);
    const quality = [...categoryItems]
      .filter((item) => categoryModelRank(item) > 0)
      .sort((a, b) => categoryModelRank(b) - categoryModelRank(a))
      .slice(0, 15)
      .map((item) => ({
        modelName: item.modelName,
        provider: item.provider,
        modelType: category,
        source: item.source,
        sourceUrl: item.sourceUrl,
        officialUrl: item.officialUrl || null,
        value: categoryModelRank(item),
        metric: 'quality' as const,
        displayValue: arenaValueLabel('quality', categoryModelRank(item)),
        priceNote: item.priceNote || null,
        rank: item.rank ?? null,
        lastCheckedAt: item.lastCheckedAt
      }));
    const price = [...categoryItems]
      .map((item) => ({ item, value: parsePriceValue(item.priceNote) }))
      .filter((entry): entry is { item: ArenaItem; value: number } => entry.value !== null)
      .sort((a, b) => a.value - b.value)
      .slice(0, 15)
      .map(({ item, value }) => ({
        modelName: item.modelName,
        provider: item.provider,
        modelType: category,
        source: item.source,
        sourceUrl: item.sourceUrl,
        officialUrl: item.officialUrl || null,
        value,
        metric: 'price' as const,
        displayValue: arenaValueLabel('price', value),
        priceNote: item.priceNote || null,
        rank: item.rank ?? null,
        lastCheckedAt: item.lastCheckedAt
      }));
    const speed = [...categoryItems]
      .map((item) => ({ item, value: item.speedScore }))
      .filter((entry): entry is { item: ArenaItem; value: number } => typeof entry.value === 'number')
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(({ item, value }) => ({
        modelName: item.modelName,
        provider: item.provider,
        modelType: category,
        source: item.source,
        sourceUrl: item.sourceUrl,
        officialUrl: item.officialUrl || null,
        value,
        metric: 'speed' as const,
        displayValue: arenaValueLabel('speed', value),
        priceNote: item.priceNote || null,
        rank: item.rank ?? null,
        lastCheckedAt: item.lastCheckedAt
      }));
    const costPerformance = [...categoryItems]
      .map((item) => ({ item, value: item.costScore }))
      .filter((entry): entry is { item: ArenaItem; value: number } => typeof entry.value === 'number')
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(({ item, value }) => ({
        modelName: item.modelName,
        provider: item.provider,
        modelType: category,
        source: item.source,
        sourceUrl: item.sourceUrl,
        officialUrl: item.officialUrl || null,
        value,
        metric: 'costPerformance' as const,
        displayValue: arenaValueLabel('costPerformance', value),
        priceNote: item.priceNote || null,
        rank: item.rank ?? null,
        lastCheckedAt: item.lastCheckedAt
      }));
    const bars = { quality, price, speed, costPerformance };
    const availableMetrics = (['quality', 'speed', 'costPerformance', 'price'] as ArenaBarMetricKey[]).filter((metric) => bars[metric].length > 0);
    return {
      category,
      label: arenaCategoryLabel(category),
      defaultMetric: availableMetrics[0] || arenaCategoryDefaultMetric(category),
      availableMetrics,
      bars
    };
  });
}

function findArenaItemByBar(data: ArenaResponse | undefined, bar: ArenaBarDatum, category: ArenaCategoryKey) {
  return data?.items?.find((item) =>
    item.modelType === category &&
    item.modelName === bar.modelName &&
    item.provider === bar.provider &&
    item.sourceUrl === bar.sourceUrl
  ) || null;
}

function ModelCategoryBarChart({ data, categoryChart, selectedItem, onSelect }: { data?: ArenaResponse; categoryChart: NonNullable<ArenaResponse['categoryCharts']>[number] | null; selectedItem: ArenaItem | null; onSelect: (item: ArenaItem) => void }) {
  const [metric, setMetric] = useState<ArenaBarMetricKey>(categoryChart?.defaultMetric || 'quality');
  useEffect(() => {
    const nextMetric = categoryChart?.availableMetrics.includes(metric) ? metric : (categoryChart?.defaultMetric || 'quality');
    setMetric(nextMetric);
  }, [categoryChart?.availableMetrics, categoryChart?.defaultMetric, categoryChart?.category, metric]);
  const bars = categoryChart?.bars?.[metric] || [];
  const highlightKey = selectedItem ? `${selectedItem.provider}::${selectedItem.modelName}::${selectedItem.sourceUrl}` : null;
  const max = metric === 'price' ? Math.max(0.0001, ...bars.map((bar) => bar.value)) : Math.max(...bars.map((bar) => bar.value), 100);
  const width = Math.max(620, bars.length * 56 + 120);

  return (
    <section className="rounded-xl border border-white/10 bg-zinc-950 p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="font-semibold text-white">{categoryChart?.label || '模型分类柱状图'}</h3>
          <p className="mt-1 text-xs text-zinc-500">同类对比，unknown 不入榜。{arenaMetricDescription(metric)}。</p>
        </div>
        <select
          value={metric}
          onChange={(event) => setMetric(event.target.value as ArenaBarMetricKey)}
          className="rounded border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
        >
          {categoryChart?.availableMetrics.map((item) => <option key={item} value={item}>{arenaMetricLabel(item)}</option>)}
        </select>
      </div>
      {!bars.length ? (
        <EmptyPanel>暂无可比较的柱状数据。</EmptyPanel>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-4">
            <svg viewBox={`0 0 ${width} 260`} className="h-72 min-w-full">
              {(metric === 'price' ? [0, max / 4, max / 2, (max * 3) / 4, max] : [0, 25, 50, 75, 100]).map((tick) => {
                const y = 210 - ((tick / max) * 170);
                return (
                  <g key={tick}>
                    <line x1="50" x2={width - 20} y1={y} y2={y} stroke="rgba(255,255,255,.08)" />
                    <text x="10" y={y + 4} fill="rgba(161,161,170,.75)" fontSize="10">{metric === 'price' ? priceAxisLabel(tick) : tick}</text>
                  </g>
                );
              })}
              {bars.map((bar, index) => {
                const height = Math.max(4, (bar.value / max) * 170);
                const x = 60 + index * 56;
                const color = stableColor(bar.provider);
                const isHighlighted = highlightKey === `${bar.provider}::${bar.modelName}::${bar.sourceUrl}`;
                const selectedBarItem = findArenaItemByBar(data, bar, categoryChart?.category || 'MULTIMODAL') || null;
                return (
                  <g key={`${bar.provider}-${bar.modelName}`} onClick={() => selectedBarItem && onSelect(selectedBarItem)} className="cursor-pointer">
                    <rect x={x} y={210 - height} width="28" height={height} rx="4" fill={color} opacity={isHighlighted ? 1 : 0.85} stroke={isHighlighted ? '#67e8f9' : 'transparent'} />
                    <text x={x + 14} y={202 - height} textAnchor="middle" fill="#e4e4e7" fontSize="10">{bar.displayValue}</text>
                    <text x={x + 14} y="228" textAnchor="middle" fill="rgba(212,212,216,.8)" fontSize="9" transform={`rotate(-35 ${x + 14} 228)`}>{shortModelName(bar.modelName, 16)}</text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {bars.map((bar) => (
              <button
                key={`${bar.provider}-${bar.modelName}-legend`}
                type="button"
                onClick={() => {
                  const selectedBarItem = findArenaItemByBar(data, bar, categoryChart?.category || 'MULTIMODAL');
                  if (selectedBarItem) onSelect(selectedBarItem);
                }}
                className="flex items-center gap-2 rounded border border-white/10 bg-black/20 px-3 py-2 text-left text-xs text-zinc-300"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stableColor(bar.provider) }} />
                <span className="truncate">{bar.provider} / {bar.modelName}</span>
                <span className="ml-auto text-zinc-500">{bar.displayValue}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function NewsCard({ item, compact = false, highlighted = false }: { item: NewsItem; compact?: boolean; highlighted?: boolean }) {
  return (
    <article
      id={item.id ? `news-item-${item.id}` : undefined}
      data-news-title={item.title}
      className={`border bg-zinc-950/70 p-5 ${compact ? 'rounded-lg' : 'rounded-xl'} transition-colors hover:border-cyan-400/40 ${highlighted ? 'border-cyan-300 shadow-[0_0_0_1px_rgba(103,232,249,0.45),0_18px_60px_rgba(8,145,178,0.18)]' : 'border-white/10'}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>{item.category}</span>
        {item.credibilityStatus === 'PENDING_REVIEW' && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">待核验</span>}
      </div>
      <h3 className={`${compact ? 'text-base' : 'text-2xl'} font-semibold leading-tight text-white`}>{item.title}</h3>
      <p className="mt-3 text-sm leading-6 text-zinc-300">{item.summary}</p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-zinc-400">
        <span className="font-medium text-zinc-200">{item.sourceName}</span>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-100">
          原链接 <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </article>
  );
}

function SourceHealthPanel({ statuses }: { statuses?: SourceStatus[] }) {
  const rows = useMemo(() => [...(statuses || [])].sort((a, b) => Number(b.ok) - Number(a.ok) || b.candidateCount - a.candidateCount || a.sourceName.localeCompare(b.sourceName)), [statuses]);
  if (rows.length === 0) return null;
  const healthy = rows.filter((source) => source.ok).length;
  const totalCandidates = rows.reduce((sum, source) => sum + source.candidateCount, 0);
  const totalLinks = rows.reduce((sum, source) => sum + source.linkCount, 0);

  return (
    <section className="rounded-lg border border-white/10 bg-zinc-950">
      <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">来源健康</h3>
          <p className="mt-1 text-xs text-zinc-500">本轮刷新按后端来源记录可达性、解析量和过滤结果。</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right text-xs">
          <span><b className="block text-base text-emerald-300">{healthy}</b><span className="text-zinc-500">可解析</span></span>
          <span><b className="block text-base text-cyan-300">{totalCandidates}</b><span className="text-zinc-500">入库</span></span>
          <span><b className="block text-base text-zinc-200">{totalLinks}</b><span className="text-zinc-500">链接</span></span>
        </div>
      </div>
      <div className="max-h-80 overflow-auto">
        {rows.map((source) => (
          <a key={source.sourceUrl} href={source.sourceUrl} target="_blank" rel="noreferrer" className="grid gap-3 border-b border-white/5 px-5 py-3 text-xs last:border-b-0 hover:bg-white/[0.03] md:grid-cols-[1.25fr_.7fr_.9fr_1.4fr] md:items-center">
            <span>
              <span className="flex items-center gap-2 font-medium text-zinc-100"><span className={`h-2 w-2 rounded-full ${source.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />{source.sourceName}</span>
              <span className="mt-1 block text-zinc-500">{source.category} / {source.trustLevel}</span>
            </span>
            <span className="text-zinc-400">HTTP {source.statusCode || 'n/a'} / {source.parser}</span>
            <span className="grid grid-cols-4 gap-2 text-center text-zinc-400">
              <span><b className="block text-zinc-100">{source.linkCount}</b>链接</span>
              <span><b className="block text-cyan-200">{source.candidateCount}</b>入库</span>
              <span><b className="block text-zinc-200">{source.filteredCount}</b>过滤</span>
              <span><b className="block text-amber-200">{source.pendingReviewCount}</b>待查</span>
            </span>
            <span className="line-clamp-2 text-zinc-500">{source.message || '暂无状态'}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function BroadcastTab({ data, loading, selectedDateIndex, setSelectedDateIndex, highlightedItemKey }: { data?: BroadcastResponse; loading: boolean; selectedDateIndex: number; setSelectedDateIndex: React.Dispatch<React.SetStateAction<number>>; highlightedItemKey?: string | null }) {
  const days = data?.days || [];
  const selectedDay = days[selectedDateIndex] || days[0] || '';
  const selectedItems = useMemo(() => data?.groups?.find((group) => group.dateGroup === selectedDay)?.items || [], [data, selectedDay]);
  const headliner = selectedItems[0];
  const grouped = useMemo(() => {
    const map = new Map<string, NewsItem[]>();
    for (const item of selectedItems.slice(1)) {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    }
    return map;
  }, [selectedItems]);
  const matchesHighlighted = (item: NewsItem) => Boolean(highlightedItemKey && (item.id === highlightedItemKey || item.title === highlightedItemKey));
  const scheduler = data?.stats?.scheduler;
  const today = shanghaiDateKey();
  const refreshedToday = Boolean(
    today && (scheduler?.lastSuccessfulDateGroup
      ? scheduler.lastSuccessfulDateGroup === today
      : shanghaiDateKey(data?.stats?.lastSuccessfulUpdateAt) === today ||
        ((data?.stats?.status === 'ok' || data?.stats?.status === 'empty') && shanghaiDateKey(data?.stats?.updatedAt) === today))
  );
  const showCatchupNotice = Boolean(data && hasPassedShanghaiRefreshTime() && !refreshedToday);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs uppercase text-cyan-300">
            <Newspaper className="h-4 w-4" /> Rolling 7 days
          </div>
          <h2 className="text-2xl font-semibold text-white">AI 近 7 日新闻播报 - {selectedDay || '暂无日期'}</h2>
          <p className="mt-2 text-sm text-zinc-400">后端按北京时间滚动保存最近 7 天可信新闻，每天 08:55 自动更新。</p>
          {data?.updateFailed && <p className="mt-2 text-sm text-amber-200">今日更新失败，当前使用上次可信数据。</p>}
          {!data?.updateFailed && data?.statusMessage && <p className="mt-2 text-sm text-zinc-500">{data.statusMessage}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-zinc-500 sm:grid-cols-4">
            <span>更新时间：{formatDateTime(data?.stats?.updatedAt)}</span>
            <span>来源数：{data?.stats?.sourceCount ?? 0}</span>
            <span>成功抓取：{data?.stats?.fetchedCount ?? 0}</span>
            <span>缓存范围：{data?.stats?.cacheDateRange?.to || '--'} 至 {data?.stats?.cacheDateRange?.from || '--'}</span>
          </div>
          <div className="mt-4 grid gap-2 rounded-lg border border-white/10 bg-zinc-950/70 p-3 text-xs text-zinc-400 sm:grid-cols-2 lg:grid-cols-4">
            <span>调度状态：<b className={scheduler?.lastScheduledStatus === 'failed' ? 'text-amber-200' : scheduler?.lastScheduledStatus === 'running' ? 'text-cyan-200' : 'text-zinc-100'}>{schedulerStatusLabel(scheduler?.lastScheduledStatus)}</b></span>
            <span>触发来源：{schedulerReasonLabel(scheduler?.lastScheduledReason)}</span>
            <span>上次调度：{formatDateTime(scheduler?.lastScheduledRunAt)}</span>
            <span>下次计划：{formatDateTime(scheduler?.nextScheduledRunAt)}</span>
            {scheduler?.lastScheduledMessage && <span className="sm:col-span-2 lg:col-span-4">说明：{scheduler.lastScheduledMessage}</span>}
            {showCatchupNotice && <span className="text-amber-200 sm:col-span-2 lg:col-span-4">已过今日 08:55，但尚未看到今天的成功刷新记录。页面会继续读取后端状态，普通用户不会触发后台抓取。</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSelectedDateIndex((value) => Math.min(days.length - 1, value + 1))} disabled={!days.length || selectedDateIndex >= days.length - 1} className="inline-flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-zinc-950 text-zinc-300 hover:text-white disabled:opacity-30" title="前一天">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-[8rem] rounded border border-white/10 bg-zinc-950 px-3 py-2 text-center text-sm text-zinc-200">{selectedDay || '--'}</div>
          <button type="button" onClick={() => setSelectedDateIndex((value) => Math.max(0, value - 1))} disabled={!days.length || selectedDateIndex === 0} className="inline-flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-zinc-950 text-zinc-300 hover:text-white disabled:opacity-30" title="后一天">
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading && <div className="rounded-lg border border-white/10 bg-zinc-950 p-8 text-sm text-zinc-400">正在加载新闻播报...</div>}
      {!loading && !headliner && <div className="rounded-lg border border-white/10 bg-zinc-950 p-8 text-sm text-zinc-400">该日期暂无可信 AI 新闻。系统不会用占位内容或过期数据冒充当天新闻。</div>}

      {headliner && (
        <div className="rounded-xl border border-cyan-400/30 bg-cyan-950/20 p-1">
          <div className="rounded-lg bg-zinc-950/80 p-6">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 px-3 py-1 text-xs text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" /> 今日头条
            </div>
            <NewsCard item={headliner} highlighted={matchesHighlighted(headliner)} />
          </div>
        </div>
      )}

      {Array.from(grouped.entries()).map(([category, items]) => (
        <section key={category} className="space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h3 className="text-lg font-semibold text-white">{category}</h3>
            <span className="text-xs text-zinc-500">{items.length} 条</span>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {items.map((item) => (
              <div key={item.id || item.sourceUrl}>
                <NewsCard item={item} compact highlighted={matchesHighlighted(item)} />
              </div>
            ))}
          </div>
        </section>
      ))}

      <SourceHealthPanel statuses={data?.stats?.sourceStatuses} />
    </motion.div>
  );
}

function RefreshButton({ activeTab, canRefresh, selectedDate, state, onRefresh }: { activeTab: 'broadcast' | 'arena'; canRefresh: boolean; selectedDate: string; state: RefreshState; onRefresh: () => void }) {
  if (!canRefresh) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onRefresh}
        disabled={state.loading || (activeTab === 'broadcast' && !selectedDate)}
        className="inline-flex items-center gap-2 rounded border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} />
        {activeTab === 'broadcast' ? `刷新 ${selectedDate || '当前日期'}` : '刷新模型竞技场'}
      </button>
      {state.message && <p className="max-w-sm text-right text-xs text-emerald-300">{state.message}</p>}
      {state.error && <p className="max-w-sm text-right text-xs text-amber-300">{state.error}</p>}
    </div>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-white/10 bg-zinc-950 p-8 text-sm leading-6 text-zinc-400">{children}</div>;
}

function ArenaTab({ data, loading, error }: { data?: ArenaResponse; loading: boolean; error: boolean }) {
  const [selectedModel, setSelectedModel] = useState<ArenaItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ArenaCategoryKey>('MULTIMODAL');
  const okSources = data?.sourceStatuses?.filter((source) => source.ok).length || 0;
  const failedSources = data?.sourceStatuses?.filter((source) => !source.ok).length || 0;
  const scheduler = data?.scheduler;
  const categoryCharts = data?.categoryCharts?.length ? data.categoryCharts : deriveCategoryCharts(data?.items || []);
  const activeCategoryChart = categoryCharts.find((chart) => chart.category === selectedCategory) || categoryCharts[0] || null;
  const categoryCount = data?.items?.filter((item) => item.modelType === selectedCategory).length || 0;
  const topModelsByCategory = data?.topModelsByCategory?.length
    ? data.topModelsByCategory
    : (['MULTIMODAL', 'IMAGE', 'VIDEO', 'AUDIO'] as ArenaCategoryKey[]).map((category) => ({
        category,
        label: arenaCategoryLabel(category),
        item: [...(data?.items || [])].filter((item) => item.modelType === category).sort((a, b) => categoryModelRank(b) - categoryModelRank(a))[0] || null
      }));
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs uppercase text-blue-300"><Radar className="h-4 w-4" /> Model arena</div>
          <h2 className="text-2xl font-semibold text-white">模型竞技场</h2>
          <p className="mt-2 text-sm text-zinc-400">已启用 LMArena、Artificial Analysis、OpenRouter、LiteLLM 与 Hugging Face 来源；无法确认的分数显示 unknown，不生成假排名。</p>
        </div>
        <div className="space-y-1 text-xs text-zinc-500">
          <div>最后更新：{formatDateTime(data?.updatedAt)}</div>
          <div>当前分类：{arenaCategoryLabel(selectedCategory)} / {categoryCount} 个模型</div>
        </div>
      </div>
      {loading && <EmptyPanel>正在加载模型竞技场...</EmptyPanel>}
      {error && <EmptyPanel>模型竞技场加载失败，请稍后重试。</EmptyPanel>}
      {!loading && !error && data && (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['模型总数', String(data.items.length)],
            ['可用来源', String(okSources)],
            ['不可用来源', String(failedSources)],
            ['自动任务', arenaSchedulerStatusLabel(scheduler?.lastStatus)],
            ['最后成功', formatDateTime(scheduler?.lastSuccessAt)],
            ['下次计划', formatDateTime(scheduler?.nextScheduledRunAt)]
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-500">{label}</div>
              <div className="mt-2 truncate text-lg font-semibold text-white">{value}</div>
            </div>
          ))}
          {scheduler?.lastMessage && <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-xs text-blue-100 md:col-span-3 xl:col-span-6">调度说明：{scheduler.lastMessage} / 触发来源：{arenaSchedulerReasonLabel(scheduler.reason)}</div>}
        </div>
      )}
      {!loading && !error && data?.message && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">{data.message}</div>}
      <div className="grid gap-3 rounded-lg border border-white/10 bg-zinc-950 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="block text-xs text-zinc-500">
          模型类型
          <select
            value={selectedCategory}
            onChange={(event) => {
              setSelectedCategory(event.target.value as ArenaCategoryKey);
              setSelectedModel(null);
            }}
            className="mt-2 w-full rounded border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
          >
            {(categoryCharts.length ? categoryCharts : (['MULTIMODAL', 'IMAGE', 'VIDEO', 'AUDIO'] as ArenaCategoryKey[]).map((category) => ({
              category,
              label: arenaCategoryLabel(category),
              defaultMetric: 'quality' as const,
              availableMetrics: ['quality', 'price', 'speed', 'costPerformance'] as ArenaBarMetricKey[],
              bars: { quality: [], price: [], speed: [], costPerformance: [] }
            }))).map((chart) => (
              <option key={chart.category} value={chart.category}>{chart.label}</option>
            ))}
          </select>
        </label>
        <div className="text-xs text-zinc-500">
          当前分类模型数
          <div className="mt-2 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">{categoryCount}</div>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>模型总数</div>
          <div className="mt-2 rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">{data?.items?.length || 0}</div>
        </div>
      </div>
      <ModelCategoryBarChart data={data} categoryChart={activeCategoryChart} selectedItem={selectedModel} onSelect={setSelectedModel} />
      {selectedModel && (
        <section className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-5 text-sm text-zinc-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs uppercase text-cyan-200">当前选中模型</div>
              <div className="mt-1 text-base font-semibold text-white">{selectedModel.modelName}</div>
              <div className="mt-1 text-xs text-zinc-400">{selectedModel.provider} / {selectedModel.source}</div>
            </div>
            <div className="grid gap-1 text-xs text-zinc-400 md:text-right">
              <span>综合：{displayScore(selectedModel.overallScore)}</span>
              <span>价格：{selectedModel.priceNote || 'unknown'}</span>
              <span>最后检查：{formatDateTime(selectedModel.lastCheckedAt)}</span>
            </div>
          </div>
        </section>
      )}
      <details className="rounded-xl border border-white/10 bg-zinc-950 p-5">
        <summary className="cursor-pointer text-sm font-semibold text-white">来源健康与诊断</summary>
        {!loading && !error && data?.sourceStatuses?.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {data.sourceStatuses.map((source) => (
              <a key={source.sourceUrl} href={source.sourceUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-300 hover:border-blue-400/40">
                <div className="flex items-center justify-between"><span className="font-medium text-white">{source.source}</span><span className={source.ok ? 'text-emerald-300' : 'text-amber-300'}>{source.ok ? '可用' : '不可用'}</span></div>
                <div className="mt-2 flex gap-3 text-xs text-zinc-500"><span>模型 {source.itemCount || 0}</span><span>指标 {source.parsedMetricCount || 0}</span><span>HTTP {source.statusCode || 'n/a'}</span></div>
                <p className="mt-2 text-xs leading-5 text-zinc-500">{source.message || '暂无状态'}</p>
              </a>
            ))}
          </div>
        ) : null}
      </details>
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-5">
        <h3 className="font-semibold text-white">综合详情表</h3>
        <p className="mt-1 text-xs text-zinc-500">每类只展示最高分模型；没有可靠数据时显示暂无可靠数据。</p>
        <div className="mt-4 grid grid-cols-[1fr_.9fr_.9fr_1fr_1.5fr_.8fr] gap-3 border-b border-white/10 pb-3 text-xs text-zinc-500">
          <span>模型名称</span><span>供应商</span><span>模型类型</span><span>价格说明</span><span>对 JIYING 的影响</span><span>最后检查</span>
        </div>
        {topModelsByCategory.map(({ category, label, item }) => item ? (
          <button
            key={category}
            type="button"
            onClick={() => setSelectedModel(item)}
            className={`grid w-full grid-cols-[1fr_.9fr_.9fr_1fr_1.5fr_.8fr] gap-3 border-b border-white/5 px-0 py-4 text-left text-sm last:border-b-0 ${selectedModel && selectedModel.modelName === item.modelName && selectedModel.provider === item.provider ? 'bg-cyan-500/5 text-cyan-50' : 'text-zinc-300'}`}
          >
            <span className="font-medium text-white">{item.modelName}</span>
            <span>{item.provider}</span>
            <span>{label}</span>
            <span>{item.priceNote || 'unknown'}</span>
            <span className="leading-6 text-zinc-400">{item.impact || '暂无可验证影响说明'}</span>
            <span>{formatDateTime(item.lastCheckedAt)}</span>
          </button>
        ) : (
          <div key={category} className="grid grid-cols-[1fr_.9fr_.9fr_1fr_1.5fr_.8fr] gap-3 border-b border-white/5 px-0 py-4 text-sm text-zinc-500 last:border-b-0">
            <span>暂无可靠数据</span><span>unknown</span><span>{label}</span><span>unknown</span><span>来源未提供可验证数据，不硬凑代表模型。</span><span>暂无</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function NewsPage() {
  const { role } = useAuth();
  const [activeTab, setActiveTab] = useState<'broadcast' | 'arena'>('broadcast');
  const [selectedDateIndex, setSelectedDateIndex] = useState(0);
  const [dateSelectionTouched, setDateSelectionTouched] = useState(false);
  const [targetNews, setTargetNews] = useState<{ date?: string | null; itemId?: string | null; title?: string | null; consumed: boolean }>(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      date: params.get('date'),
      itemId: params.get('itemId'),
      title: params.get('title'),
      consumed: false
    };
  });
  const [refreshState, setRefreshState] = useState<RefreshState>({ loading: false, message: null, error: null });
  const [postScheduleRefetchDate, setPostScheduleRefetchDate] = useState<string | null>(null);
  const broadcastQuery = useQuery({
    queryKey: ['news-broadcast'],
    queryFn: () => fetchJson<BroadcastResponse>('/api/news/broadcast'),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true
  });
  const [postArenaScheduleRefetchDate, setPostArenaScheduleRefetchDate] = useState<string | null>(null);
  const arenaQuery = useQuery({
    queryKey: ['news-arena'],
    queryFn: () => fetchJson<ArenaResponse>('/api/news/arena'),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true
  });
  const canRefresh = role === 'ADMIN' || role === 'DEVELOPER';
  const selectedDate = broadcastQuery.data?.days?.[selectedDateIndex] || '';

  useEffect(() => {
    if (!broadcastQuery.data || broadcastQuery.isFetching || !hasPassedShanghaiRefreshTime()) return;
    const today = shanghaiDateKey();
    if (!today || postScheduleRefetchDate === today) return;
    const stats = broadcastQuery.data.stats;
    const refreshedToday = stats.scheduler?.lastSuccessfulDateGroup
      ? stats.scheduler.lastSuccessfulDateGroup === today
      : shanghaiDateKey(stats.lastSuccessfulUpdateAt) === today ||
        ((stats.status === 'ok' || stats.status === 'empty') && shanghaiDateKey(stats.updatedAt) === today);
    if (refreshedToday) {
      setPostScheduleRefetchDate(today);
      return;
    }
    setPostScheduleRefetchDate(today);
    broadcastQuery.refetch();
  }, [broadcastQuery.data, broadcastQuery.isFetching, broadcastQuery.refetch, postScheduleRefetchDate]);

  useEffect(() => {
    if (activeTab !== 'arena' || !arenaQuery.data || arenaQuery.isFetching || !hasPassedShanghaiRefreshTime()) return;
    const today = shanghaiDateKey();
    if (!today || postArenaScheduleRefetchDate === today) return;
    const refreshedToday = arenaQuery.data.scheduler?.lastSuccessDateGroup
      ? arenaQuery.data.scheduler.lastSuccessDateGroup === today
      : shanghaiDateKey(arenaQuery.data.scheduler?.lastSuccessAt || arenaQuery.data.updatedAt) === today;
    if (refreshedToday) {
      setPostArenaScheduleRefetchDate(today);
      return;
    }
    setPostArenaScheduleRefetchDate(today);
    arenaQuery.refetch();
  }, [activeTab, arenaQuery.data, arenaQuery.isFetching, arenaQuery.refetch, postArenaScheduleRefetchDate]);

  useEffect(() => {
    if (activeTab !== 'arena') return;
    const handleFocus = () => arenaQuery.refetch();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [activeTab, arenaQuery.refetch]);

  useEffect(() => {
    const groups = broadcastQuery.data?.groups || [];
    if (!dateSelectionTouched && targetNews.date && groups.length > 0) {
      const targetIndex = groups.findIndex((group) => group.dateGroup === targetNews.date);
      if (targetIndex >= 0) {
        setActiveTab('broadcast');
        setSelectedDateIndex(targetIndex);
        setDateSelectionTouched(true);
        return;
      }
    }
    if (dateSelectionTouched || groups.length === 0) return;
    const firstDateWithItems = groups.findIndex((group) => group.items.length > 0);
    setSelectedDateIndex(firstDateWithItems >= 0 ? firstDateWithItems : 0);
  }, [broadcastQuery.data, dateSelectionTouched, targetNews.date]);

  useEffect(() => {
    if (targetNews.consumed || !broadcastQuery.data || activeTab !== 'broadcast') return;
    const selectedDay = broadcastQuery.data.days?.[selectedDateIndex] || '';
    if (targetNews.date && selectedDay !== targetNews.date) return;
    const items = broadcastQuery.data.groups?.find((group) => group.dateGroup === selectedDay)?.items || [];
    const matched = items.find((item) => item.id && item.id === targetNews.itemId) || items.find((item) => targetNews.title && item.title === targetNews.title) || items[0];
    if (!matched) return;
    requestAnimationFrame(() => {
      const element = (matched.id && document.getElementById(`news-item-${matched.id}`)) || document.querySelector(`[data-news-title="${CSS.escape(matched.title)}"]`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTargetNews((value) => ({ ...value, itemId: matched.id || value.itemId, title: matched.title || value.title, consumed: true }));
    });
  }, [activeTab, broadcastQuery.data, selectedDateIndex, targetNews]);

  const handleSelectedDateIndexChange: React.Dispatch<React.SetStateAction<number>> = (nextValue) => {
    setDateSelectionTouched(true);
    setSelectedDateIndex(nextValue);
  };

  const refreshCurrentTab = async () => {
    setRefreshState({ loading: true, message: null, error: null });
    try {
      if (activeTab === 'broadcast') {
        const data = await postJson<{ success: boolean; result: BroadcastResponse['stats'] }>('/industry/news/refresh', { date: selectedDate });
        await broadcastQuery.refetch();
        const schedulerStatus = data.result?.scheduler?.lastScheduledStatus;
        const message = schedulerStatus === 'running'
          ? '已有新闻刷新任务正在运行，请稍后查看调度状态。'
          : schedulerStatus === 'skipped'
            ? data.result.scheduler?.lastScheduledMessage || `已跳过 ${selectedDate} 的重复刷新。`
            : data.result?.status === 'failed'
              ? data.result.message || '刷新失败，当前使用上次可信数据。'
              : data.result?.fetchedCount > 0
                ? `已刷新 ${selectedDate}，新增或更新 ${data.result.fetchedCount} 条可信新闻。`
                : `已检查 ${selectedDate}，暂无新的可信新闻。`;
        setRefreshState({
          loading: false,
          message: data.result?.status === 'failed' ? null : message,
          error: data.result?.status === 'failed' ? message : null
        });
      } else {
        const data = await postJson<{ success: boolean; snapshot: ArenaResponse }>('/industry/model-arena/refresh');
        await arenaQuery.refetch();
        const schedulerStatus = data.snapshot.scheduler?.lastStatus;
        const message = schedulerStatus === 'running'
          ? '模型竞技场自动刷新正在运行，请稍后查看调度状态。'
          : schedulerStatus === 'skipped'
            ? data.snapshot.scheduler?.lastMessage || '今日已完成模型竞技场刷新，已跳过重复任务。'
            : data.snapshot.status === 'failed'
              ? data.snapshot.message || '刷新失败，保留上一版可信快照。'
              : data.snapshot.items.length > 0
                ? `模型竞技场已刷新，当前可信模型 ${data.snapshot.items.length} 个。`
                : '来源可访问但暂无可解析模型数据。';
        setRefreshState({
          loading: false,
          message: data.snapshot.status === 'failed' ? null : message,
          error: data.snapshot.status === 'failed' ? message : null
        });
      }
    } catch (error: any) {
      setRefreshState({ loading: false, message: null, error: error?.message || '刷新失败。' });
    }
  };

  return (
    <div className="min-h-screen bg-[#050506] text-slate-200">
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-28">
        <header className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-cyan-300"><Activity className="h-4 w-4" /> JIYING Intelligence</div>
            <h1 className="text-4xl font-bold tracking-tight text-white">行业资讯</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">后端维护可信来源、滚动缓存与模型竞技场快照，前端只展示已校验数据。</p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="inline-flex rounded-lg border border-white/10 bg-zinc-950 p-1">
              <button type="button" onClick={() => { setActiveTab('broadcast'); setRefreshState({ loading: false, message: null, error: null }); }} className={`rounded-md px-5 py-2 text-sm transition-colors ${activeTab === 'broadcast' ? 'bg-cyan-500/15 text-cyan-200' : 'text-zinc-500 hover:text-white'}`}>新闻播报</button>
              <button type="button" onClick={() => { setActiveTab('arena'); setRefreshState({ loading: false, message: null, error: null }); }} className={`rounded-md px-5 py-2 text-sm transition-colors ${activeTab === 'arena' ? 'bg-blue-500/15 text-blue-200' : 'text-zinc-500 hover:text-white'}`}>模型竞技场</button>
            </div>
            <RefreshButton activeTab={activeTab} canRefresh={canRefresh} selectedDate={selectedDate} state={refreshState} onRefresh={refreshCurrentTab} />
          </div>
        </header>
        {activeTab === 'broadcast'
          ? <BroadcastTab data={broadcastQuery.data} loading={broadcastQuery.isLoading} selectedDateIndex={selectedDateIndex} setSelectedDateIndex={handleSelectedDateIndexChange} highlightedItemKey={targetNews.itemId || targetNews.title || null} />
          : <ArenaTab data={arenaQuery.data} loading={arenaQuery.isLoading} error={arenaQuery.isError} />}
      </div>
    </div>
  );
}
