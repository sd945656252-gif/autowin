import type { ChangeEvent, ReactNode } from 'react';
import { Loader2, Paperclip, Send } from 'lucide-react';
import { AttachmentList } from './MessageComposerShared';

type MessageComposerFrameProps = {
  title: string;
  subtitle: string;
  sendLabel: string;
  submitTone?: 'amber' | 'cyan';
  busy?: boolean;
  status?: string;
  error?: string;
  files: File[];
  onRemoveFile: (index: number) => void;
  onAttach: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  children: ReactNode;
};

export function MessageComposerFrame({
  title,
  subtitle,
  sendLabel,
  submitTone = 'amber',
  busy,
  status,
  error,
  files,
  onRemoveFile,
  onAttach,
  onSubmit,
  children
}: MessageComposerFrameProps) {
  const submitButtonClassName = submitTone === 'cyan'
    ? 'inline-flex items-center gap-2 rounded border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-xs text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50'
    : 'inline-flex items-center gap-2 rounded border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100 hover:bg-amber-500/20 disabled:opacity-50';

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
        </div>
      </div>

      {children}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-white/10 bg-black/30 px-3 py-2 text-xs text-cyan-200 hover:bg-white/5">
          <Paperclip className="h-4 w-4" />
          添加附件
          <input
            type="file"
            multiple
            className="hidden"
            onChange={onAttach}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={onSubmit}
          className={submitButtonClassName}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sendLabel}
        </button>
      </div>

      <AttachmentList files={files} onRemove={onRemoveFile} />
      {error && <div className="mt-3 rounded border border-red-500/30 bg-red-950/20 p-2 text-xs text-red-200">{error}</div>}
      {status && <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-950/20 p-2 text-xs text-emerald-200">{status}</div>}
    </div>
  );
}
