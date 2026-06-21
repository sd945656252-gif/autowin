import type { InternalAssetItem, ProductionAsset, ProductionAssetSnapshot, ProductionStage } from '../../types';
import { apiFetch, apiJson } from '../api';

export async function fetchProductionAssets(input: {
  scope: 'personal' | 'team';
  projectId?: string | null;
  stage?: ProductionStage;
  query?: string;
}): Promise<ProductionAsset[]> {
  const data = await apiFetch<{ assets?: ProductionAsset[] }>(
    input.scope === 'personal' ? '/api/production-assets/personal' : '/api/production-assets/team',
    {
      query: {
        projectId: input.projectId || undefined,
        stage: input.stage,
        query: input.query || undefined
      }
    }
  );
  return Array.isArray(data.assets) ? data.assets : [];
}

export async function fetchTeamAssetLibrary(input: {
  projectId?: string | null;
  stage?: ProductionStage | 'all';
  type?: 'all' | 'image' | 'video' | 'audio' | 'document';
  query?: string;
} = {}): Promise<ProductionAsset[]> {
  const data = await apiFetch<{ assets?: ProductionAsset[] }>('/api/production-assets/team-library', {
    query: {
      projectId: input.projectId || undefined,
      stage: input.stage && input.stage !== 'all' ? input.stage : undefined,
      type: input.type && input.type !== 'all' ? input.type : undefined,
      query: input.query || undefined
    }
  });
  return Array.isArray(data.assets) ? data.assets : [];
}

export async function createProductionAsset(input: {
  projectId: string;
  stage: ProductionStage;
  originalName: string;
  description?: string;
  mediaAssetId?: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceType?: string;
  sourceId?: string;
  sourcePayload?: Record<string, any>;
  metadata?: Record<string, any>;
}): Promise<ProductionAsset> {
  const data = await apiJson<{ asset: ProductionAsset }>('/api/production-assets', input);
  return data.asset;
}

export async function submitProductionAssetReview(assetId: string): Promise<ProductionAsset> {
  const data = await apiJson<{ asset: ProductionAsset }>(`/api/production-assets/${encodeURIComponent(assetId)}/submit-review`, {});
  return data.asset;
}

export async function deleteProductionAsset(assetId: string): Promise<ProductionAsset> {
  const data = await apiFetch<{ asset: ProductionAsset }>(`/api/production-assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
  return data.asset;
}

export async function fetchInternalAssets(input: {
  reviewStatus?: ProductionAsset['reviewStatus'];
  projectId?: string | null;
  stage?: ProductionStage;
  search?: string;
} = {}): Promise<InternalAssetItem[]> {
  const data = await apiFetch<{ items?: InternalAssetItem[] }>('/api/internal-assets', {
    query: {
      reviewStatus: input.reviewStatus,
      projectId: input.projectId || undefined,
      stage: input.stage,
      search: input.search || undefined
    }
  });
  return Array.isArray(data.items) ? data.items : [];
}

export async function approveInternalAssetSnapshot(snapshotId: string, note?: string): Promise<{
  snapshot: ProductionAssetSnapshot;
  asset: ProductionAsset;
  teamAsset: ProductionAsset;
}> {
  return apiJson(`/api/internal-assets/${encodeURIComponent(snapshotId)}/approve`, { note: note || undefined });
}

export async function rejectInternalAssetSnapshot(snapshotId: string, note?: string): Promise<{
  snapshot: ProductionAssetSnapshot;
  asset: ProductionAsset;
}> {
  return apiJson(`/api/internal-assets/${encodeURIComponent(snapshotId)}/reject`, { note: note || undefined });
}
