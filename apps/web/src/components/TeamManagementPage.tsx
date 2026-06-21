import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Loader2, RefreshCw, Repeat2, Search, ShieldCheck, Trash2, Users, XCircle } from 'lucide-react';
import {
  addTeamProjectMember,
  approveTeamProjectAssetSnapshot,
  fetchTeamProjectAssets,
  fetchTeamProjectMembers,
  fetchTeamProjects,
  grantProjectDeveloper,
  rejectTeamProjectAssetSnapshot,
  removeTeamProjectMember,
  revokeProjectDeveloper,
  searchTeamMemberCandidates,
  swapTeamProjectLeader
} from '../lib/db';
import { useAuth } from './AuthContext';
import { ProductionAssetPreview } from './ProductionAssetPreview';
import { ProjectMessageComposer } from './header/MessageComposer';
import { EmptyState, InlineStatus, PageNotice, PermissionHint } from './ui/State';
import type { InternalAssetItem, ProductionAsset, TeamMemberCandidate, TeamProject, TeamProjectMember } from '../types';

type PanelTab = 'members' | 'assets';
type AssetView = 'team' | 'review';

const REVIEW_STATUS_OPTIONS: Array<{ value: ProductionAsset['reviewStatus']; label: string }> = [
  { value: 'IN_REVIEW', label: '待审核' },
  { value: 'APPROVED', label: '审核通过' },
  { value: 'REJECTED', label: '审核未通过' }
];

function userLabel(user?: { displayName?: string | null; username?: string | null; email?: string | null } | null) {
  return user?.displayName || user?.username || user?.email || '未知账号';
}

