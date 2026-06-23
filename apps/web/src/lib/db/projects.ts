import type {
  InternalAssetItem,
  ProductionAsset,
  ProductionAssetSnapshot,
  ProductionStage,
  SlashAssetResolveResult,
  SlashProductionAsset,
  TeamMemberCandidate,
  TeamProject,
  TeamProjectMember
} from '../../types';
import { apiFetch, apiJson } from '../api';

export async function fetchTeamProjects(input: { projectKind?: 'PERSONAL' | 'TEAM' } = {}): Promise<TeamProject[]> {
  const data = await apiFetch<{ projects?: TeamProject[] }>('/api/team-projects', {
    query: { projectKind: input.projectKind }
  });
  return Array.isArray(data.projects) ? data.projects : [];
}

export async function createTeamProject(input: {
  name: string;
  description?: string;
  projectKind?: 'PERSONAL' | 'TEAM';
  workflowType?: string;
}): Promise<TeamProject> {
  const data = await apiJson<{ project: TeamProject }>('/api/team-projects', {
    name: input.name,
    description: input.description || undefined,
    projectKind: input.projectKind || 'TEAM',
    workflowType: input.workflowType || undefined
  });
  return data.project;
}

export async function renameTeamProject(projectId: string, name: string): Promise<TeamProject> {
  const data = await apiJson<{ project: TeamProject }>(`/api/team-projects/${encodeURIComponent(projectId)}`, { name }, { method: 'PATCH' });
  return data.project;
}

export async function deleteTeamProject(projectId: string): Promise<void> {
  await apiFetch(`/api/team-projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export async function fetchTeamProjectMembers(projectId: string): Promise<TeamProjectMember[]> {
  const data = await apiFetch<{ members?: TeamProjectMember[] }>(`/api/team-projects/${encodeURIComponent(projectId)}/members`);
  return Array.isArray(data.members) ? data.members : [];
}

export async function searchTeamMemberCandidates(projectId: string, query: string): Promise<TeamMemberCandidate[]> {
  if (!query.trim()) return [];
  const data = await apiFetch<{ users?: TeamMemberCandidate[] }>(`/api/team-projects/${encodeURIComponent(projectId)}/member-candidates`, {
    query: { query }
  });
  return Array.isArray(data.users) ? data.users : [];
}

export async function addTeamProjectMember(projectId: string, userId: string, role: 'OWNER' | 'MEMBER' = 'MEMBER'): Promise<TeamProjectMember> {
  const data = await apiJson<{ member: TeamProjectMember }>(`/api/team-projects/${encodeURIComponent(projectId)}/members`, { userId, role });
  return data.member;
}

export async function removeTeamProjectMember(projectId: string, userId: string): Promise<void> {
  await apiFetch(`/api/team-projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export async function grantProjectDeveloper(projectId: string, userId: string, expiresAt?: string | null): Promise<void> {
  await apiJson(`/api/team-projects/${encodeURIComponent(projectId)}/team-leaders`, { userId, expiresAt: expiresAt || undefined });
}

export async function revokeProjectDeveloper(projectId: string, userId: string): Promise<void> {
  await apiFetch(`/api/team-projects/${encodeURIComponent(projectId)}/team-leaders/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export async function swapTeamProjectLeader(projectId: string, fromUserId: string, toUserId: string): Promise<void> {
  await apiJson(`/api/team-projects/${encodeURIComponent(projectId)}/team-leaders/swap`, { fromUserId, toUserId });
}

export async function fetchTeamProjectAssets(input: {
  projectId: string;
  view?: 'team' | 'review';
  reviewStatus?: ProductionAsset['reviewStatus'];
  stage?: ProductionStage;
  search?: string;
}): Promise<{ items: InternalAssetItem[]; canManage: boolean; mode: 'team' | 'review' }> {
  const data = await apiFetch<{ items?: InternalAssetItem[]; canManage?: boolean; mode?: 'team' | 'review' }>(
    `/api/team-projects/${encodeURIComponent(input.projectId)}/assets`,
    {
      query: {
        view: input.view || 'team',
        reviewStatus: input.reviewStatus,
        stage: input.stage,
        search: input.search || undefined
      }
    }
  );
  return {
    items: Array.isArray(data.items) ? data.items : [],
    canManage: Boolean(data.canManage),
    mode: data.mode || input.view || 'team'
  };
}

export async function approveTeamProjectAssetSnapshot(projectId: string, snapshotId: string, note?: string): Promise<{
  snapshot: ProductionAssetSnapshot;
  asset: ProductionAsset;
  teamAsset: ProductionAsset;
}> {
  return apiJson(`/api/team-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(snapshotId)}/approve`, { note: note || undefined });
}

export async function rejectTeamProjectAssetSnapshot(projectId: string, snapshotId: string, note?: string): Promise<{
  snapshot: ProductionAssetSnapshot;
  asset: ProductionAsset;
}> {
  return apiJson(`/api/team-projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(snapshotId)}/reject`, { note: note || undefined });
}

export async function fetchSlashAssets(input: {
  projectId: string;
  fromStage: ProductionStage;
  query?: string;
}): Promise<{
  fromStage: ProductionStage;
  sourceStage: ProductionStage | null;
  insertMode?: string | null;
  assets: SlashProductionAsset[];
}> {
  const data = await apiFetch<{
    fromStage: ProductionStage;
    sourceStage: ProductionStage | null;
    insertMode?: string | null;
    assets?: SlashProductionAsset[];
  }>(`/api/team-projects/${encodeURIComponent(input.projectId)}/slash-assets`, {
    query: {
      fromStage: input.fromStage,
      query: input.query || undefined
    }
  });
  return {
    fromStage: data.fromStage,
    sourceStage: data.sourceStage,
    insertMode: data.insertMode,
    assets: Array.isArray(data.assets) ? data.assets : []
  };
}

export async function resolveSlashAsset(input: {
  projectId: string;
  fromStage: ProductionStage;
  assetId: string;
  snapshotId?: string | null;
  rowNumber?: number | null;
  field?: string | null;
  insertMode?: 'TEXT_CONTENT' | 'ATTACHMENT_REFERENCE' | 'IMPORT_TO_EDIT_BIN';
}): Promise<SlashAssetResolveResult> {
  const data = await apiJson<{ resolved: SlashAssetResolveResult }>(
    `/api/team-projects/${encodeURIComponent(input.projectId)}/slash-assets/resolve`,
    {
      fromStage: input.fromStage,
      assetId: input.assetId,
      snapshotId: input.snapshotId || undefined,
      rowNumber: input.rowNumber || undefined,
      field: input.field || undefined,
      insertMode: input.insertMode || undefined
    }
  );
  return data.resolved;
}
