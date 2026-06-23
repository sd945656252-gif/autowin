import type { CustomApiConfig, ModelCapabilityProfile, OfficialCapabilityUrlProbe } from '../../types';
import { apiFetch, apiJson } from '../api';

export async function fetchCustomApiConfigs(userId?: string): Promise<CustomApiConfig[]> {
  if (!userId || userId === 'guest') return [];
  try {
    const data = await apiFetch<{ configs?: CustomApiConfig[] }>('/api/custom-api-configs', {
      query: { userId: userId || 'guest' }
    });
    return Array.isArray(data.configs) ? data.configs : [];
  } catch (e) {
    console.warn('Custom API config fetch failed:', e);
    return [];
  }
}

export async function fetchTextGeneratorModels(): Promise<CustomApiConfig[]> {
  const data = await apiFetch<{ models?: CustomApiConfig[] }>('/api/model-configs', {
    query: { capability: 'TEXT_GENERATOR' }
  });
  return Array.isArray(data.models) ? data.models : [];
}

export async function fetchModelCapabilities(capability: 'IMAGE_GENERATOR' | 'VIDEO_GENERATOR' | 'TEXT_GENERATOR'): Promise<ModelCapabilityProfile[]> {
  const data = await apiFetch<{ capabilities?: ModelCapabilityProfile[] }>('/api/model-capabilities', {
    query: { capability }
  });
  return Array.isArray(data.capabilities) ? data.capabilities : [];
}

export async function syncOfficialCapabilityJson(canonicalModelId?: string): Promise<ModelCapabilityProfile[]> {
  const path = canonicalModelId
    ? `/api/model-capabilities/${encodeURIComponent(canonicalModelId)}/sync-official`
    : '/api/model-capabilities/sync-official-json';
  const data = await apiJson<{ results?: { capability: ModelCapabilityProfile }[] }>(path, {});
  return Array.isArray(data.results) ? data.results.map((item) => item.capability).filter(Boolean) : [];
}

export async function probeOfficialCapabilityUrl(input: {
  url: string;
  canonicalModelId?: string;
  capability?: 'IMAGE_GENERATOR' | 'VIDEO_GENERATOR' | 'TEXT_GENERATOR';
}): Promise<OfficialCapabilityUrlProbe> {
  const data = await apiJson<{ probe: OfficialCapabilityUrlProbe }>('/api/model-capabilities/probe-official-url', input);
  return data.probe;
}

export async function saveModelCapabilityRevision(input: {
  canonicalModelId: string;
  capability: 'IMAGE_GENERATOR' | 'VIDEO_GENERATOR' | 'TEXT_GENERATOR';
  params: Record<string, any>;
  verificationStatus?: 'VERIFIED' | 'UNVERIFIED' | 'MANUAL_VERIFIED' | 'DEPRECATED';
  sourceUrls?: string[];
  changedSummary?: string;
}): Promise<ModelCapabilityProfile> {
  const data = await apiJson<{ capability: ModelCapabilityProfile }>(
    `/api/model-capabilities/${encodeURIComponent(input.canonicalModelId)}/revisions`,
    {
      capability: input.capability,
      params: input.params,
      verificationStatus: input.verificationStatus,
      sourceUrls: input.sourceUrls,
      changedSummary: input.changedSummary
    }
  );
  return data.capability;
}

export async function saveCustomApiConfig(config: CustomApiConfig, userId?: string): Promise<CustomApiConfig | null> {
  if (!userId || userId === 'guest') return null;
  try {
    const payload: Record<string, any> = { ...config, userId: userId || 'guest' };
    const isDraft = typeof payload.id === 'string' && payload.id.startsWith('draft_');
    if (isDraft) delete payload.id;
    if (typeof payload.apiKey === 'string' && payload.apiKey.trim() === '') {
      delete payload.apiKey;
    }
    const data = await apiJson<{ config?: CustomApiConfig }>(
      isDraft ? '/api/custom-api-configs' : `/api/custom-api-configs/${encodeURIComponent(config.id)}`,
      payload,
      { method: isDraft ? 'POST' : 'PUT' }
    );
    return data.config || null;
  } catch (e) {
    console.warn('Custom API config save failed: ', e);
    throw e;
  }
}

export async function deleteCustomApiConfig(configId: string, userId?: string): Promise<void> {
  if (!userId || userId === 'guest') return;
  try {
    await apiFetch(`/api/custom-api-configs/${encodeURIComponent(configId)}`, {
      method: 'DELETE',
      query: { userId: userId || 'guest' }
    });
  } catch (e) {
    console.warn('Custom API config delete failed: ', e);
    throw e;
  }
}