function formatBytes(size?: number | null) {
  if (!size) return '文本/无文件';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusLabel(status: ProductionAsset['reviewStatus']) {
  return REVIEW_STATUS_OPTIONS.find((item) => item.value === status)?.label || status;
}

function statusClass(status: ProductionAsset['reviewStatus']) {
  if (status === 'APPROVED') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (status === 'REJECTED') return 'border-red-400/30 bg-red-400/10 text-red-200';
  if (status === 'IN_REVIEW') return 'border-amber-400/30 bg-amber-400/10 text-amber-200';
  return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
}

function canManageProject(project: TeamProject | null, currentUser?: { id?: string; uid?: string; projectRoles?: { teamLeaderGrants?: Array<{ projectId: string }>; projectDeveloperGrants?: Array<{ projectId: string }> } } | null) {
  const currentUserId = currentUser?.uid || currentUser?.id;
  if (!project || !currentUserId) return false;
  if (project.createdById === currentUserId) return true;
  const projectGrants = [
    ...(currentUser?.projectRoles?.teamLeaderGrants || []),
    ...(currentUser?.projectRoles?.projectDeveloperGrants || [])
  ];
  return projectGrants.some((grant) => grant.projectId === project.id);
}

function assetSubmitter(item: InternalAssetItem) {
  const asset = item.asset || item.snapshot?.asset || null;
  return asset?.submitter?.displayName || asset?.creator?.displayName || asset?.submitter?.email || asset?.creator?.email || '未知';
}

function getLeaderCount(members: TeamProjectMember[]) {
  return members.filter((member) => member.role === 'OWNER' || member.teamRole === 'TEAM_LEADER' || member.projectRole === 'PROJECT_DEVELOPER').length;
}

export default function TeamManagementPage() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>('assets');
  const [assetView, setAssetView] = useState<AssetView>('team');
  const [reviewStatus, setReviewStatus] = useState<ProductionAsset['reviewStatus']>('IN_REVIEW');
  const [memberSearch, setMemberSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reviewActionId, setReviewActionId] = useState<string | null>(null);
  const [swapSource, setSwapSource] = useState<TeamProjectMember | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['team-projects', user?.uid || 'guest', 'TEAM'],
    queryFn: () => fetchTeamProjects({ projectKind: 'TEAM' }),
    enabled: Boolean(user),
    staleTime: 20_000
  });

  const projects = projectsQuery.data || [];
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === (selectedProjectId || projects[0]?.id)) || null,
    [projects, selectedProjectId]
  );
  const activeProjectId = selectedProject?.id || '';
  const canManage = canManageProject(selectedProject, user);

  const membersQuery = useQuery({
    queryKey: ['team-project-members', activeProjectId],
    queryFn: () => fetchTeamProjectMembers(activeProjectId),
    enabled: Boolean(activeProjectId),
    staleTime: 10_000
  });

  const candidatesQuery = useQuery({
    queryKey: ['team-member-candidates', activeProjectId, memberSearch],
    queryFn: () => searchTeamMemberCandidates(activeProjectId, memberSearch),
    enabled: Boolean(activeProjectId && canManage && memberSearch.trim().length >= 2),
    staleTime: 5_000
  });

  const assetsQuery = useQuery({
    queryKey: ['team-project-assets', activeProjectId, assetView, reviewStatus, assetSearch],
    queryFn: () => fetchTeamProjectAssets({
      projectId: activeProjectId,
      view: canManage ? assetView : 'team',
      reviewStatus: canManage && assetView === 'review' ? reviewStatus : undefined,
      search: assetSearch || undefined
    }),
    enabled: Boolean(activeProjectId),
    staleTime: 10_000
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['team-projects'] }),
      queryClient.invalidateQueries({ queryKey: ['team-project-members'] }),
      queryClient.invalidateQueries({ queryKey: ['team-member-candidates'] }),
      queryClient.invalidateQueries({ queryKey: ['team-project-assets'] }),
      queryClient.invalidateQueries({ queryKey: ['production-assets'] }),
      queryClient.invalidateQueries({ queryKey: ['slash-assets'] })
    ]);
  };

  const addMutation = useMutation({
    mutationFn: (candidate: TeamMemberCandidate) => addTeamProjectMember(activeProjectId, candidate.id, 'MEMBER'),
    onSuccess: async () => {
      setMemberSearch('');
      setMessage('成员已加入项目。');
      await refresh();
    },
    onError: (err: any) => setError(err.message || '添加成员失败。')
  });

  const grantMutation = useMutation({
    mutationFn: (member: TeamProjectMember) => grantProjectDeveloper(activeProjectId, member.userId),
    onSuccess: async () => {
      setMessage('已授予制片权限。');
      await refresh();
    },
    onError: (err: any) => setError(err.message || '授权失败。')
  });

  const revokeMutation = useMutation({
    mutationFn: (member: TeamProjectMember) => revokeProjectDeveloper(activeProjectId, member.userId),
    onSuccess: async () => {
      setMessage('已撤销制片权限。');
      await refresh();
    },
    onError: (err: any) => setError(err.message || '撤销失败。')
  });

  const swapMutation = useMutation({
    mutationFn: (target: TeamProjectMember) => {
      if (!swapSource) throw new Error('请选择要换出的制片。');
      return swapTeamProjectLeader(activeProjectId, swapSource.userId, target.userId);
    },
    onSuccess: async () => {
      setSwapSource(null);
      setMessage('制片身份已对调。');
      await refresh();
    },
    onError: (err: any) => setError(err.message || '制片身份对调失败。')
  });

  const removeMutation = useMutation({
    mutationFn: (member: TeamProjectMember) => removeTeamProjectMember(activeProjectId, member.userId),
    onSuccess: async () => {
      setMessage('成员已移出项目。');
      await refresh();
    },
    onError: (err: any) => setError(err.message || '移除成员失败。')
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ item, action }: { item: InternalAssetItem; action: 'approve' | 'reject' }) => {
      if (!item.snapshot?.id) throw new Error('缺少审核快照。');
      setReviewActionId(item.id);
      if (action === 'approve') return approveTeamProjectAssetSnapshot(activeProjectId, item.snapshot.id);
      return rejectTeamProjectAssetSnapshot(activeProjectId, item.snapshot.id);
    },
    onSuccess: async (_data, variables) => {
      setMessage(variables.action === 'approve' ? '素材已审核通过并升级为团队资源。' : '素材已标记为审核未通过。');
      window.dispatchEvent(new CustomEvent('jiying:production-assets-changed', { detail: { projectId: activeProjectId, action: variables.action } }));
      await refresh();
    },
    onError: (err: any) => setError(err.message || '审核操作失败。'),
    onSettled: () => setReviewActionId(null)
  });

  const members = membersQuery.data || [];
  const candidates = (candidatesQuery.data || []).filter((candidate) => !members.some((member) => member.userId === candidate.id));
  const assetItems = assetsQuery.data?.items || [];
  const teamLeaderCount = getLeaderCount(members);
  const teamLeaderLimitReached = teamLeaderCount >= 2;
  const busy = addMutation.isPending || grantMutation.isPending || revokeMutation.isPending || removeMutation.isPending || swapMutation.isPending;

  if (!user) {
    return (
      <main className="flex-grow pt-24 pb-12 px-6 max-w-5xl mx-auto w-full">
        <PermissionHint title="请先登录后进入团队管理">
          团队项目、成员身份和素材审核都绑定账号。登录后可查看你参与的团队项目。
        </PermissionHint>
      </main>
    );
  }

  return (
    <main className="flex-grow pt-24 pb-12 px-6 max-w-7xl mx-auto w-full">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-cyan-400 uppercase tracking-widest">Account Team Projects</p>
          <h1 className="mt-2 text-3xl font-bold text-white">团队管理</h1>
          <p className="mt-2 text-sm text-zinc-400">从账号系统进入项目成员、制片权限和团队素材资料；全局角色与项目制片身份并行存在。</p>
        </div>
      </div>

      {error && <div className="mb-4"><PageNotice tone="error">{error}</PageNotice></div>}
      {message && <div className="mb-4"><PageNotice tone="success">{message}</PageNotice></div>}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <aside className="rounded-lg border border-white/10 bg-white/[0.03] p-3 h-fit">
          <div className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold text-white"><Users className="h-4 w-4 text-cyan-300" />团队项目</div>
          {projectsQuery.isLoading ? (
            <div className="p-2"><InlineStatus loading>正在读取项目...</InlineStatus></div>
          ) : projectsQuery.error ? (
            <PageNotice tone="error">团队项目读取失败，请刷新或检查本地服务。</PageNotice>
          ) : projects.length === 0 ? (
            <EmptyState title="暂无团队项目" description="请先在工作台创建团队影视项目，再回到这里管理成员和审核素材。" />
          ) : projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                setSelectedProjectId(project.id);
                setError('');
                setMessage('');
                setSwapSource(null);
              }}
              className={`mb-2 w-full rounded border p-3 text-left transition-colors ${selectedProject?.id === project.id ? 'border-cyan-400/40 bg-cyan-500/10' : 'border-white/10 bg-black/20 hover:bg-white/[0.05]'}`}
            >
              <span className="block truncate text-sm font-semibold text-white">{project.name}</span>
              <span className="mt-1 block text-[11px] text-zinc-500">{project.memberCount || 0} 名成员</span>
            </button>
          ))}
        </aside>

        <section className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03]">
          {!selectedProject ? (
            <div className="p-6">
              <EmptyState title="请选择团队项目" description="团队项目需从工作台的影视创作入口创建，选择后可管理成员、制片身份和素材审核。" />
            </div>
          ) : (
            <>
              <div className="border-b border-white/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">{selectedProject.name}</h2>
                    <p className="mt-1 text-xs text-zinc-500">身份：{role === 'ADMIN' ? '管理员' : role === 'DEVELOPER' ? '经理' : '普通用户'} / 项目权限：{canManage ? '制片或拥有者' : '成员只读'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-2 py-1 text-[11px] ${canManage ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-zinc-600 bg-zinc-900 text-zinc-400'}`}>
                      {canManage ? '可管理成员与审核素材' : '仅查看已通过团队资产'}
                    </span>
                    <span className="rounded border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100">制片 {teamLeaderCount} 名</span>
                  </div>
                </div>

                <div className="mt-4 flex rounded border border-white/10 bg-black/30 p-1">
                  <button type="button" onClick={() => setActiveTab('assets')} className={`flex-1 rounded px-3 py-2 text-sm ${activeTab === 'assets' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}>素材资料</button>
                  <button type="button" onClick={() => setActiveTab('members')} className={`flex-1 rounded px-3 py-2 text-sm ${activeTab === 'members' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}>项目成员</button>
                </div>
              </div>

              <ProjectMessageComposer projectId={activeProjectId} members={members} disabled={!canManage} />

              {activeTab === 'members' && (
                <>
                  {canManage && (
                    <div className="border-b border-white/10 p-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                        <input
                          value={memberSearch}
                          onChange={(event) => setMemberSearch(event.target.value)}
                          placeholder="搜索邮箱、用户名或昵称来加入团队"
                          className="w-full rounded border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-400/50"
                        />
                      </div>
                      {memberSearch.trim().length >= 2 && (
                        <div className="mt-2 rounded border border-white/10 bg-black/30">
                          {candidatesQuery.isFetching ? (
                            <div className="p-3 text-xs text-zinc-500">搜索中...</div>
                          ) : candidates.length === 0 ? (
                            <div className="p-3 text-xs text-zinc-500">没有可加入的账号。</div>
                          ) : candidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              type="button"
                              disabled={busy}
                              onClick={() => addMutation.mutate(candidate)}
                              className="flex w-full items-center justify-between gap-3 border-b border-white/5 p-3 text-left text-sm hover:bg-white/[0.04] disabled:opacity-50 last:border-b-0"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-white">{userLabel(candidate)}</span>
                                <span className="block truncate text-[11px] text-zinc-500">{candidate.email}</span>
                              </span>
                              <span className="text-xs text-cyan-200">加入</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {canManage && teamLeaderLimitReached && (
                    <div className="border-b border-white/10 bg-cyan-500/[0.04] p-4 text-xs text-cyan-100">
                      {swapSource ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span>已选择「{userLabel(swapSource.user)}」作为换出的制片，请在成员列表中选择一个成员换入。</span>
                          <button type="button" onClick={() => setSwapSource(null)} className="rounded border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/10">
                            取消对调
                          </button>
                        </div>
                      ) : (
                        <span>当前项目已达到两名制片上限；如需更换制片，请先在现有制片旁选择换出，再选择成员换入。</span>
                      )}
                    </div>
                  )}

                  <div className="divide-y divide-white/10">
                    {membersQuery.isLoading ? (
                      <div className="p-6 text-sm text-zinc-500">正在读取成员...</div>
                    ) : membersQuery.error ? (
                      <div className="p-4"><PageNotice tone="error">项目成员读取失败，请刷新后重试。</PageNotice></div>
                    ) : members.length === 0 ? (
                      <div className="p-4"><EmptyState title="暂无成员" description="项目拥有者会自动成为成员；如果这里为空，请刷新项目列表。" /></div>
                    ) : members.map((member) => {
                      const isOwner = member.role === 'OWNER';
                      const isTeamLeader = member.teamRole === 'TEAM_LEADER' || member.projectRole === 'PROJECT_DEVELOPER';
                      return (
                        <div key={member.id} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-semibold text-white">{userLabel(member.user)}</span>
                              <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-400">{isOwner ? '拥有者' : '成员'}</span>
                              {(isOwner || isTeamLeader) && <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-100">制片</span>}
                            </div>
                            <div className="mt-1 truncate text-xs text-zinc-500">{member.user?.email || member.userId}</div>
                          </div>
                          {canManage && !isOwner && (
                            <div className="flex flex-wrap items-center gap-2">
                              {isTeamLeader ? (
                                <>
                                  <button type="button" disabled={busy} onClick={() => revokeMutation.mutate(member)} className="inline-flex items-center gap-1.5 rounded border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/20 disabled:opacity-50">
                                    <XCircle className="h-3.5 w-3.5" />撤销制片
                                  </button>
                                  {teamLeaderLimitReached && (
                                    <button type="button" disabled={busy} onClick={() => setSwapSource(member)} className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs disabled:opacity-50 ${swapSource?.userId === member.userId ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100' : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20'}`}>
                                      <Repeat2 className="h-3.5 w-3.5" />{swapSource?.userId === member.userId ? '已选换出' : '选择换出'}
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  {swapSource ? (
                                    <button type="button" disabled={busy} onClick={() => swapMutation.mutate(member)} className="inline-flex items-center gap-1.5 rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50">
                                      <Repeat2 className="h-3.5 w-3.5" />换入为制片
                                    </button>
                                  ) : teamLeaderLimitReached ? (
                                    <button type="button" disabled className="inline-flex items-center gap-1.5 rounded border border-zinc-600 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-500">
                                      <ShieldCheck className="h-3.5 w-3.5" />已满两名制片
                                    </button>
                                  ) : (
                                    <button type="button" disabled={busy} onClick={() => grantMutation.mutate(member)} className="inline-flex items-center gap-1.5 rounded border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50">
                                      <ShieldCheck className="h-3.5 w-3.5" />设为制片
                                    </button>
                                  )}
                                </>
                              )}
                              <button type="button" disabled={busy} onClick={() => removeMutation.mutate(member)} className="inline-flex items-center gap-1.5 rounded border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/20 disabled:opacity-50">
                                <Trash2 className="h-3.5 w-3.5" />移出团队
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {activeTab === 'assets' && (
                <div className="p-4">
                  <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_180px_minmax(0,1fr)_auto]">
                    <div className="flex rounded border border-white/10 bg-black/30 p-1">
                      <button type="button" onClick={() => setAssetView('team')} className={`flex-1 rounded px-3 py-2 text-xs ${assetView === 'team' || !canManage ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}>团队资源</button>
                      <button type="button" onClick={() => canManage && setAssetView('review')} disabled={!canManage} className={`flex-1 rounded px-3 py-2 text-xs ${assetView === 'review' && canManage ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white disabled:opacity-40'}`}>审核库</button>
                    </div>
                    <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as ProductionAsset['reviewStatus'])} disabled={!canManage || assetView !== 'review'} className="rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none disabled:opacity-40">
                      {REVIEW_STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                      <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="搜索素材、提交者或文件名" className="w-full rounded border border-white/10 bg-black/40 py-2 pl-8 pr-3 text-sm text-white outline-none" />
                    </div>
                    <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ['team-project-assets'] })} className="inline-flex items-center justify-center rounded bg-white/10 px-3 text-white hover:bg-white/15" title="刷新素材">
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>

                  {!canManage && (
                    <div className="mb-4 rounded border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                      成员只读模式：你只能查看本项目已审核通过的团队资源。若需要审核素材或管理成员，请联系项目拥有者授予制片权限。
                    </div>
                  )}

                  {assetsQuery.isLoading || assetsQuery.isFetching ? (
                    <InlineStatus loading>正在加载素材资料...</InlineStatus>
                  ) : assetsQuery.error ? (
                    <PageNotice tone="error">素材资料读取失败，请刷新列表后重试。</PageNotice>
                  ) : assetItems.length === 0 ? (
                    <EmptyState
                      title={assetSearch.trim() ? '没有匹配素材' : assetView === 'review' && canManage ? '暂无待处理素材' : '暂无团队资源'}
                      description={assetSearch.trim()
                        ? '请更换关键词，或切换团队资源/审核库范围。'
                        : assetView === 'review' && canManage
                          ? '成员提交审核后，待审核、已通过、已驳回素材会按状态出现在这里。'
                          : '通过审核的团队资源会出现在这里，并可被后续阶段复用。'}
                    />
                  ) : (
                    <div className="space-y-3">
                      {assetItems.map((item) => {
                        const snapshot = item.snapshot;
                        const canReview = canManage && assetView === 'review' && item.kind === 'snapshot' && item.reviewStatus === 'IN_REVIEW';
                        const busyReview = reviewActionId === item.id || reviewMutation.isPending;
                        return (
                          <div key={item.id} className="grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded border px-2 py-0.5 text-[11px] ${statusClass(item.reviewStatus)}`}>
                                  {statusLabel(item.reviewStatus)}
                                </span>
                                <span className="text-[11px] text-zinc-500">{item.stage}</span>
                                <span className="text-[11px] text-zinc-500">{formatBytes(item.sizeBytes)}</span>
                                {item.kind === 'reference' && <span className="rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">团队共享</span>}
                              </div>
                              <div className="mt-2 truncate text-sm font-semibold text-white">{item.displayName}</div>
                              <div className="mt-1 text-xs text-zinc-500">提交者：{assetSubmitter(item)}</div>
                              {snapshot?.payloadPreview && <pre className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/30 p-3 text-xs text-zinc-300">{snapshot.payloadPreview}</pre>}
                              <ProductionAssetPreview item={item} />
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              {canReview ? (
                                <>
                                  <button type="button" disabled={busyReview} onClick={() => reviewMutation.mutate({ item, action: 'approve' })} className="inline-flex items-center gap-1.5 rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50">
                                    {busyReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}通过
                                  </button>
                                  <button type="button" disabled={busyReview} onClick={() => reviewMutation.mutate({ item, action: 'reject' })} className="inline-flex items-center gap-1.5 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-100 hover:bg-red-500/20 disabled:opacity-50">
                                    {busyReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}驳回
                                  </button>
                                </>
                              ) : item.reviewStatus === 'IN_REVIEW' ? (
                                <span className="inline-flex items-center gap-1 text-xs text-amber-200"><Clock3 className="h-3.5 w-3.5" />等待制片审核</span>
                              ) : (
                                <span className="text-xs text-zinc-500">仅查看</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-white/10 p-4 text-xs text-zinc-500">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-300" />
                团队项目最多两名制片；成员共享已通过团队资源，个人资源仍按账号独立隔离。
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
