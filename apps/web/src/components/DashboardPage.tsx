import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { Film, Gamepad2, MonitorCog, MoreHorizontal, Pencil, Rows3, Trash2, UserRound, Users } from 'lucide-react';
import { createTeamProject, deleteTeamProject, fetchTeamProjects, renameTeamProject } from '../lib/db';
import { useAuth } from './AuthContext';
import { EmptyState, InlineStatus, PageNotice } from './ui/State';
import type { ReactNode } from 'react';
import type { TeamProject } from '../types';

type DashboardPageProps = {
  onOpenPipeline: (projectId: string) => void;
  onPlaceholderWorkflow: (title: string) => void;
};

type WorkflowType = 'film' | 'game' | 'storyboard' | 'ui';
type ProjectKind = 'PERSONAL' | 'TEAM';

const workflowCards: Array<{ type: WorkflowType; title: string; description: string; icon: ReactNode; available: boolean }> = [
  { type: 'film', title: '影视创作', description: '01 剧本到 04 剪辑的完整制片工作台', icon: <Film className="h-7 w-7" />, available: true },
  { type: 'game', title: '游戏预演', description: '角色、关卡与玩法镜头预演', icon: <Gamepad2 className="h-7 w-7" />, available: false },
  { type: 'storyboard', title: '分镜预演', description: '镜头节奏、画面与动作规划', icon: <Rows3 className="h-7 w-7" />, available: false },
  { type: 'ui', title: 'UI设计', description: '界面结构、视觉稿和交互草案', icon: <MonitorCog className="h-7 w-7" />, available: false }
];

const duplicateProjectNameMessage = '不能出现同名的项目，请更改项目名称后再创建。';

function formatProjectStatus(project: TeamProject) {
  const updated = project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : '';
  const kind = project.projectKind === 'PERSONAL' ? '个人项目' : `${project.memberCount || 1} 名成员`;
  return updated ? `${kind} / 更新 ${updated}` : kind;
}

function defaultProjectName(workflowTitle: string, kind: ProjectKind) {
  return `${kind === 'PERSONAL' ? '个人' : '团队'}${workflowTitle}`;
}

function projectIcon(kind: ProjectKind) {
  return kind === 'PERSONAL' ? <UserRound className="h-4 w-4" /> : <Users className="h-4 w-4" />;
}

