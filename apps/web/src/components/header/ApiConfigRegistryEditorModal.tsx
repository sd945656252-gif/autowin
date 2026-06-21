import { Edit3, Loader2, Save } from 'lucide-react';
import type { RegistryEntry } from './apiConfigParameterUtils';

type ApiConfigRegistryEditorModalProps = {
  open: boolean;
  canonicalModelId?: string | null;
  editingRegistryJson: string;
  registryData?: RegistryEntry[];
  registryEditError: string | null;
  registrySaveStatus: 'idle' | 'loading' | 'success' | 'error';
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onValidate: () => void;
};

export function ApiConfigRegistryEditorModal({
  open,
  canonicalModelId,
  editingRegistryJson,
  registryData,
  registryEditError,
  registrySaveStatus,
  onChange,
  onClose,
  onSave,
  onValidate
}: ApiConfigRegistryEditorModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5"
      style={{ width: '100vw', height: '100vh' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-lg border border-white/10 bg-[#07090f] shadow-2xl"
        style={{ width: '96vw', height: '92vh', maxWidth: 1600, minWidth: 960 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <span className="text-sm font-bold text-white">高级能力模板 JSON</span>
            <span className="ml-2 font-mono text-[10px] text-zinc-500">{canonicalModelId || '全部注册表'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onValidate}
              className="inline-flex items-center gap-1 rounded border border-cyan-400/30 bg-cyan-500/15 px-2 py-1 text-[10px] text-cyan-200 hover:bg-cyan-500/25"
            >
              <Edit3 className="h-3 w-3" />
              验证
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={registrySaveStatus === 'loading'}
              className="inline-flex items-center gap-1 rounded border border-emerald-400/30 bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              {registrySaveStatus === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {registrySaveStatus === 'loading' ? '保存中' : '确认保存'}
            </button>
            <button type="button" onClick={onClose} className="px-1 text-lg leading-none text-zinc-400 hover:text-white">×</button>
          </div>
        </div>
        {registryEditError && (
          <div
            className={`mx-4 mt-2 shrink-0 rounded border px-2 py-1.5 text-[10px] ${
              registrySaveStatus === 'success'
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                : registrySaveStatus === 'error'
                  ? 'border-rose-500/30 bg-rose-950/20 text-rose-200'
                  : 'border-amber-500/30 bg-amber-950/20 text-amber-200'
            }`}
          >
            {registryEditError}
          </div>
        )}
        <textarea
          value={editingRegistryJson || JSON.stringify(registryData || [], null, 2)}
          onChange={(event) => onChange(event.target.value)}
          className="m-4 min-h-0 flex-1 resize-none overflow-auto whitespace-pre rounded border border-white/10 bg-black/40 p-4 font-mono text-[11px] leading-5 text-zinc-200 outline-none focus:border-cyan-400/50"
          style={{ minHeight: 0, height: 'calc(92vh - 104px)' }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
