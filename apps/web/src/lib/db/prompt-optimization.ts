import type { PromptOptimizationProfile, PromptOptimizationProfileKey } from '../../types';
import { apiFetch, apiJson } from '../api';

export async function fetchPromptOptimizationProfiles(): Promise<PromptOptimizationProfile[]> {
  const data = await apiFetch<{ profiles?: PromptOptimizationProfile[] }>('/api/prompt-optimization/profiles');
  return Array.isArray(data.profiles) ? data.profiles : [];
}

export async function savePromptOptimizationProfile(input: {
  key: PromptOptimizationProfileKey;
  systemPrompt: string;
  isEnabled?: boolean;
}): Promise<PromptOptimizationProfile> {
  const data = await apiJson<{ profile: PromptOptimizationProfile }>(
    `/api/prompt-optimization/profiles/${encodeURIComponent(input.key)}`,
    {
      systemPrompt: input.systemPrompt,
      isEnabled: input.isEnabled
    },
    { method: 'PUT' }
  );
  return data.profile;
}

export async function resetPromptOptimizationProfile(key: PromptOptimizationProfileKey): Promise<PromptOptimizationProfile> {
  const data = await apiJson<{ profile: PromptOptimizationProfile }>(
    `/api/prompt-optimization/profiles/${encodeURIComponent(key)}/reset`,
    {}
  );
  return data.profile;
}
