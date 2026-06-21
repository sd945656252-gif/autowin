type ApiConfigParameterSummaryProps = {
  canonicalModelId?: string | null;
  activeCapabilityRevisionId?: string | null;
  executable: boolean;
  statusText: string;
  hasTrustedTemplate: boolean;
  showWarning: boolean;
};

export function ApiConfigParameterSummary({
  canonicalModelId,
  activeCapabilityRevisionId,
  executable,
  statusText,
  hasTrustedTemplate,
  showWarning
}: ApiConfigParameterSummaryProps) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-[10px] font-mono text-zinc-300">
      <div>
        <span className="block text-zinc-500">canonicalModelId</span>
        <span className="break-all text-cyan-300">{canonicalModelId || '未绑定'}</span>
      </div>
      <div>
        <span className="block text-zinc-500">能力验证状态</span>
        <span className={executable ? 'text-emerald-400' : 'text-amber-300'}>{statusText}</span>
      </div>
      <div>
        <span className="block text-zinc-500">可信模板</span>
        <span className={hasTrustedTemplate ? 'text-cyan-300' : 'text-zinc-500'}>
          {hasTrustedTemplate ? '已加载' : '未加载'}
        </span>
      </div>
      <div>
        <span className="block text-zinc-500">active revision</span>
        <span>{activeCapabilityRevisionId || '无'}</span>
      </div>
      <div>
        <span className="block text-zinc-500">执行状态</span>
        <span className={executable ? 'text-emerald-400' : 'text-amber-300'}>
          {executable ? '允许执行' : '未验证，禁止执行'}
        </span>
      </div>
      {showWarning && (
        <div className="col-span-2 rounded border border-amber-500/30 bg-amber-950/20 px-2 py-1.5 text-amber-200">
          未找到可核验的官方参数来源。为避免虚构参数，本模型暂不允许执行生成任务。
        </div>
      )}
    </div>
  );
}
