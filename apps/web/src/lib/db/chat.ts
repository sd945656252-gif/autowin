import type {
  ChatMessage,
  PipelineAssistantAction,
  PipelineAssistantMessage,
  ProductionStage
} from '../../types';
import { apiFetch, apiJson, getAuthHeaders } from '../api';

export async function fetchChatLogs(stageId: string, userId?: string, projectId?: string | null): Promise<ChatMessage[]> {
  if (!userId || userId === 'guest') return [];
  try {
    const data = await apiFetch<{ messages?: ChatMessage[] }>('/api/chat', {
      query: { nodeId: stageId, userId: userId || 'guest', projectId: projectId || undefined }
    });
    return Array.isArray(data.messages) ? data.messages : [];
  } catch (e) {
    console.warn('Chat log API fetch failed:', e);
    return [];
  }
}

export async function saveChatMessage(stageId: string, msg: ChatMessage, userId?: string, projectId?: string | null): Promise<void> {
  if (!userId || userId === 'guest') return;
  try {
    await apiJson('/api/chat', {
      userId: userId || 'guest',
      nodeId: stageId,
      projectId: projectId || undefined,
      role: msg.sender === 'ai' ? 'assistant' : 'user',
      text: msg.text
    });
  } catch (e) {
    console.warn('Chat log API save failed:', e);
  }
}

export async function fetchPipelineAssistantMessages(input: {
  projectId?: string | null;
  stage: ProductionStage;
}): Promise<PipelineAssistantMessage[]> {
  const data = await apiFetch<{ messages?: PipelineAssistantMessage[] }>(
    `/api/pipeline/${encodeURIComponent(input.projectId || 'guest')}/stages/${encodeURIComponent(input.stage)}/assistant/messages`
  );
  return Array.isArray(data.messages) ? data.messages : [];
}

export async function fetchPipelineAssistantContext(input: {
  projectId?: string | null;
  stage: ProductionStage;
}): Promise<Record<string, any>> {
  const data = await apiFetch<{ context?: Record<string, any> }>(
    `/api/pipeline/${encodeURIComponent(input.projectId || 'guest')}/stages/${encodeURIComponent(input.stage)}/assistant/context`
  );
  return data.context || {};
}

export async function sendPipelineAssistantMessage(input: {
  projectId?: string | null;
  stage: ProductionStage;
  text: string;
  customModelId?: string;
  panel?: string | null;
  selection?: Record<string, any> | null;
}): Promise<{ message: PipelineAssistantMessage; actions: PipelineAssistantAction[] }> {
  return apiJson(
    `/api/pipeline/${encodeURIComponent(input.projectId || 'guest')}/stages/${encodeURIComponent(input.stage)}/assistant/messages`,
    {
      text: input.text,
      customModelId: input.customModelId,
      panel: input.panel || undefined,
      selection: input.selection || undefined
    }
  );
}

export async function confirmPipelineAssistantAction(input: {
  projectId?: string | null;
  stage: ProductionStage;
  actionId: string;
}): Promise<PipelineAssistantAction> {
  const data = await apiJson<{ action: PipelineAssistantAction }>(
    `/api/pipeline/${encodeURIComponent(input.projectId || 'guest')}/stages/${encodeURIComponent(input.stage)}/assistant/actions/${encodeURIComponent(input.actionId)}/confirm`,
    {}
  );
  return data.action;
}

export async function rejectPipelineAssistantAction(input: {
  projectId?: string | null;
  stage: ProductionStage;
  actionId: string;
}): Promise<PipelineAssistantAction> {
  const data = await apiJson<{ action: PipelineAssistantAction }>(
    `/api/pipeline/${encodeURIComponent(input.projectId || 'guest')}/stages/${encodeURIComponent(input.stage)}/assistant/actions/${encodeURIComponent(input.actionId)}/reject`,
    {}
  );
  return data.action;
}

export async function uploadPipelineAssistantAttachment(input: {
  projectId?: string | null;
  stage: ProductionStage;
  file: File;
}): Promise<{ message: PipelineAssistantMessage; action: PipelineAssistantAction }> {
  const formData = new FormData();
  formData.append('file', input.file);
  const response = await fetch(
    `/api/pipeline/${encodeURIComponent(input.projectId || 'guest')}/stages/${encodeURIComponent(input.stage)}/assistant/attachments`,
    {
      method: 'POST',
      body: formData,
      headers: await getAuthHeaders()
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return { message: data.message, action: data.action };
}
