import { AlertCircle, Loader2, Search } from 'lucide-react';
import type { CustomApiConfig, OfficialCapabilityUrlProbe } from '../../types';
import { ApiConfigParameterSummary } from './ApiConfigParameterSummary';
import { ParameterTags } from './ParameterTags';
import type { ModelMetadata, ProbeStatus } from './apiConfigParameterUtils';

type Props = {
  config: CustomApiConfig;
  probeStatus: ProbeStatus;
  probeError: string | null;
  recognizedModel: string | null;
  officialUrl: string;
  onOfficialUrlChange: (value: string) => void;
  onRunOfficialProbe: () => void;
  officialProbePending: boolean;
  officialProbeError: string | null;
  officialProbe: OfficialCapabilityUrlProbe | null;
  metadata: ModelMetadata | undefined;
  executable: boolean;
  statusText: string;
  hasTrustedTemplate: boolean;
  maxImages: number;
};

export function ApiConfigCapabilityOverview({
  config,
  probeStatus,
  probeError,
  recognizedModel,
  officialUrl,
  onOfficialUrlChange,
  onRunOfficialProbe,
  officialProbePending,
  officialProbeError,
  officialProbe,
  metadata,
  executable,
  statusText,
  hasTrustedTemplate,
  maxImages
}: Props) {
  const effectiveProbeError = config.canonicalModelId ? null : probeError;

  return (
    <>
      <ApiConfigParameterSummary
        canonicalModelId={config.canonicalModelId}
        activeCapabilityRevisionId={config.activeCapabilityRevisionId || config.capabilityProfile?.activeRevisionId}
        executable={executable}
        statusText={statusText}
        hasTrustedTemplate={hasTrustedTemplate}
        showWarning={Boolean(config.capabilityProfile && !executable)}
      />

      <div className="mb-3 rounded-lg border border-white/10 bg-[#070910] p-3 font-mono text-[10px]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <span className="block font-bold uppercase text-zinc-200">自定义官方链接探测</span>
            <span className="text-zinc-500">阶段二：提取候选模型与参数线索，不自动标记为可执行</span>
          </div>
          <button
            type="button"
            disabled={!officialUrl.trim() || officialProbePending}
            onClick={onRunOfficialProbe}
            className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-black/30 px-2.5 py-1.5 text-[10px] font-bold text-zinc-200 hover:border-cyan-400/50 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {officialProbePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            爬取
          </button>
        </div>
        <input
          value={officialUrl}
          onChange={(event) => onOfficialUrlChange(event.target.value)}
          placeholder="https://platform.openai.com/docs/guides/image-generation"
          className="w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cyan-400/60"
        />
        {officialProbeError && <div className="mt-2 rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1.5 text-rose-300">{officialProbeError}</div>}
        {officialProbe && (
          <div className="mt-2 grid grid-cols-2 gap-2 rounded border border-white/10 bg-black/20 p-2 text-zinc-300">
            <div>
              <span className="block text-zinc-500">host</span>
              <span>{officialProbe.host}</span>
            </div>
            <div>
              <span className="block text-zinc-500">匹配当前模型</span>
              <span className={officialProbe.matchedCanonicalModel ? 'text-emerald-300' : 'text-amber-300'}>{officialProbe.matchedCanonicalModel ? 'YES' : 'NO'}</span>
            </div>
            {officialProbe.title && (
              <div className="col-span-2">
                <span className="block text-zinc-500">title</span>
                <span>{officialProbe.title}</span>
              </div>
            )}
            {officialProbe.candidate.modelHints.length > 0 && (
              <div className="col-span-2">
                <span className="mb-1 block text-zinc-500">model hints</span>
                <ParameterTags items={officialProbe.candidate.modelHints.slice(0, 12)} />
              </div>
            )}
            {(officialProbe.candidate.sizeHints.length > 0 || officialProbe.candidate.ratioHints.length > 0 || officialProbe.candidate.qualityHints.length > 0 || officialProbe.candidate.durationHints.length > 0) && (
              <div className="col-span-2 grid grid-cols-2 gap-2 border-t border-white/5 pt-2">
                {officialProbe.candidate.sizeHints.length > 0 && <ParameterTags items={officialProbe.candidate.sizeHints.slice(0, 10)} />}
                {officialProbe.candidate.ratioHints.length > 0 && <ParameterTags items={officialProbe.candidate.ratioHints.slice(0, 10)} />}
                {officialProbe.candidate.qualityHints.length > 0 && <ParameterTags items={officialProbe.candidate.qualityHints.slice(0, 10)} />}
                {officialProbe.candidate.durationHints.length > 0 && <ParameterTags items={officialProbe.candidate.durationHints.slice(0, 10).map((item) => `${item}s`)} />}
              </div>
            )}
            {officialProbe.structuredCandidate && (
              <div className="col-span-2 rounded border border-cyan-500/30 bg-cyan-950/20 px-2 py-1.5 text-cyan-100">
                <span className="block font-bold uppercase text-cyan-200">OpenAI MCP structured match</span>
                <span className="text-zinc-300">
                  {officialProbe.structuredCandidate.officialModelId} · 输入图 {officialProbe.structuredCandidate.limits?.maxInputImages} 张 · 官方输出上限 {officialProbe.structuredCandidate.limits?.maxOutputImages} 张 · 当前执行上限 {officialProbe.structuredCandidate.limits?.currentExecutionMaxOutputImages} 张
                </span>
              </div>
            )}
            <div className="col-span-2 rounded border border-amber-500/30 bg-amber-950/20 px-2 py-1.5 text-amber-200">
              {officialProbe.note}
            </div>
          </div>
        )}
      </div>

      {effectiveProbeError && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-[10px] font-mono text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{effectiveProbeError}</span>
        </div>
      )}

      {metadata ? (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#121624] bg-[#070910] p-4 font-mono text-[10px]">
          {config.type === 'image' && (
            <>
              {metadata.ratios && metadata.ratios.length > 0 && (
                <div className="col-span-2 border-b border-white/5 pb-2">
                  <span className="mb-1 block text-zinc-500">支持画幅比例 Aspect Ratios:</span>
                  <ParameterTags items={metadata.ratios} />
                </div>
              )}

              {metadata.resolutions && metadata.resolutions.length > 0 && (
                <div className="pb-1">
                  <span className="mb-1 block text-zinc-500">支持出图分辨率 Resolutions:</span>
                  <ParameterTags items={metadata.resolutions} />
                </div>
              )}

              {metadata.qualities && metadata.qualities.length > 0 && (
                <div className="pb-1">
                  <span className="mb-1 block text-zinc-500">支持画质精调 Qualities:</span>
                  <ParameterTags items={metadata.qualities} />
                </div>
              )}

              <div className="col-span-2 grid grid-cols-3 gap-2 border-t border-white/5 pt-2 text-[9px]">
                <div className="flex items-center gap-1.5 text-zinc-455">
                  <span>负向提示词 (Negative Prompt):</span>
                  <span className={`font-bold ${config.supportsNegativePrompt ? 'text-emerald-400' : 'text-[#888888]'}`}>{config.supportsNegativePrompt ? 'YES' : 'NO'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-zinc-455">
                  <span>比例自适应 (Adaptive Ratio):</span>
                  <span className={`font-bold ${config.supportsAspectRatio ? 'text-emerald-400' : 'text-[#888888]'}`}>{config.supportsAspectRatio ? 'YES' : 'NO'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-zinc-455">
                  <span>最多个数 (Max Images):</span>
                  <span className="font-bold text-cyan-400">{maxImages} 张</span>
                </div>
              </div>
            </>
          )}

          {config.type === 'video' && (
            <>
              <div className="col-span-2 border-b border-white/5 pb-2">
                <span className="mb-1 block text-zinc-500">物理渲染时长 bounds:</span>
                <div className="flex items-center gap-2">
                  <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-350">最短: {metadata.minDuration || 4}s</span>
                  <span className="text-zinc-650">to</span>
                  <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-350">最长: {metadata.maxDuration || 10}s</span>
                  <span className="text-zinc-650">|</span>
                  <span className="text-[9px] text-zinc-400">默认预设: {metadata.defaultDuration || 5}s</span>
                </div>
              </div>

              {metadata.ratios && metadata.ratios.length > 0 && (
                <div className="col-span-2 border-b border-white/5 pb-2">
                  <span className="mb-1 block text-zinc-500">支持视频画幅 ratios:</span>
                  <ParameterTags items={metadata.ratios} />
                </div>
              )}

              {metadata.resolutions && metadata.resolutions.length > 0 && (
                <div className="pb-1">
                  <span className="mb-1 block text-zinc-500">支持分辨率 resolutions:</span>
                  <ParameterTags items={metadata.resolutions} />
                </div>
              )}

              <div className="col-span-2 flex items-center justify-between border-t border-white/5 pt-2 text-[9px]">
                <div className="flex items-center gap-1.5 text-zinc-455">
                  <span>音乐/音效声轨合成 (Has Audio):</span>
                  <span className={`font-bold ${metadata.hasAudio !== false ? 'text-emerald-400' : 'text-zinc-600'}`}>{metadata.hasAudio !== false ? 'YES' : 'NO'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-zinc-455">
                  <span>镜头运镜调节 (Camera Control):</span>
                  <span className={`font-bold ${metadata.hasCameraControl !== false ? 'text-emerald-400' : 'text-zinc-600'}`}>{metadata.hasCameraControl !== false ? 'YES' : 'NO'}</span>
                </div>
              </div>
            </>
          )}

          {metadata.description && (
            <div className="col-span-2 mt-1.5 border-t border-white/5 pt-2 text-[9px] leading-normal text-zinc-400">
              <span className="mb-0.5 block font-bold uppercase text-zinc-400">模型描述 Description:</span>
              <p className="font-sans font-light italic">{metadata.description}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 bg-[#0a0c11] py-6 text-center font-mono text-[10px] leading-relaxed text-zinc-500">
          {probeStatus === 'probing' ? '正在发起连接探测官方参数，请稍候...' : '输入模型ID并在外部点击即可自动检测获取大模型的所有官方参数'}
        </div>
      )}

      {recognizedModel && (
        <div className="mt-2 text-[9px] text-emerald-500/80">已识别为 {recognizedModel} 模型，参数已自动配置</div>
      )}
    </>
  );
}
