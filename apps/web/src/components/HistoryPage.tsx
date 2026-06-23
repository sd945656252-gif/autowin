import { useMemo, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Loader2, Music, RefreshCw, Trash2, Video } from 'lucide-react';
import { clearPromptHistory, deletePromptHistoryItem, fetchPromptHistory } from '../lib/db';
import { useAuth } from './AuthContext';
import { EmptyState, InlineStatus, PageNotice, PermissionHint } from './ui/State';
import type { HistoryItem } from '../types';

function formatTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function typeLabel(item: HistoryItem) {
  const raw = (item.outputType || item.featureMode || '').toLowerCase();
  if (raw.includes('image')) return '图片';
  if (raw.includes('video')) return '视频';
  if (raw.includes('script')) return '剧本';
  if (raw.includes('music')) return '音乐';
  if (raw.includes('reverse')) return '反推';
  return '文字';
}

function TypeIcon({ item }: { item: HistoryItem }) {
  const label = typeLabel(item);
  if (label === '图片') return <ImageIcon className="h-4 w-4" />;
  if (label === '视频') return <Video className="h-4 w-4" />;
  if (label === '音乐') return <Music className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'history';
}

type HistoryNotice = { tone: 'success' | 'error'; text: string } | null;

export default function HistoryPage() {
  const { user, history, setHistory, isHistoryLoaded } = useAuth();
  const historyItems = Array.isArray(history) ? history : [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<HistoryNotice>(null);
  const [clearConfirm, setClearConfirm] = useState(false);

  const grouped = useMemo(() => {
    const items = [...historyItems].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items.reduce<Record<string, HistoryItem[]>>((record, item) => {
      const key = new Date(item.timestamp).toLocaleDateString('zh-CN');
      record[key] = record[key] || [];
      record[key].push(item);
      return record;
    }, {});
  }, [historyItems]);

  async function refresh() {
    if (!user) return;
    setBusyId('refresh');
    setMessage(null);
    try {
      const items = await fetchPromptHistory(user.uid);
      setHistory(items);
      setMessage({ tone: 'success', text: '历史记录已刷新。' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '历史记录刷新失败。' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: HistoryItem) {
    setBusyId(item.id);
    setMessage(null);
    try {
      await deletePromptHistoryItem(item.id);
      setHistory((prev) => prev.filter((entry) => entry.id !== item.id));
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '删除历史记录失败。' });
    } finally {
      setBusyId(null);
    }
  }

  function downloadItem(item: HistoryItem) {
    const payload = {
      id: item.id,
      timestamp: item.timestamp,
      type: typeLabel(item),
      projectId: item.projectId || null,
      projectTitle: item.projectTitle || null,
      featureMode: item.featureMode,
      model: item.customModelAlias || item.model || null,
      input: item.input || '',
      output: item.output || '',
      attachments: item.attachments || [],
      metadata: item.metadata || {}
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date(item.timestamp).toISOString().slice(0, 10);
    link.href = url;
    link.download = `${date}-${safeFilename(item.projectTitle || item.featureMode || item.id)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function clearAll() {
    if (!user) return;
    if (!clearConfirm) {
      setClearConfirm(true);
      window.setTimeout(() => setClearConfirm(false), 3000);
      return;
    }
    setBusyId('clear');
    setMessage(null);
    try {
      await clearPromptHistory(user.uid);
      setHistory([]);
      setClearConfirm(false);
      setMessage({ tone: 'success', text: '历史记录已清空。' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '清空历史记录失败。' });
    } finally {
      setBusyId(null);
    }
  }

  if (!user) {
    return (
      <main className="flex-grow pt-24 pb-12 px-6 max-w-5xl mx-auto w-full">
        <PermissionHint title="请先登录后查看历史记录">
          登录后可查看当前账号近 30 天内从工作流生成的剧本、提示词、图片、视频等内容。
        </PermissionHint>
      </main>
    );
  }

  return (
    <main className="flex-grow pt-24 pb-12 px-6 max-w-6xl mx-auto w-full">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-cyan-400 uppercase tracking-widest">Account Output History</p>
          <h1 className="mt-2 text-3xl font-bold text-white">历史记录</h1>
          <p className="mt-2 text-sm text-zinc-400">记录当前账号近 30 天内产出的剧本、提示词、图片、视频等内容；超过 30 天的记录会自动清理。</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void refresh()} disabled={busyId === 'refresh'} className="inline-flex h-9 items-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-50">
            {busyId === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </button>
          <button type="button" onClick={() => void clearAll()} disabled={busyId === 'clear' || historyItems.length === 0} className="inline-flex h-9 items-center gap-2 rounded border border-red-400/30 bg-red-500/10 px-3 text-xs text-red-100 hover:bg-red-500/20 disabled:opacity-50">
            {busyId === 'clear' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {clearConfirm ? '确认清空' : '清空'}
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4">
          <PageNotice tone={message.tone}>{message.text}</PageNotice>
        </div>
      )}

      {!isHistoryLoaded ? (
        <div className="flex justify-center rounded border border-white/10 bg-white/[0.03] p-6">
          <InlineStatus loading tone="info">正在读取历史记录...</InlineStatus>
        </div>
      ) : historyItems.length === 0 ? (
        <EmptyState
          title="暂无历史记录"
          description="从 01-05 工作流生成内容后会记录在这里；系统保留当前账号近 30 天内的历史产出。"
        />
      ) : (
        <div className="space-y-5">
          {(Object.entries(grouped) as Array<[string, HistoryItem[]]>).map(([date, items]) => (
            <section key={date} className="rounded-lg border border-white/10 bg-white/[0.03]">
              <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">{date}</div>
              <div className="divide-y divide-white/10">
                {items.map((item) => (
                  <article key={item.id} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-100">
                          <TypeIcon item={item} />{typeLabel(item)}
                        </span>
                        {item.projectTitle && <span className="rounded border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-400">{item.projectTitle}</span>}
                        <span className="text-[11px] text-zinc-500">{formatTime(item.timestamp)}</span>
                        {item.customModelAlias && <span className="text-[11px] text-zinc-500">{item.customModelAlias}</span>}
                      </div>
                      {item.input && <div className="truncate text-xs text-zinc-500">输入：{item.input}</div>}
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/30 p-3 text-xs leading-5 text-zinc-200">{item.output}</pre>
                    </div>
                    <div className="flex items-start justify-end gap-2">
                      <button type="button" onClick={() => downloadItem(item)} className="inline-flex items-center gap-1.5 rounded border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-500/20">
                        <Download className="h-4 w-4" />
                        下载
                      </button>
                      <button type="button" onClick={() => void remove(item)} disabled={busyId === item.id} className="inline-flex items-center gap-1.5 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-100 hover:bg-red-500/20 disabled:opacity-50">
                        {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