export function DashboardPage({ onOpenPipeline, onPlaceholderWorkflow }: DashboardPageProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draftWorkflow, setDraftWorkflow] = useState<{ type: WorkflowType; title: string } | null>(null);
  const [draftKind, setDraftKind] = useState<ProjectKind | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftError, setDraftError] = useState('');
  const [renameTarget, setRenameTarget] = useState<TeamProject | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TeamProject | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuAnchorRect, setMenuAnchorRect] = useState<{ top: number; right: number } | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement | null>());

  const personalProjectsQuery = useQuery({
    queryKey: ['team-projects', user?.uid || 'guest', 'PERSONAL'],
    queryFn: () => fetchTeamProjects({ projectKind: 'PERSONAL' }),
    enabled: Boolean(user),
    staleTime: 30_000
  });

  const teamProjectsQuery = useQuery({
    queryKey: ['team-projects', user?.uid || 'guest', 'TEAM'],
    queryFn: () => fetchTeamProjects({ projectKind: 'TEAM' }),
    enabled: Boolean(user),
    staleTime: 30_000
  });

  const refreshProjects = async () => {
    await queryClient.invalidateQueries({ queryKey: ['team-projects'] });
  };

  const createProjectMutation = useMutation({
    mutationFn: () => {
      if (!draftWorkflow || !draftKind) throw new Error('请选择项目类型。');
      const name = draftName.trim();
      if (!name) throw new Error('请输入项目名称。');
      const existingProjects = draftKind === 'PERSONAL' ? personalProjects : teamProjects;
      if (existingProjects.some((project) => project.name.trim().toLowerCase() === name.toLowerCase())) {
        throw new Error(duplicateProjectNameMessage);
      }
      return createTeamProject({
        name,
        projectKind: draftKind,
        workflowType: draftWorkflow.type,
        description: `${draftWorkflow.title} / ${draftKind === 'PERSONAL' ? '个人项目' : '团队项目'}`
      });
    },
    onSuccess: async (project) => {
      setDraftWorkflow(null);
      setDraftKind(null);
      setDraftName('');
      setDraftError('');
      await refreshProjects();
      onOpenPipeline(project.id);
    },
    onError: (error: any) => setDraftError(error.message || duplicateProjectNameMessage)
  });

  const renameMutation = useMutation({
    mutationFn: () => {
      if (!renameTarget) throw new Error('请选择项目。');
      const name = renameText.trim();
      if (!name) throw new Error('请输入项目名称。');
      return renameTeamProject(renameTarget.id, name);
    },
    onSuccess: async () => {
      setRenameTarget(null);
      setRenameText('');
      setMessage({ tone: 'success', text: '项目已重命名。' });
      await refreshProjects();
    },
    onError: (error: any) => setMessage({ tone: 'error', text: error.message || '项目重命名失败。' })
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deleteTarget) throw new Error('请选择要删除的项目。');
      return deleteTeamProject(deleteTarget.id);
    },
    onSuccess: async () => {
      setMessage({ tone: 'success', text: '项目已删除。' });
      setDeleteTarget(null);
      setDeleteConfirmOpen(false);
      await refreshProjects();
    },
    onError: (error: any) => setMessage({ tone: 'error', text: error.message || '项目删除失败。' })
  });

  const personalProjects = personalProjectsQuery.data || [];
  const teamProjects = teamProjectsQuery.data || [];
  const isProjectLoading = personalProjectsQuery.isLoading || teamProjectsQuery.isLoading;
  const modalTitle = useMemo(() => {
    if (!draftWorkflow) return '';
    if (!draftKind) return `新建 ${draftWorkflow.title} 项目`;
    return `${draftKind === 'PERSONAL' ? '新建个人项目' : '新建团队项目'} / ${draftWorkflow.title}`;
  }, [draftKind, draftWorkflow]);

  function startWorkflow(card: (typeof workflowCards)[number]) {
    if (!card.available) {
      onPlaceholderWorkflow(card.title);
      return;
    }
    if (!user) {
      setMessage({ tone: 'info', text: '请先登录后再新建项目。' });
      return;
    }
    setDraftWorkflow({ type: card.type, title: card.title });
    setDraftKind(null);
    setDraftName('');
    setDraftError('');
  }

  function chooseDraftKind(kind: ProjectKind) {
    setDraftKind(kind);
    setDraftName(defaultProjectName(draftWorkflow?.title || '项目', kind));
    setDraftError('');
  }

  function openAvailableWorkflow(kind: ProjectKind) {
    const filmWorkflow = workflowCards.find((card) => card.type === 'film');
    if (!filmWorkflow) return;
    setDraftWorkflow({ type: filmWorkflow.type, title: filmWorkflow.title });
    setDraftKind(kind);
    setDraftName(defaultProjectName(filmWorkflow.title, kind));
    setDraftError('');
  }

  function closeDraftModal() {
    setDraftWorkflow(null);
    setDraftKind(null);
    setDraftName('');
    setDraftError('');
  }

  function openRename(project: TeamProject) {
    setRenameTarget(project);
    setRenameText(project.name);
    setOpenMenuId(null);
  }

  function openDelete(project: TeamProject) {
    setDeleteTarget(project);
    setDeleteConfirmOpen(false);
    setOpenMenuId(null);
  }

  function toggleProjectMenu(projectId: string, button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();
    if (openMenuId === projectId) {
      setOpenMenuId(null);
      setMenuAnchorRect(null);
      return;
    }
    setOpenMenuId(projectId);
    setMenuAnchorRect({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }

  useEffect(() => {
    if (!openMenuId) return;
    const syncMenuPosition = () => {
      const button = menuButtonRefs.current.get(openMenuId);
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setMenuAnchorRect({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    window.addEventListener('resize', syncMenuPosition);
    window.addEventListener('scroll', syncMenuPosition, true);
    return () => {
      window.removeEventListener('resize', syncMenuPosition);
      window.removeEventListener('scroll', syncMenuPosition, true);
    };
  }, [openMenuId]);

  function ProjectList({ title, kind, projects }: { title: string; kind: ProjectKind; projects: TeamProject[] }) {
    const filmWorkflow = workflowCards.find((card) => card.type === 'film');
    return (
      <section>
        <div className="mb-3 flex items-center gap-2 border-l-4 border-white pl-3">
          <h3 className="text-lg font-bold text-white">{title}</h3>
        </div>
        <div className="flex flex-col gap-3">
          {!user ? (
            <PageNotice tone="info">登录后可创建和查看当前账号的个人项目与团队项目。</PageNotice>
          ) : isProjectLoading ? (
            <InlineStatus loading>正在读取项目...</InlineStatus>
          ) : (kind === 'PERSONAL' ? personalProjectsQuery.error : teamProjectsQuery.error) ? (
            <PageNotice tone="error">项目列表读取失败，请刷新页面或检查本地服务状态。</PageNotice>
          ) : projects.length === 0 ? (
            <EmptyState
              title={`暂无${kind === 'PERSONAL' ? '个人项目' : '团队项目'}`}
              description={kind === 'PERSONAL' ? '个人项目适合先独立完成剧本、分镜、镜头和剪辑草案。' : '团队项目适合多人共享已审核素材，并进入制片审核流程。'}
              action={filmWorkflow && (
                <button type="button" onClick={() => openAvailableWorkflow(kind)} className="rounded border border-cyan-400/30 bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25">
                  新建{kind === 'PERSONAL' ? '个人' : '团队'}影视项目
                </button>
              )}
            />
          ) : projects.map((project) => (
            <div key={project.id} className={`glass-panel rounded-lg p-4 flex items-center justify-between gap-4 hover:bg-white/5 transition-colors ${openMenuId === project.id ? 'relative z-40' : 'relative z-0'}`}>
              <button type="button" onClick={() => onOpenPipeline(project.id)} className="min-w-0 flex flex-1 items-center gap-4 text-left">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border ${kind === 'PERSONAL' ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'}`}>
                  {projectIcon(kind)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-200">{project.name}</span>
                  <span className="mt-1 block text-xs text-gray-500">{formatProjectStatus(project)}</span>
                </span>
              </button>
              <div className="relative shrink-0">
                <button
                  type="button"
                  ref={(node) => {
                    menuButtonRefs.current.set(project.id, node);
                  }}
                  onClick={(event) => toggleProjectMenu(project.id, event.currentTarget)}
                  className="rounded border border-white/10 bg-white/5 p-2 text-zinc-300 hover:bg-white/10"
                  title="项目操作"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <main id="view-dashboard" className="flex-grow pt-24 pb-12 px-6 max-w-7xl mx-auto w-full transition-opacity duration-300">
      {message && (
        <div className="mb-5">
          <PageNotice tone={message.tone}>{message.text}</PageNotice>
        </div>
      )}

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6 neon-text">工作流引擎 (Workflow Engine)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {workflowCards.map((card) => (
            <button
              key={card.type}
              type="button"
              onClick={() => startWorkflow(card)}
              className={`glass-panel min-h-36 p-5 rounded-xl flex flex-col items-center justify-center gap-3 transition-all cursor-pointer select-none hover:bg-white/5 ${card.available ? 'border-white/30' : 'opacity-80'}`}
            >
              <span className={card.available ? 'text-white' : 'text-gray-400'}>{card.icon}</span>
              <span className={`text-sm ${card.available ? 'font-bold text-white' : 'font-medium text-gray-300'}`}>{card.title}</span>
              <span className={`rounded border px-2 py-0.5 text-[10px] ${card.available ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-zinc-600 bg-zinc-900/60 text-zinc-500'}`}>
                {card.available ? '当前可用' : '规划中'}
              </span>
              <span className="line-clamp-2 text-center text-[11px] leading-relaxed text-gray-500">{card.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-6 neon-text">项目 (Projects)</h2>
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
          <ProjectList title="个人项目 (Personal Projects)" kind="PERSONAL" projects={personalProjects} />
          <ProjectList title="团队项目 (Team Projects)" kind="TEAM" projects={teamProjects} />
        </div>
      </section>

      {openMenuId && menuAnchorRect && typeof document !== 'undefined' && createPortal(
        <>
          <button
            type="button"
            aria-label="关闭项目菜单"
            className="fixed inset-0 z-[190] cursor-default"
            onClick={() => {
              setOpenMenuId(null);
              setMenuAnchorRect(null);
            }}
          />
          {(() => {
            const project = [...personalProjects, ...teamProjects].find((item) => item.id === openMenuId);
            if (!project) return null;
            return (
              <div
                className="fixed z-[200] w-32 rounded border border-white/10 bg-[#08090c] p-1 shadow-2xl"
                style={{ top: menuAnchorRect.top, right: menuAnchorRect.right }}
              >
                <button type="button" onClick={() => openRename(project)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-zinc-200 hover:bg-white/10">
                  <Pencil className="h-3.5 w-3.5" />重命名
                </button>
                <button type="button" onClick={() => openDelete(project)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-red-200 hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" />删除
                </button>
              </div>
            );
          })()}
        </>,
        document.body
      )}

      {draftWorkflow && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur">
          <div className="w-full max-w-md rounded-lg border border-cyan-400/25 bg-[#08090c] p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">{modalTitle}</h3>
            {!draftKind ? (
              <div className="mt-5 grid grid-cols-2 gap-3">
                <button type="button" onClick={() => chooseDraftKind('PERSONAL')} className="rounded border border-cyan-400/25 bg-cyan-400/10 p-4 text-left text-cyan-100 hover:bg-cyan-400/15">
                  <UserRound className="mb-3 h-5 w-5" />
                  <span className="block text-sm font-semibold">新建个人项目</span>
                  <span className="mt-1 block text-xs text-cyan-100/60">仅当前账号可见</span>
                </button>
                <button type="button" onClick={() => chooseDraftKind('TEAM')} className="rounded border border-emerald-400/25 bg-emerald-400/10 p-4 text-left text-emerald-100 hover:bg-emerald-400/15">
                  <Users className="mb-3 h-5 w-5" />
                  <span className="block text-sm font-semibold">新建团队项目</span>
                  <span className="mt-1 block text-xs text-emerald-100/60">团队成员可共享通过审核的资源</span>
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <label className="block text-xs font-semibold text-zinc-400">项目名称</label>
                <input
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    if (draftError) setDraftError('');
                  }}
                  aria-invalid={Boolean(draftError)}
                  aria-describedby={draftError ? 'new-project-error' : undefined}
                  autoFocus
                  className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40 aria-[invalid=true]:border-red-400/60"
                />
                {draftError && (
                  <p id="new-project-error" className="rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                    {draftError}
                  </p>
                )}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={closeDraftModal} className="rounded border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10">取消</button>
              {draftKind && (
                <button type="button" disabled={createProjectMutation.isPending} onClick={() => createProjectMutation.mutate()} className="rounded border border-cyan-400/30 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50">
                  {createProjectMutation.isPending ? '创建中...' : '确认进入工作台'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {renameTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur">
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#08090c] p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">重命名项目</h3>
            <input value={renameText} onChange={(event) => setRenameText(event.target.value)} autoFocus className="mt-5 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40" />
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setRenameTarget(null)} className="rounded border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10">取消</button>
              <button type="button" disabled={renameMutation.isPending} onClick={() => renameMutation.mutate()} className="rounded border border-cyan-400/30 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50">确认</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur">
          <div className="w-full max-w-md rounded-lg border border-red-400/25 bg-[#08090c] p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">删除项目</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">你正在删除「{deleteTarget.name}」。删除后该项目的工作区、成员关系和关联团队资产将一并移除。</p>
            {deleteConfirmOpen && (
              <div className="mt-4 rounded border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                是否真的要把该项目删除？该操作不可恢复。
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => { setDeleteTarget(null); setDeleteConfirmOpen(false); }} className="rounded border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 hover:bg-white/10">取消</button>
              {!deleteConfirmOpen ? (
                <button type="button" onClick={() => setDeleteConfirmOpen(true)} className="rounded border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-500/20">继续删除</button>
              ) : (
                <button type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()} className="rounded border border-red-400/30 bg-red-500/20 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-500/30 disabled:opacity-50">
                  {deleteMutation.isPending ? '删除中...' : '确认删除'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
