import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, Lock, SearchX } from 'lucide-react';

type Tone = 'default' | 'info' | 'success' | 'warning' | 'error';

const toneClass: Record<Tone, string> = {
  default: 'border-white/10 bg-white/[0.03] text-zinc-300',
  info: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
  success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
  error: 'border-red-400/25 bg-red-500/10 text-red-100'
};

const iconClass: Record<Tone, string> = {
  default: 'text-zinc-500',
  info: 'text-cyan-300',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  error: 'text-red-300'
};

function defaultIcon(tone: Tone) {
  if (tone === 'success') return CheckCircle2;
  if (tone === 'warning' || tone === 'error') return AlertTriangle;
  if (tone === 'info') return Info;
  return SearchX;
}

export function PageNotice({
  tone = 'info',
  title,
  children,
  action
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const Icon = defaultIcon(tone);
  return (
    <div className={`rounded border px-4 py-3 text-sm ${toneClass[tone]}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass[tone]}`} />
        <div className="min-w-0 flex-1">
          {title && <div className="mb-1 font-semibold text-white">{title}</div>}
          <div className="leading-6">{children}</div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

export function InlineStatus({
  tone = 'default',
  loading = false,
  children
}: {
  tone?: Tone;
  loading?: boolean;
  children: ReactNode;
}) {
  const Icon = loading ? Loader2 : defaultIcon(tone);
  return (
    <div className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-xs ${toneClass[tone]}`}>
      <Icon className={`h-3.5 w-3.5 shrink-0 ${loading ? 'animate-spin' : ''} ${iconClass[tone]}`} />
      <span className="leading-5">{children}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  tone = 'default'
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: Tone;
}) {
  const Icon = defaultIcon(tone);
  return (
    <div className={`rounded border p-6 text-center ${toneClass[tone]}`}>
      <Icon className={`mx-auto mb-3 h-8 w-8 ${iconClass[tone]}`} />
      <div className="text-sm font-semibold text-white">{title}</div>
      {description && <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-zinc-400">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function PermissionHint({
  title = '当前权限不足',
  children,
  action
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 font-semibold text-white">{title}</div>
          <div className="leading-6">{children}</div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
