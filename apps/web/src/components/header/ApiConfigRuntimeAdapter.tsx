import { Save } from 'lucide-react';
import type { CustomApiConfig } from '../../types';
import type { RuntimeEditorState } from './apiConfigParameterUtils';

type ApiConfigRuntimeAdapterProps = {
  configType: CustomApiConfig['type'];
  runtimeEditor: RuntimeEditorState;
  runtimeSaveStatus: 'idle' | 'loading' | 'success' | 'error';
  runtimeSaveError: string | null;
  onRuntimeEditorChange: (field: keyof RuntimeEditorState, value: string) => void;
  onSave: () => void;
};

export function ApiConfigRuntimeAdapter({
  configType,
  runtimeEditor,
  runtimeSaveStatus,
  runtimeSaveError,
  onRuntimeEditorChange,
  onSave
}: ApiConfigRuntimeAdapterProps) {
  return (
    <div className="mt-3 rounded-lg border border-cyan-500/15 bg-cyan-950/10 p-3 font-mono text-[10px]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-bold uppercase text-cyan-200">运行时适配 Runtime Adapter</span>
        <button
          type="button"
          onClick={onSave}
          disabled={runtimeSaveStatus === 'loading'}
          className="inline-flex items-center gap-1 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          <Save className="h-3 w-3" />
          <span>{runtimeSaveStatus === 'loading' ? '保存中' : '保存运行配置'}</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none" value={runtimeEditor.modelOverride} onChange={(event) => onRuntimeEditorChange('modelOverride', event.target.value)} placeholder="modelOverride, official model id" />
        <input className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none" value={runtimeEditor.endpoint} onChange={(event) => onRuntimeEditorChange('endpoint', event.target.value)} placeholder="endpoint" />
        <input className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none" value={runtimeEditor.responsePaths} onChange={(event) => onRuntimeEditorChange('responsePaths', event.target.value)} placeholder="responsePaths, comma separated" />
        {configType !== 'text' && (
          <input className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none" value={runtimeEditor.taskIdPaths} onChange={(event) => onRuntimeEditorChange('taskIdPaths', event.target.value)} placeholder="taskIdPaths, comma separated" />
        )}
        {configType === 'video' && (
          <>
            <input className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none" value={runtimeEditor.pollEndpoint} onChange={(event) => onRuntimeEditorChange('pollEndpoint', event.target.value)} placeholder="pollEndpoint" />
            <input className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none" value={runtimeEditor.pollResultPaths} onChange={(event) => onRuntimeEditorChange('pollResultPaths', event.target.value)} placeholder="pollResultPaths" />
            <input className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none" value={runtimeEditor.pollStatusPaths} onChange={(event) => onRuntimeEditorChange('pollStatusPaths', event.target.value)} placeholder="pollStatusPaths" />
            <input className="rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-zinc-200 outline-none" value={runtimeEditor.failedStatuses} onChange={(event) => onRuntimeEditorChange('failedStatuses', event.target.value)} placeholder="failedStatuses" />
          </>
        )}
      </div>
      {runtimeSaveError && <div className="mt-2 text-rose-300">{runtimeSaveError}</div>}
      {runtimeSaveStatus === 'success' && <div className="mt-2 text-emerald-300">已写入能力版本</div>}
    </div>
  );
}
