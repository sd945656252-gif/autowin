import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileUp, Loader2, RefreshCcw, Save, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { createProductionAsset, savePromptHistoryItem, submitProductionAssetReview } from '../lib/db';
import { useAuth } from './AuthContext';

type ScriptField = { key: keyof ScriptBreakdownRow | 'orderIndex'; title: string };

type ScriptBreakdownRow = {
  id: string;
  orderIndex: number;
  shotSize: string;
  shot: string;
  cameraMovement: string;
  characters: string;
  scene: string;
  action: string;
  props: string;
  composition: string;
  emotion: string;
  lighting: string;
  soundEffect: string;
  dialogueOrVoiceover: string;
  vfx: string;
  duration: string;
  motionSpeed: string;
  dynamic: string;
  storyboardImagePrompt: string;
  storyboardVideoPrompt: string;
  sourceText: string;
  confidence: number;
  version: number;
  updatedAt: string;
};

type ScriptProject = {
  id: string;
  title: string;
  sourceType: 'FILE' | 'IDEA';
  status: 'DRAFT' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
  errorMessage?: string | null;
  currentVersion: number;
  updatedAt: string;
  rows?: ScriptBreakdownRow[];
  versions?: Array<{ id: string; version: number; type: string; summary?: string; rowCount: number; createdAt: string }>;
};

type ScriptJob = {
  id: string;
  projectId?: string | null;
  status: 'QUEUED' | 'PARSING' | 'GENERATING' | 'VALIDATING' | 'SAVING' | 'SUCCEEDED' | 'FAILED';
  progress: number;
  message?: string | null;
  errorMessage?: string | null;
  resultJson?: any;
};

const FALLBACK_FIELDS: ScriptField[] = [
  { key: 'orderIndex', title: '序号' },
  { key: 'shotSize', title: '景别' },
  { key: 'shot', title: '镜头' },
  { key: 'cameraMovement', title: '运镜' },
  { key: 'characters', title: '角色' },
  { key: 'scene', title: '场景' },
  { key: 'action', title: '动作' },
  { key: 'props', title: '道具' },
  { key: 'composition', title: '构图' },
  { key: 'emotion', title: '情绪' },
  { key: 'lighting', title: '光影' },
  { key: 'soundEffect', title: '音效' },
  { key: 'dialogueOrVoiceover', title: '对白/旁白' },
  { key: 'vfx', title: '特效' },
  { key: 'duration', title: '时长' },
  { key: 'motionSpeed', title: '运动速度' },
  { key: 'dynamic', title: '动态' },
  { key: 'storyboardImagePrompt', title: '分镜图' },
  { key: 'storyboardVideoPrompt', title: '分镜视频' }
];

const editableFields = FALLBACK_FIELDS.filter((field) => field.key !== 'orderIndex');
const longFields = new Set(['action', 'dialogueOrVoiceover', 'storyboardImagePrompt', 'storyboardVideoPrompt', 'sourceText']);

interface ScriptEditorProps {
  currentProjectId?: string | null;
}

async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `请求失败：${response.status}`);
  return data as T;
}

