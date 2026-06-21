import { BookOpen, ChevronDown, Loader2, Zap } from 'lucide-react';
import type { ProbeStatus, RegistryEntry } from './apiConfigParameterUtils';

type ApiConfigCapabilityToolbarProps = {
  canonicalModelId?: string | null;
  recognizedModel: string | null;
  executable: boolean;
  effectiveProbeStatus: ProbeStatus;
  showApplyMenu: boolean;
  filteredRegistryData: RegistryEntry[];
  applyStatus: 'idle' | 'loading' | 'success' | 'error';
  applyError: string | null;
  onOpenRegistry: () => void;
  onToggleApplyMenu: () => void;
  onApplyRegistry: (canonicalModelId: string) => void;
};

export function ApiConfigCapabilityToolbar({
  canonicalModelId,
  recognizedModel,
  executable,
  effectiveProbeStatus,
  showApplyMenu,
  filteredRegistryData,
  applyStatus,
  applyError,
  onOpenRegistry,
  onToggleApplyMenu,
  onApplyRegistry
}: ApiConfigCapabilityToolbarProps) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="block font-mono text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        模型能力清单 CAPABILITY PROFILE
      </span>
      <div className="flex items-center gap-2 font-mono text-[9px]">
        <button
          type="button"
          onClick={onOpenRegistry}
          className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-zinc-500 hover:border-cyan-400/40 hover:text-cyan-200"
          title="高级维护：查看或编辑当前生效的能力模板 JSON"
        >
          <BookOpen className="h-3 w-3" />
          <span>高级 JSON</span>
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={onToggleApplyMenu}
            className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-200"
            title="选择注册表模型参数并应用"
          >
            {applyStatus === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            <span>应用参数</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showApplyMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded border border-white/10 bg-[#0d0f18] shadow-xl">
              <div className="border-b border-white/5 px-2 py-1.5 font-mono text-[9px] text-zinc-500">选择注册表模型 → 同步参数</div>
              {filteredRegistryData.length === 0 && <div className="px-3 py-2 font-mono text-[10px] text-zinc-500">暂无当前能力类型模板</div>}
              {filteredRegistryData.map((entry) => (
                <button
                  key={entry.canonicalModelId}
                  type="button"
                  onClick={() => onApplyRegistry(entry.canonicalModelId)}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left font-mono text-[10px] text-zinc-200 hover:bg-white/5"
                >
                  <span className="font-semibold text-cyan-300">{entry.officialModelId}</span>
                  <span className="text-zinc-500">{entry.provider} · {entry.capability}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {applyStatus === 'success' && <span className="text-[9px] text-emerald-400">已应用 ✓</span>}
        {applyStatus === 'error' && <span className="text-[9px] text-rose-400" title={applyError || ''}>{applyError?.slice(0, 40)}</span>}
        {effectiveProbeStatus === 'probing' && <span className="flex items-center gap-1 text-cyan-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在监测官方可用参数...</span>}
        {effectiveProbeStatus === 'success' && executable && (
          <div className="flex flex-col items-end">
            <span className="font-semibold text-emerald-400">Official parameters ready</span>
            {recognizedModel && <span className="mt-0.5 text-[9px] text-emerald-500/80">已识别为 {recognizedModel} 模型，参数已自动配置</span>}
          </div>
        )}
        {effectiveProbeStatus === 'success' && !executable && <span className="font-semibold text-amber-300">已识别，等待官方验证</span>}
        {effectiveProbeStatus === 'failed' && <span className="font-semibold text-rose-400">监测失败</span>}
        {effectiveProbeStatus === 'idle' && !canonicalModelId && <span className="text-zinc-500">等待输入模型ID</span>}
      </div>
    </div>
  );
}
