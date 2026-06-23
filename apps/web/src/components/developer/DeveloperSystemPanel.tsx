import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Database, Loader2, RefreshCw } from 'lucide-react';

type DeveloperWorkflowRun = {
  id: string;
  status?: string;
  error?: string | null;
  createdAt?: string;
  inputJson?: Record<string, any> | null;
  workflow?: { name?: string | null } | null;
};

type DeveloperAuditEvent = {
  id: string;
  entityType?: string | null;
  action?: string | null;
};

type DeveloperSystemState = {
  health: {
    service?: { status?: string; uptimeSeconds?: number };
    database?: { status?: string };
    redis?: { status?: string; response?: string };
    showcaseTranscode?: { status?: string; enabled?: boolean };
    version?: string;
    environment?: string;
  };
  runs: { runs?: DeveloperWorkflowRun[] };
  queue: { queue?: unknown };
  errors: {
    failedRuns?: DeveloperWorkflowRun[];
    auditEvents?: DeveloperAuditEvent[];
  };
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `Request failed: ${response.status}`);
  return data as T;
}

function workflowNodeLabel(type?: string) {
  const labels: Record<string, string> = {
    image_generator: '图像生成节点',
    video_generator: '视频生成节点'
  };
  return labels[type || ''] || type || '未知节点';
}

function workflowRunTitle(run: DeveloperWorkflowRun) {
  const input = run?.inputJson || {};
  if (input.node_id === 'security-inline-key-test') return '安全测试：拒绝前端内联 API Key';
  if (run?.workflow?.name) return run.workflow.name;
  return workflowNodeLabel(String(input.node_type || ''));
}

function workflowRunDetail(run: DeveloperWorkflowRun) {
  const input = run?.inputJson || {};
  const parts = [
    input.prompt ? `提示词：${String(input.prompt).slice(0, 80)}` : '',
    input.custom_config_id || input.selected_api_id ? `模型配置：${input.custom_config_id || input.selected_api_id}` : '',
    input.custom_model ? `模型：${input.custom_model}` : '',
    input.workflow_id ? `工作流：${input.workflow_id}` : ''
  ].filter(Boolean);
  return parts.join(' / ') || `创建于 ${run.createdAt ? new Date(run.createdAt).toLocaleString() : '未知'}`;
}

function workflowRunReason(run: DeveloperWorkflowRun) {
  if (!run?.error) return '';
  if (String(run.error).includes('Inline custom API keys are disabled')) {
    return '后端已拒绝前端直接携带 API Key。请先在模型中心保存供应商配置，再由工作流引用该配置。';
  }
  return run.error;
}

export function DeveloperSystemPanel() {
  const fetchSystemState = useCallback(async (): Promise<DeveloperSystemState> => {
    const [health, runs, queue, errors] = await Promise.all([
      readJson<DeveloperSystemState['health']>(await fetch('/api/developer/system/health', { credentials: 'same-origin' })),
      readJson<DeveloperSystemState['runs']>(await fetch('/api/developer/system/workflow-runs', { credentials: 'same-origin' })),
      readJson<DeveloperSystemState['queue']>(await fetch('/api/developer/system/queue', { credentials: 'same-origin' })),
      readJson<DeveloperSystemState['errors']>(await fetch('/api/developer/system/errors', { credentials: 'same-origin' }))
    ]);
    return { health, runs, queue, errors };
  }, []);

  const systemQuery = useQuery<DeveloperSystemState>({
    queryKey: ['developer-system-state'],
    queryFn: fetchSystemState,
    staleTime: 5000,
    refetchInterval: 15000
  });

  const system = systemQuery.data;

  return (
    <div className="space-y-4">
      <div className="border border-white/10 bg-white/[0.03] rounded-lg p-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">系统状态与日志</h2>
          <p className="text-sm text-zinc-400 mt-1">服务健康、队列状态、工作流运行和审计日志。</p>
        </div>
        <button type="button" onClick={() => void systemQuery.refetch()} className="px-3 py-2 rounded bg-white/10 text-white hover:bg-white/15 flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${systemQuery.isFetching ? 'animate-spin' : ''}`} />刷新</button>
      </div>
      {systemQuery.error && <div className="border border-red-500/30 bg-red-950/20 text-red-200 rounded p-3 text-sm flex gap-2"><AlertTriangle className="w-4 h-4" />{systemQuery.error instanceof Error ? systemQuery.error.message : '系统状态读取失败。'}</div>}
      {systemQuery.isLoading || !system ? (
        <div className="text-zinc-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />正在加载系统状态...</div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['服务', system.health.service?.status, `uptime ${system.health.service?.uptimeSeconds}s`],
              ['数据库', system.health.database?.status, 'Prisma PostgreSQL'],
              ['Redis', system.health.redis?.status, system.health.redis?.response || ''],
              ['FFmpeg', system.health.showcaseTranscode?.status, `enabled=${Boolean(system.health.showcaseTranscode?.enabled)}`],
              ['版本', system.health.version, system.health.environment]
            ].map(([label, value, detail]) => (
              <div key={label} className="border border-white/10 bg-black/20 rounded-lg p-4">
                <div className="text-[10px] text-zinc-500 font-mono uppercase">{label}</div>
                <div className="text-lg text-white font-bold mt-1">{value || 'unknown'}</div>
                <div className="text-xs text-zinc-500 mt-1">{detail}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="border border-white/10 bg-black/20 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-300" />工作流运行</h3>
              <div className="mt-3 space-y-2 max-h-80 overflow-y-auto">
                {(system.runs.runs || []).map((run) => (
                  <div key={run.id} className="text-xs border border-white/5 rounded p-2 text-zinc-300">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{workflowRunTitle(run)}</div>
                        <div className="text-[11px] text-zinc-500 mt-1 break-all">{workflowRunDetail(run)}</div>
                        <div className="text-[10px] text-zinc-600 mt-1 font-mono">运行 ID：{run.id}</div>
                      </div>
                      <span className={`font-mono shrink-0 ${run.status === 'FAILED' ? 'text-red-300' : 'text-cyan-300'}`}>{run.status}</span>
                    </div>
                    {run.error && <div className="text-red-300 mt-2 line-clamp-3">{workflowRunReason(run)}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-white/10 bg-black/20 rounded-lg p-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><Database className="w-4 h-4 text-cyan-300" />队列与错误</h3>
              <pre className="mt-3 text-xs text-zinc-300 bg-black/30 border border-white/5 rounded p-3 overflow-auto">{JSON.stringify(system.queue.queue, null, 2)}</pre>
              <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                {(system.errors.failedRuns || []).map((item) => (
                  <div key={item.id} className="text-xs text-red-300 border border-red-500/10 rounded p-2">
                    <div className="font-semibold text-red-200">{workflowRunTitle(item)}</div>
                    <div className="mt-1">{workflowRunReason(item) || item.id}</div>
                    <div className="text-[10px] text-red-300/60 mt-1 font-mono">运行 ID：{item.id}</div>
                  </div>
                ))}
                {(system.errors.auditEvents || []).map((item) => <div key={item.id} className="text-xs text-amber-200 border border-amber-500/10 rounded p-2">{item.entityType} / {item.action}</div>)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
