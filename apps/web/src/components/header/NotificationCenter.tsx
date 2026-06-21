import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCircle2, Download, Eye, FileText, Image, Paperclip, Trash2, Video, Volume2, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { AppNotification, AppNotificationAttachment, NotificationCategory } from '../../types';

type NotificationCenterProps = {
  enabled: boolean;
};

const FILTERS: Array<{ key: NotificationCategory | 'ALL'; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'NOTICE', label: '通知' },
  { key: 'BROADCAST', label: '播报' },
  { key: 'ANNOUNCEMENT', label: '公告' }
];

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function fileSizeLabel(value?: number | null) {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentIcon(mimeType?: string | null) {
  if (mimeType?.startsWith('image/')) return <Image className="h-3.5 w-3.5" />;
  if (mimeType?.startsWith('video/')) return <Video className="h-3.5 w-3.5" />;
  if (mimeType?.startsWith('audio/')) return <Volume2 className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
}

function canPreview(attachment: AppNotificationAttachment) {
  const mime = attachment.mimeType || '';
  return mime.startsWith('image/')
    || mime.startsWith('video/')
    || mime.startsWith('audio/')
    || mime === 'application/pdf'
    || mime.startsWith('text/');
}

function categoryClass(category: NotificationCategory) {
  if (category === 'ANNOUNCEMENT') return 'border-amber-400/30 bg-amber-400/10 text-amber-200';
  if (category === 'BROADCAST') return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200';
  return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
}

export function NotificationCenter({ enabled }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationCategory | 'ALL'>('ALL');
  const [items, setItems] = useState<AppNotification[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AppNotificationAttachment | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toastItem, setToastItem] = useState<AppNotification | null>(null);
  const seenUnreadIdsRef = useRef<Set<string> | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const activeItem = useMemo(() => items.find((item) => item.id === activeId) || items[0] || null, [activeId, items]);

  const loadUnreadCount = async () => {
    if (!enabled) return;
    const data = await apiFetch<{ count: number }>('/api/notifications/unread-count');
    setUnreadCount(data.count || 0);
  };

  const loadNotifications = async (nextFilter = filter) => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ notifications: AppNotification[] }>('/api/notifications', {
        query: nextFilter === 'ALL' ? {} : { category: nextFilter }
      });
      setItems(data.notifications || []);
      setActiveId((current) => {
        if (current && data.notifications?.some((item) => item.id === current)) return current;
        return data.notifications?.[0]?.id || null;
      });
      await loadUnreadCount();
    } catch (err: any) {
      setError(err.message || '消息读取失败。');
    } finally {
      setLoading(false);
    }
  };

  const pollIncomingNotifications = async () => {
    if (!enabled) return;
    const data = await apiFetch<{ notifications: AppNotification[] }>('/api/notifications', {
      query: { unread: 'true' }
    });
    const notifications = data.notifications || [];
    const nextIds = new Set(notifications.map((item) => item.id));
    if (!seenUnreadIdsRef.current) {
      seenUnreadIdsRef.current = nextIds;
      setUnreadCount(nextIds.size);
      return;
    }

    const incoming = notifications.find((item) => !seenUnreadIdsRef.current?.has(item.id));
    seenUnreadIdsRef.current = nextIds;
    setUnreadCount(nextIds.size);
    if (incoming) {
      setToastItem(incoming);
      if (open) void loadNotifications(filter);
    }
  };

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      setItems([]);
      setUnreadCount(0);
      setToastItem(null);
      seenUnreadIdsRef.current = null;
      return;
    }
    void pollIncomingNotifications().catch(() => undefined);
    const timer = window.setInterval(() => {
      void pollIncomingNotifications().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    if (open) void loadNotifications(filter);
  }, [open, filter]);

  useEffect(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    if (!toastItem) return undefined;
    toastTimerRef.current = window.setTimeout(() => setToastItem(null), 8000);
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [toastItem]);

  const openItem = async (item: AppNotification) => {
    setActiveId(item.id);
    setPreviewAttachment(null);
    if (item.readAt) return;
    try {
      const data = await apiFetch<{ notification: AppNotification }>(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: 'POST' });
      setItems((current) => current.map((entry) => entry.id === item.id ? data.notification : entry));
      await loadUnreadCount();
    } catch (err: any) {
      setError(err.message || '已读状态更新失败。');
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.id !== id));
      seenUnreadIdsRef.current?.delete(id);
      setActiveId((current) => current === id ? null : current);
      setPreviewAttachment(null);
      await loadUnreadCount();
    } catch (err: any) {
      setError(err.message || '消息删除失败。');
    }
  };

  if (!enabled) return null;

  return (
    <div className="relative">
      {toastItem && (
        <div className="fixed right-4 top-16 z-[120] w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-cyan-400/30 bg-[#071018]/95 shadow-[0_16px_45px_rgba(0,0,0,0.65)] backdrop-blur">
          <div className="flex items-start gap-3 p-3">
            <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${categoryClass(toastItem.category)}`}>{toastItem.categoryLabel}</span>
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                void openItem(toastItem);
                setToastItem(null);
              }}
              className="min-w-0 flex-1 text-left"
            >
              <p className="truncate text-sm font-semibold text-white">{toastItem.title}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-300">{toastItem.content}</p>
              <p className="mt-2 text-[10px] text-zinc-500">{toastItem.projectName || '全站'} · {formatDate(toastItem.createdAt)}</p>
            </button>
            <button type="button" onClick={() => setToastItem(null)} className="shrink-0 p-1 text-zinc-500 hover:text-white" title="关闭弹窗">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-8 w-8 items-center justify-center rounded-sm border border-cyan-500/25 bg-cyan-950/20 text-cyan-300 hover:border-cyan-400 hover:text-white active:scale-95 transition"
        title="消息通知"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-[100] flex h-[560px] w-[780px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-cyan-500/25 bg-[#07090d]/98 shadow-[0_12px_45px_rgba(0,0,0,0.75)]">
            <div className="flex w-[310px] shrink-0 flex-col border-r border-cyan-950/70">
              <div className="flex h-12 items-center justify-between border-b border-cyan-950/70 px-3">
                <div>
                  <p className="text-xs font-bold text-white">消息通知</p>
                  <p className="text-[10px] text-cyan-600">{unreadCount > 0 ? `${unreadCount} 条未读` : '暂无未读'}</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="p-1 text-cyan-600 hover:text-cyan-300" title="关闭">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex gap-1 border-b border-cyan-950/70 px-2 py-2">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={`h-7 flex-1 rounded border text-[11px] transition ${filter === item.key ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100' : 'border-cyan-950/60 bg-black/20 text-cyan-600 hover:text-cyan-300'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading && <div className="px-3 py-6 text-center text-xs text-cyan-500">正在读取消息...</div>}
                {!loading && error && <div className="m-3 rounded border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-200">{error}</div>}
                {!loading && !error && items.length === 0 && <div className="px-3 py-8 text-center text-xs text-zinc-500">当前没有消息</div>}
                {!loading && items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openItem(item)}
                    className={`block w-full border-b border-cyan-950/50 px-3 py-3 text-left transition ${activeItem?.id === item.id ? 'bg-cyan-950/25' : 'hover:bg-cyan-950/15'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${categoryClass(item.category)}`}>{item.categoryLabel}</span>
                      <span className="text-[10px] text-zinc-500">{formatDate(item.createdAt)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {!item.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />}
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">{item.title}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-zinc-500">{item.content}</p>
                    {item.attachments.length > 0 && (
                      <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-cyan-500">
                        <Paperclip className="h-3 w-3" />{item.attachments.length} 个附件
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-0 flex flex-1 flex-col">
              {activeItem ? (
                <>
                  <div className="border-b border-cyan-950/70 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] ${categoryClass(activeItem.category)}`}>{activeItem.categoryLabel}</span>
                          {activeItem.readAt && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                        </div>
                        <h3 className="mt-2 truncate text-base font-semibold text-white">{activeItem.title}</h3>
                        <p className="mt-1 text-[11px] text-zinc-500">
                          {activeItem.projectName || '全站'} · {activeItem.sender?.displayName || activeItem.sender?.email || '系统'} · {formatDate(activeItem.createdAt)}
                        </p>
                      </div>
                      <button type="button" onClick={() => void deleteItem(activeItem.id)} className="shrink-0 p-1.5 text-red-400 hover:text-red-300" title="删除消息">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">{activeItem.content}</p>

                    {activeItem.attachments.length > 0 && (
                      <div className="mt-5 border-t border-cyan-950/70 pt-4">
                        <p className="mb-2 text-xs font-semibold text-cyan-300">附件</p>
                        <div className="space-y-2">
                          {activeItem.attachments.map((attachment) => (
                            <div key={attachment.id} className="flex items-center gap-3 rounded border border-cyan-950/60 bg-black/20 px-3 py-2">
                              <span className="text-cyan-400">{attachmentIcon(attachment.mimeType)}</span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs text-zinc-100">{attachment.displayName}</p>
                                <p className="text-[10px] text-zinc-600">{attachment.mimeType || 'application/octet-stream'} {fileSizeLabel(attachment.sizeBytes)}</p>
                              </div>
                              {canPreview(attachment) && (
                                <button type="button" onClick={() => setPreviewAttachment(attachment)} className="p-1.5 text-cyan-400 hover:text-cyan-200" title="预览附件">
                                  <Eye className="h-4 w-4" />
                                </button>
                              )}
                              <a href={attachment.downloadUrl} className="p-1.5 text-cyan-400 hover:text-cyan-200" title="下载附件">
                                <Download className="h-4 w-4" />
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {previewAttachment && (
                      <div className="mt-5 overflow-hidden rounded border border-cyan-500/25 bg-black/30">
                        <div className="flex items-center justify-between border-b border-cyan-950/70 px-3 py-2">
                          <p className="truncate text-xs text-cyan-200">{previewAttachment.displayName}</p>
                          <button type="button" onClick={() => setPreviewAttachment(null)} className="p-1 text-cyan-600 hover:text-cyan-300" title="关闭预览">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {previewAttachment.mimeType?.startsWith('image/') ? (
                          <img src={previewAttachment.previewUrl} alt={previewAttachment.displayName} className="max-h-80 w-full object-contain" />
                        ) : previewAttachment.mimeType?.startsWith('video/') ? (
                          <video src={previewAttachment.previewUrl} controls className="max-h-80 w-full bg-black" />
                        ) : previewAttachment.mimeType?.startsWith('audio/') ? (
                          <div className="p-4"><audio src={previewAttachment.previewUrl} controls className="w-full" /></div>
                        ) : (
                          <iframe src={previewAttachment.previewUrl} title={previewAttachment.displayName} className="h-80 w-full bg-white" />
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-zinc-500">选择一条消息查看详情</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