export default function ScriptEditor({ currentProjectId }: ScriptEditorProps) {
  const { user, setHistory } = useAuth();
  const [fields, setFields] = useState<ScriptField[]>(FALLBACK_FIELDS);
  const [projects, setProjects] = useState<ScriptProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<ScriptProject | null>(null);
  const [rows, setRows] = useState<ScriptBreakdownRow[]>([]);
  const [draftRows, setDraftRows] = useState<Record<string, ScriptBreakdownRow>>({});
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({});
  const [savingRows, setSavingRows] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [idea, setIdea] = useState('');
  const [title, setTitle] = useState('');
  const [activeJob, setActiveJob] = useState<ScriptJob | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScriptProject | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [assetSavingMode, setAssetSavingMode] = useState<'save' | 'submit' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasUnsavedRows = useMemo(() => Object.values(dirtyRows).some(Boolean), [dirtyRows]);

  function resetScriptWorkspace() {
    setActiveProjectId(null);
    setProject(null);
    setRows([]);
    setDraftRows({});
    setDirtyRows({});
    setSavingRows({});
    setActiveJob(null);
    setDeleteTarget(null);
  }

  async function loadProjects(selectFirst = false) {
    const suffix = currentProjectId ? `?productionProjectId=${encodeURIComponent(currentProjectId)}` : '';
    const data = await apiJson<{ projects: ScriptProject[] }>(`/api/scripts/projects${suffix}`);
    const nextProjects = data.projects || [];
    setProjects(nextProjects);
    const activeStillExists = activeProjectId ? nextProjects.some((item) => item.id === activeProjectId) : false;
    if (!activeStillExists) {
      const nextProjectId = selectFirst ? nextProjects[0]?.id || null : null;
      setActiveProjectId(nextProjectId);
      if (!nextProjectId) {
        setProject(null);
        setRows([]);
        setDraftRows({});
        setDirtyRows({});
      }
    }
  }

  async function loadProject(projectId: string) {
    const data = await apiJson<{ project: ScriptProject }>(`/api/scripts/projects/${encodeURIComponent(projectId)}`);
    setProject(data.project);
    const nextRows = data.project.rows || [];
    setRows(nextRows);
    setDraftRows(Object.fromEntries(nextRows.map((row) => [row.id, row])));
    setDirtyRows({});
    return data.project;
  }

  useEffect(() => {
    resetScriptWorkspace();
    void apiJson<{ fields: ScriptField[] }>('/api/scripts/fields')
      .then((data) => setFields(data.fields?.length ? data.fields : FALLBACK_FIELDS))
      .catch(() => setFields(FALLBACK_FIELDS));
    void loadProjects(true).catch((error) => setMessage({ type: 'error', text: error.message }));
  }, [currentProjectId]);

  useEffect(() => {
    if (!activeProjectId) return;
    void loadProject(activeProjectId).catch((error) => setMessage({ type: 'error', text: error.message }));
  }, [activeProjectId]);

  useEffect(() => {
    const onAssistantConfirmed = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.stage !== 'SCRIPT_01') return;
      const nextProjectId = detail.action?.executionResult?.project?.id;
      void loadProjects().then(() => {
        if (nextProjectId) setActiveProjectId(nextProjectId);
      }).catch((error) => setMessage({ type: 'error', text: error.message }));
    };
    window.addEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantConfirmed);
    return () => window.removeEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantConfirmed);
  }, []);

  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === 'SUCCEEDED' || activeJob.status === 'FAILED') return;
    const timer = window.setInterval(async () => {
      try {
        const data = await apiJson<{ job: ScriptJob }>(`/api/scripts/jobs/${encodeURIComponent(activeJob.id)}`);
        setActiveJob(data.job);
        if (data.job.status === 'SUCCEEDED') {
          setMessage({ type: 'success', text: data.job.message || '任务完成。' });
          await loadProjects();
          if (data.job.projectId) await loadProject(data.job.projectId);
          if (data.job.resultJson?.url) window.location.href = data.job.resultJson.url;
        }
        if (data.job.status === 'FAILED') setMessage({ type: 'error', text: data.job.errorMessage || '任务失败。' });
      } catch (error) {
        setMessage({ type: 'error', text: error instanceof Error ? error.message : '任务状态读取失败。' });
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    const formData = new FormData();
    formData.append('file', file);
    if (title.trim()) formData.append('title', title.trim());
    if (currentProjectId) formData.append('productionProjectId', currentProjectId);
    try {
      const response = await fetch('/api/scripts/import', { method: 'POST', credentials: 'same-origin', body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || '上传失败。');
      setActiveProjectId(data.project.id);
      setActiveJob(data.job);
      setMessage({ type: 'info', text: '剧本已上传，正在异步解析拆解。' });
      await loadProjects();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '上传失败。' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleIdeaSubmit() {
    if (!idea.trim()) {
      setMessage({ type: 'error', text: '请输入一句想法或一段创意。' });
      return;
    }
    try {
      const data = await apiJson<{ project: ScriptProject; job: ScriptJob }>('/api/scripts/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, title: title.trim() || undefined, productionProjectId: currentProjectId || undefined })
      });
      setIdea('');
      setActiveProjectId(data.project.id);
      setActiveJob(data.job);
      setMessage({ type: 'info', text: '创意已提交，正在扩写并生成分镜表。' });
      await loadProjects();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '创意提交失败。' });
    }
  }

  function updateDraft(rowId: string, key: keyof ScriptBreakdownRow, value: string) {
    setDraftRows((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [key]: value } }));
    setDirtyRows((prev) => ({ ...prev, [rowId]: true }));
    setSavingRows((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }

  async function saveRow(rowId: string) {
    const row = draftRows[rowId];
    if (!project || !row) return;
    setSavingRows((prev) => ({ ...prev, [rowId]: 'saving' }));
    const payload = editableFields.reduce((record, field) => ({ ...record, [field.key]: (row as any)[field.key] || '' }), {
      sourceText: row.sourceText || '',
      confidence: row.confidence,
      updatedAt: row.updatedAt,
      version: row.version
    } as Record<string, any>);
    try {
      const data = await apiJson<{ row: ScriptBreakdownRow }>(`/api/scripts/projects/${project.id}/rows/${rowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setRows((prev) => prev.map((item) => item.id === rowId ? data.row : item));
      setDraftRows((prev) => ({ ...prev, [rowId]: data.row }));
      setDirtyRows((prev) => ({ ...prev, [rowId]: false }));
      setSavingRows((prev) => ({ ...prev, [rowId]: 'saved' }));
    } catch (error) {
      setSavingRows((prev) => ({ ...prev, [rowId]: 'error' }));
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存失败。' });
    }
  }

  async function regenerate(rowId: string | null, mode: 'image' | 'video' | 'both') {
    if (!project) return;
    if (hasUnsavedRows) {
      setMessage({ type: 'error', text: '存在未保存编辑，请先保存后再重新生成或导出。' });
      return;
    }
    const url = rowId
      ? `/api/scripts/projects/${project.id}/rows/${rowId}/regenerate`
      : `/api/scripts/projects/${project.id}/regenerate`;
    try {
      const data = await apiJson<{ job: ScriptJob }>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      setActiveJob(data.job);
      setMessage({ type: 'info', text: '提示词重新生成任务已提交。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '任务创建失败。' });
    }
  }

  async function exportExcel() {
    if (!project) return;
    if (hasUnsavedRows) {
      setMessage({ type: 'error', text: '存在未保存编辑，请先保存再导出 Excel。' });
      return;
    }
    try {
      const data = await apiJson<{ job: ScriptJob }>(`/api/scripts/projects/${project.id}/export`, { method: 'POST' });
      setActiveJob(data.job);
      setMessage({ type: 'info', text: 'Excel 正在后端生成。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '导出失败。' });
    }
  }

  async function confirmDeleteProject() {
    if (!deleteTarget) return;
    setIsDeletingProject(true);
    setMessage(null);
    try {
      await apiJson<{ deleted: { id: string } }>(`/api/scripts/projects/${deleteTarget.id}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      if (activeProjectId === deleteTarget.id) {
        setActiveProjectId(null);
        setProject(null);
        setRows([]);
        setDraftRows({});
        setDirtyRows({});
        setSavingRows({});
      }
      setDeleteTarget(null);
      setMessage({ type: 'success', text: '剧本项目已删除，相关记录和文件痕迹已清理。' });
      await loadProjects(true);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '删除失败。' });
    } finally {
      setIsDeletingProject(false);
    }
  }

  function buildScriptAssetText() {
    const activeRows = rows.map((sourceRow) => draftRows[sourceRow.id] || sourceRow);
    const header = [
      `项目：${project?.title || '未命名剧本项目'}`,
      `版本：${project?.currentVersion || 1}`,
      `行数：${activeRows.length}`,
      ''
    ];
    const body = activeRows.map((row) => [
      `# ${row.orderIndex}. ${row.shot || row.sourceText || '未命名镜头'}`,
      `景别：${row.shotSize || '-'}`,
      `运镜：${row.cameraMovement || '-'}`,
      `角色：${row.characters || '-'}`,
      `场景：${row.scene || '-'}`,
      `动作：${row.action || '-'}`,
      `对白/旁白：${row.dialogueOrVoiceover || '-'}`,
      `分镜图提示词：${row.storyboardImagePrompt || '-'}`,
      `分镜视频提示词：${row.storyboardVideoPrompt || '-'}`
    ].join('\n')).join('\n\n');
    return `${header.join('\n')}${body}`.trim();
  }

  async function saveScriptAsProductionAsset(submitReview: boolean) {
    if (!currentProjectId) {
      setMessage({ type: 'error', text: '请先在工作台选择或创建团队项目，再保存生产资产。' });
      return;
    }
    if (!project || rows.length === 0) {
      setMessage({ type: 'error', text: '当前没有可保存的剧本分镜表。' });
      return;
    }
    if (hasUnsavedRows) {
      setMessage({ type: 'error', text: '存在未保存编辑，请先保存行内容再保存生产资产。' });
      return;
    }

    const text = buildScriptAssetText();
    setAssetSavingMode(submitReview ? 'submit' : 'save');
    setMessage({ type: 'info', text: submitReview ? '正在保存剧本资产并提交审核...' : '正在保存剧本资产...' });
    try {
      const asset = await createProductionAsset({
        projectId: currentProjectId,
        stage: 'SCRIPT_01',
        originalName: `${project.title || '剧本分镜表'}-v${project.currentVersion || 1}.txt`,
        description: `剧本结构化分镜表，共 ${rows.length} 行。`,
        mimeType: 'text/plain',
        sizeBytes: new TextEncoder().encode(text).length,
        sourceType: 'script_editor_breakdown',
        sourceId: project.id,
        sourcePayload: {
          text,
          scriptProjectId: project.id,
          scriptProjectTitle: project.title,
          currentVersion: project.currentVersion,
          rows: rows.map((sourceRow) => draftRows[sourceRow.id] || sourceRow),
          exportedAt: new Date().toISOString()
        },
        metadata: {
          savedFrom: 'ScriptEditor',
          stageName: 'SCRIPT_01',
          rowCount: rows.length
        }
      });
      const finalAsset = submitReview ? await submitProductionAssetReview(asset.id) : asset;
      if (user) {
        const historyItem = await savePromptHistoryItem({
          featureMode: 'script',
          outputType: 'script',
          input: project.title || '02剧本',
          output: text,
          attachments: [],
          model: 'script-workbench',
          projectId: currentProjectId,
          projectTitle: project.title,
          source: submitReview ? 'script_submit_review' : 'script_save_asset'
        }, user.uid);
        setHistory((prev) => [historyItem, ...prev].slice(0, 100));
      }
      window.dispatchEvent(new CustomEvent('jiying:production-assets-changed', { detail: { assetId: finalAsset.id, stage: finalAsset.stage } }));
      setMessage({ type: 'success', text: finalAsset.reviewStatus === 'IN_REVIEW' ? '剧本资产已保存并提交审核。' : '剧本资产已保存到个人资产。' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存生产资产失败。' });
    } finally {
      setAssetSavingMode(null);
    }
  }

  return (
    <div className="flex-1 overflow-hidden bg-[#030303] text-zinc-100 flex flex-col">
      <div className="border-b border-white/10 bg-[#080808] px-5 py-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyan-300">
              <span className="h-2 w-2 rounded-full bg-cyan-300" />
              01 剧本结构化工作台
            </div>
            <h2 className="mt-1 text-lg font-bold tracking-wide text-white">剧本导入、创意扩写、分镜表编辑与 Excel 导出</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void saveScriptAsProductionAsset(false)} disabled={!project || rows.length === 0 || hasUnsavedRows || !currentProjectId || Boolean(assetSavingMode)} className="h-9 px-3 rounded-md border border-cyan-400/30 bg-cyan-400/10 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-40 flex items-center gap-2" title={currentProjectId ? '保存到个人剧本资产' : '请先选择团队项目'}>
              {assetSavingMode === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 保存资产
            </button>
            <button onClick={() => void saveScriptAsProductionAsset(true)} disabled={!project || rows.length === 0 || hasUnsavedRows || !currentProjectId || Boolean(assetSavingMode)} className="h-9 px-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-40 flex items-center gap-2" title={currentProjectId ? '保存并提交团队审核' : '请先选择团队项目'}>
              {assetSavingMode === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} 保存并提审
            </button>
            <button onClick={() => void regenerate(null, 'both')} disabled={!project || hasUnsavedRows} className="h-9 px-3 rounded-md border border-white/10 bg-white/5 text-xs hover:bg-white/10 disabled:opacity-40 flex items-center gap-2">
              <RefreshCcw className="h-4 w-4" /> 批量重生成
            </button>
            <button onClick={exportExcel} disabled={!project || hasUnsavedRows} className="h-9 px-3 rounded-md bg-white text-black text-xs font-bold hover:bg-zinc-200 disabled:opacity-40 flex items-center gap-2">
              <Download className="h-4 w-4" /> 导出 Excel
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-r border-white/10 bg-[#070707] p-4 overflow-y-auto custom-scrollbar">
          <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2">项目标题</label>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可选：输入项目名" className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs outline-none focus:border-cyan-400/60" />

          <div className="mt-4 grid grid-cols-2 gap-2">
            <input ref={fileInputRef} type="file" accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(event) => void handleUpload(event.target.files?.[0])} />
            <button onClick={() => fileInputRef.current?.click()} className="h-10 rounded-md border border-cyan-400/30 bg-cyan-400/10 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/15 flex items-center justify-center gap-2">
              <FileUp className="h-4 w-4" /> 上传
            </button>
            <button onClick={handleIdeaSubmit} className="h-10 rounded-md border border-amber-300/30 bg-amber-300/10 text-xs font-semibold text-amber-100 hover:bg-amber-300/15 flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4" /> 扩写
            </button>
          </div>
          <textarea value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="输入一句想法或一段创意，系统会扩写剧情并生成分镜表。" className="mt-3 h-28 w-full resize-none rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs leading-5 outline-none focus:border-amber-300/60" />

          {activeJob && (
            <div className="mt-4 rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-zinc-400">
                <span>{activeJob.status}</span>
                <span>{activeJob.progress || 0}%</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-cyan-300 transition-all" style={{ width: `${activeJob.progress || 5}%` }} />
              </div>
              <p className="mt-2 text-xs text-zinc-300">{activeJob.errorMessage || activeJob.message || '任务处理中'}</p>
            </div>
          )}

          {message && (
            <div className={`mt-4 rounded-md border px-3 py-2 text-xs leading-5 ${message.type === 'error' ? 'border-red-500/30 bg-red-950/30 text-red-100' : message.type === 'success' ? 'border-emerald-500/30 bg-emerald-950/30 text-emerald-100' : 'border-cyan-400/30 bg-cyan-950/30 text-cyan-100'}`}>
              {message.text}
            </div>
          )}

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-zinc-500">剧本工作项目</div>
            <div className="space-y-2">
              {projects.map((item) => (
                <div key={item.id} className={`group flex items-stretch rounded-md border transition ${item.id === activeProjectId ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                  <button onClick={() => setActiveProjectId(item.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
                    <div className="truncate text-xs font-semibold text-white">{item.title}</div>
                    <div className="mt-1 flex justify-between text-[10px] font-mono text-zinc-500">
                      <span>{item.sourceType === 'FILE' ? '文件' : '创意'}</span>
                      <span>{item.status}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteTarget(item);
                    }}
                    className="w-9 shrink-0 border-l border-white/10 text-zinc-600 opacity-60 transition hover:bg-red-950/30 hover:text-red-300 group-hover:opacity-100"
                    title="删除项目"
                  >
                    <Trash2 className="mx-auto h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {projects.length === 0 && <div className="text-xs text-zinc-500">暂无剧本项目。</div>}
            </div>
          </div>
        </aside>

        <main className="min-w-0 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-white">{project?.title || '请选择或创建剧本项目'}</h3>
              {project && <p className="text-[10px] font-mono text-zinc-500">版本 {project.currentVersion} / 状态 {project.status} / 行数 {rows.length}</p>}
            </div>
            {project?.errorMessage && <div className="text-xs text-red-300">{project.errorMessage}</div>}
          </div>

          <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
            {rows.length > 0 ? (
              <table className="min-w-[2600px] w-full border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#111] text-zinc-300">
                  <tr>
                    <th className="w-24 border-b border-r border-white/10 px-2 py-2 text-left">操作</th>
                    {fields.map((field) => (
                      <th key={field.key} className={`${field.key === 'orderIndex' ? 'w-16' : longFields.has(String(field.key)) ? 'w-72' : 'w-36'} border-b border-r border-white/10 px-2 py-2 text-left font-semibold`}>{field.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((sourceRow) => {
                    const row = draftRows[sourceRow.id] || sourceRow;
                    return (
                      <tr key={row.id} className="odd:bg-white/[0.015] hover:bg-white/[0.04]">
                        <td className="sticky left-0 z-[5] border-b border-r border-white/10 bg-[#090909] p-2 align-top">
                          <div className="flex flex-col gap-1">
                            <button onClick={() => void saveRow(row.id)} disabled={!dirtyRows[row.id] || savingRows[row.id] === 'saving'} title="保存整行" className="h-7 rounded border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40 flex items-center justify-center">
                              {savingRows[row.id] === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => void regenerate(row.id, 'image')} title="重新生成分镜图提示词" className="h-7 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-[10px]">图</button>
                            <button onClick={() => void regenerate(row.id, 'video')} title="重新生成分镜视频提示词" className="h-7 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-[10px]">视</button>
                          </div>
                          <div className="mt-1 text-[10px] text-zinc-500">{savingRows[row.id] === 'saved' ? '已保存' : savingRows[row.id] === 'error' ? '失败' : dirtyRows[row.id] ? '未保存' : ''}</div>
                        </td>
                        {fields.map((field) => {
                          const value = (row as any)[field.key] ?? '';
                          if (field.key === 'orderIndex') {
                            return <td key={field.key} className="border-b border-r border-white/10 px-2 py-2 align-top font-mono text-zinc-400">{value}</td>;
                          }
                          return (
                            <td key={field.key} className="border-b border-r border-white/10 p-1 align-top">
                              <textarea
                                value={value}
                                onChange={(event) => updateDraft(row.id, field.key as keyof ScriptBreakdownRow, event.target.value)}
                                className={`w-full resize-none rounded border border-transparent bg-transparent px-2 py-1 leading-5 text-zinc-100 outline-none focus:border-cyan-400/50 focus:bg-black/30 ${longFields.has(String(field.key)) ? 'h-24' : 'h-14'}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-zinc-500">
                <div>
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]"><Sparkles className="h-5 w-5 text-cyan-300" /></div>
                  <p>上传 txt/docx/pdf，或输入创意开始生成结构化分镜表。</p>
                  <p className="mt-2 text-xs">所有编辑都会保存到后端，导出 Excel 以数据库当前版本为准。</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-red-500/30 bg-[#101010] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-red-300">二次确认删除</div>
                <h3 className="mt-1 text-base font-bold text-white">删除剧本工作项目</h3>
              </div>
              <button onClick={() => setDeleteTarget(null)} disabled={isDeletingProject} className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-white disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="py-4 text-sm leading-6 text-zinc-300">
              确认删除「<span className="font-semibold text-white">{deleteTarget.title}</span>」？该操作会清理项目、分镜表、版本、任务记录以及关联的源文件/导出文件，删除后不可恢复。
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} disabled={isDeletingProject} className="h-9 rounded-md border border-white/10 px-4 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40">
                取消
              </button>
              <button onClick={confirmDeleteProject} disabled={isDeletingProject} className="h-9 rounded-md bg-red-500 px-4 text-xs font-bold text-white hover:bg-red-400 disabled:opacity-50 flex items-center gap-2">
                {isDeletingProject && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
