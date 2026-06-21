import type { EditingAsset, EditingProject, EditingTimeline } from '../../types';
import { apiFetch, apiJson } from '../api';

export async function fetchEditingProjects(input: { productionProjectId?: string | null } = {}): Promise<EditingProject[]> {
  const data = await apiFetch<{ projects?: EditingProject[] }>('/api/editing-projects', {
    query: { productionProjectId: input.productionProjectId || undefined }
  });
  return Array.isArray(data.projects) ? data.projects : [];
}

export async function createEditingProject(title?: string, input: { productionProjectId?: string | null } = {}): Promise<EditingProject> {
  const data = await apiJson<{ project: EditingProject }>('/api/editing-projects', {
    title: title || '未命名剪辑工程',
    productionProjectId: input.productionProjectId || undefined
  });
  return data.project;
}

export async function fetchEditingProject(projectId: string): Promise<EditingProject> {
  const data = await apiFetch<{ project: EditingProject }>(`/api/editing-projects/${encodeURIComponent(projectId)}`);
  return data.project;
}

export async function saveEditingTimeline(projectId: string, timeline: EditingTimeline): Promise<EditingProject> {
  const data = await apiJson<{ project: EditingProject }>(`/api/editing-projects/${encodeURIComponent(projectId)}/timeline`, { timeline }, { method: 'PUT' });
  return data.project;
}

export async function fetchEditingAssets(projectId: string): Promise<EditingAsset[]> {
  const data = await apiFetch<{ assets?: EditingAsset[] }>(`/api/editing-projects/${encodeURIComponent(projectId)}/assets`);
  return Array.isArray(data.assets) ? data.assets : [];
}
