import type { HistoryItem, SavedPrompt } from '../../types';
import { apiFetch, apiJson } from '../api';

function parseHistoryItem(item: any): HistoryItem {
  return {
    ...item,
    timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
    attachments: Array.isArray(item.attachments) ? item.attachments : []
  } as HistoryItem;
}

function parseSavedPrompt(item: any): SavedPrompt {
  return {
    ...item,
    timestamp: item.timestamp ? new Date(item.timestamp) : new Date()
  } as SavedPrompt;
}

export async function fetchPromptHistory(userId?: string): Promise<HistoryItem[]> {
  if (!userId || userId === 'guest') return [];
  try {
    const data = await apiFetch<{ items?: any[] }>('/api/prompt-history', {
      query: { userId: userId || 'guest' }
    });
    return Array.isArray(data.items) ? data.items.map(parseHistoryItem) : [];
  } catch (e) {
    console.warn('Prompt history fetch failed:', e);
    return [];
  }
}

export async function savePromptHistoryItem(item: Partial<HistoryItem> & Record<string, any>, userId?: string): Promise<HistoryItem> {
  if (!userId || userId === 'guest') return parseHistoryItem({ ...item, id: item.id || `local-${Date.now()}`, timestamp: new Date() });
  const data = await apiJson<{ item: any }>('/api/prompt-history', { ...item, userId: userId || 'guest' });
  return parseHistoryItem(data.item);
}

export async function deletePromptHistoryItem(itemId: string): Promise<void> {
  if (itemId.startsWith('local-')) return;
  await apiFetch(`/api/prompt-history/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
}

export async function clearPromptHistory(userId?: string): Promise<void> {
  if (!userId || userId === 'guest') return;
  await apiFetch('/api/prompt-history', { method: 'DELETE', query: { userId: userId || 'guest' } });
}

export async function fetchSavedPrompts(userId?: string): Promise<SavedPrompt[]> {
  if (!userId || userId === 'guest') return [];
  try {
    const data = await apiFetch<{ prompts?: any[] }>('/api/saved-prompts', {
      query: { userId: userId || 'guest' }
    });
    return Array.isArray(data.prompts) ? data.prompts.map(parseSavedPrompt) : [];
  } catch (e) {
    console.warn('Saved prompts fetch failed:', e);
    return [];
  }
}

export async function saveSavedPrompt(prompt: Pick<SavedPrompt, 'title' | 'content'>, userId?: string): Promise<SavedPrompt> {
  if (!userId || userId === 'guest') return parseSavedPrompt({ ...prompt, id: `local-${Date.now()}`, timestamp: new Date() });
  const data = await apiJson<{ prompt: any }>('/api/saved-prompts', { ...prompt, userId: userId || 'guest' });
  return parseSavedPrompt(data.prompt);
}

export async function deleteSavedPrompt(promptId: string): Promise<void> {
  if (promptId.startsWith('local-')) return;
  await apiFetch(`/api/saved-prompts/${encodeURIComponent(promptId)}`, { method: 'DELETE' });
}
