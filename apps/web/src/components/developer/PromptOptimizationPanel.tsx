import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import PromptMatrix from '../PromptMatrix';
import { EmptyState, InlineStatus, PageNotice } from '../ui/State';
import { fetchPromptOptimizationProfiles, resetPromptOptimizationProfile, savePromptOptimizationProfile } from '../../lib/db';
import type { PromptOptimizationProfile, PromptOptimizationProfileKey } from '../../types';

function profileMap(profiles: PromptOptimizationProfile[]) {
  return profiles.reduce<Partial<Record<PromptOptimizationProfileKey, string>>>((record, profile) => {
    if (profile.isEnabled) record[profile.key] = profile.systemPrompt;
    return record;
  }, {});
}

export function PromptOptimizationPanel() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<PromptOptimizationProfileKey>('video_prompt');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['prompt-optimization-profiles'],
    queryFn: fetchPromptOptimizationProfiles,
    staleTime: 30_000
  });
  const profiles = profilesQuery.data || [];
  const selectedProfile = profiles.find((profile) => profile.key === selectedKey) || profiles[0] || null;
  const systemPromptMap = useMemo(() => profileMap(profiles), [profiles]);

  useEffect(() => {
    if (!selectedProfile) return;
    setSelectedKey(selectedProfile.key);
    setDraftPrompt(selectedProfile.systemPrompt);
  }, [selectedProfile?.key, selectedProfile?.systemPrompt]);

  const saveMutation = useMutation({
    mutationFn: () => savePromptOptimizationProfile({
      key: selectedKey,
      systemPrompt: draftPrompt,
      isEnabled: selectedProfile?.isEnabled ?? true
    }),
    onSuccess: async () => {
      setMessage({ tone: 'success', text: '身份设定已保存。' });
      await queryClient.invalidateQueries({ queryKey: ['prompt-optimization-profiles'] });
    },
    onError: (error: any) => setMessage({ tone: 'error', text: error?.message || '身份设定保存失败。' })
  });

  const resetMutation = useMutation({
    mutationFn: () => resetPromptOptimizationProfile(selectedKey),
    onSuccess: async (profile) => {
      setDraftPrompt(profile.systemPrompt);
      setMessage({ tone: 'success', text: '已恢复默认身份设定。' });
      await queryClient.invalidateQueries({ queryKey: ['prompt-optimization-profiles'] });
    },
    onError: (error: any) => setMessage({ tone: 'error', text: error?.message || '恢复默认失败。' })
  });

  if (profilesQuery.isLoading) {
    return <InlineStatus loading tone="info">正在读取提示词优化身份设定...</InlineStatus>;
  }

  if (profilesQuery.error) {
    return <PageNotice tone="error">提示词优化配置读取失败，请刷新后重试。</PageNotice>;
  }

  if (!selectedProfile) {
    return <EmptyState title="暂无提示词优化配置" description="系统会自动初始化视频、生图、反推、改图和音乐提示词身份设定；请刷新页面后重试。" />;
  }

  const isSaving = saveMutation.isPending || resetMutation.isPending;
  const hasChanges = draftPrompt !== selectedProfile.systemPrompt;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 p-4">
          <p className="text-xs font-mono uppercase tracking-widest text-cyan-400">Prompt Optimization Plugin</p>
          <h2 className="mt-2 text-lg font-bold text-white">提示词优化</h2>
          <p className="mt-1 text-sm text-zinc-400">集中维护视频、生图、反推、改图和音乐提示词的后端身份设定。下方工具会使用当前保存的身份设定生成结果。</p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-2">
            {profiles.map((profile) => (
              <button
                key={profile.key}
                type="button"
                onClick={() => {
                  setSelectedKey(profile.key);
                  setDraftPrompt(profile.systemPrompt);
                  setMessage(null);
                }}
                className={`w-full rounded border px-3 py-3 text-left transition ${profile.key === selectedKey ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 bg-black/20 hover:bg-white/[0.04]'}`}
              >
                <div className="text-sm font-semibold text-white">{profile.label}</div>
                <div className="mt-1 text-xs leading-5 text-zinc-500">{profile.description}</div>
              </button>
            ))}
          </div>

          <div className="min-w-0 space-y-3">
            {message && <PageNotice tone={message.tone}>{message.text}</PageNotice>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">{selectedProfile.label}身份设定</div>
                <div className="mt-1 text-xs text-zinc-500">保存后会写入后端，刷新页面和后续插件调用都会读取这个版本。</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => resetMutation.mutate()}
                  disabled={isSaving}
                  className="inline-flex h-9 items-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                >
                  {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  恢复默认
                </button>
                <button
                  type="button"
                  onClick={() => saveMutation.mutate()}
                  disabled={isSaving || !hasChanges || draftPrompt.trim().length < 20}
                  className="inline-flex h-9 items-center gap-2 rounded bg-cyan-300 px-3 text-xs font-bold text-black hover:bg-cyan-200 disabled:opacity-50"
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  保存身份
                </button>
              </div>
            </div>
            <textarea
              value={draftPrompt}
              onChange={(event) => setDraftPrompt(event.target.value)}
              className="min-h-[260px] w-full resize-y rounded border border-white/10 bg-black/40 p-3 font-mono text-xs leading-5 text-zinc-200 outline-none focus:border-cyan-400/50"
            />
          </div>
        </div>
      </div>

      <div className="h-[720px] overflow-hidden rounded-lg border border-white/10 bg-black">
        <PromptMatrix promptOptimizationProfiles={systemPromptMap} embeddedInConfig />
      </div>
    </div>
  );
}
