import { Activity, Loader2, Save } from 'lucide-react';

type DiagnosticResult = {
  success: boolean;
  message: string;
};

type ApiConfigActionsProps = {
  canTest: boolean;
  canDelete?: boolean;
  saving?: boolean;
  mode?: 'create' | 'edit';
  diagnosticChecking: boolean;
  diagnosticResult: DiagnosticResult | null;
  onTest: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
};

export function ApiConfigActions({
  canTest,
  canDelete = true,
  saving = false,
  mode = 'edit',
  diagnosticChecking,
  diagnosticResult,
  onTest,
  onDelete,
  onCancel,
  onSave
}: ApiConfigActionsProps) {
  return (
    <>
      <div className="border-t border-white/5 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500 font-bold tracking-widest font-mono uppercase">接口测试与连接验证</span>
          <button
            type="button"
            onClick={onTest}
            disabled={diagnosticChecking || !canTest}
            className="text-[9px] px-3 py-1 bg-cyan-950/50 hover:bg-cyan-900/40 border border-cyan-500/30 text-cyan-400 font-bold rounded cursor-pointer transition-all flex items-center gap-1 disabled:opacity-50 font-mono"
          >
            {diagnosticChecking ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                <span>正在建立连接...</span>
              </>
            ) : (
              <>
                <Activity className="w-3 h-3 text-cyan-400 animate-pulse" />
                <span>测试连接</span>
              </>
            )}
          </button>
        </div>

        {diagnosticResult && (
          <div className={`mt-2 p-2.5 rounded text-[10px] font-mono leading-relaxed border flex gap-1.5 items-start ${
            diagnosticResult.success
              ? 'bg-green-950/20 text-green-300 border-green-500/20'
              : 'bg-red-950/20 text-red-300 border-red-500/20'
          }`}
          >
            <span>{diagnosticResult.success ? 'OK' : 'ERR'}</span>
            <div className="flex-1">{diagnosticResult.message}</div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-4">
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-1.5 bg-red-950/20 hover:bg-red-900/30 border border-red-500/20 hover:border-red-500/50 text-red-400 text-xs rounded transition-all cursor-pointer"
          >
            删除该配置
          </button>
        ) : <span className="text-[10px] text-zinc-600">新建模式下不会影响已有配置</span>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-zinc-500 hover:text-white text-xs transition-colors cursor-pointer"
          >
            取消
          </button>

          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="px-5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs rounded shadow-lg shadow-cyan-600/20 flex items-center gap-1 cursor-pointer transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saving ? '保存中...' : mode === 'create' ? '创建模型' : '保存配置'}</span>
          </button>
        </div>
      </div>
    </>
  );
}
