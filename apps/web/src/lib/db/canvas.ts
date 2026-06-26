import type { CanvasState } from '../../types';
import { apiFetch, apiJson } from '../api';

function emptyCanvasState(projectId?: string | null): CanvasState {
  return {
    nodes: [],
    shotNodes: [],
    shots: [],
    apiConfigs: [],
    activeStage: '02',
    metadata: { projectId: projectId || null }
  };
}

export async function fetchCanvasState(userId?: string, projectId?: string | null): Promise<CanvasState> {
  if (!userId || userId === 'guest') return emptyCanvasState(projectId);
  try {
    const data = await apiFetch<{ state?: CanvasState; workflowId?: string | null }>('/api/canvas-state', {
      query: { userId: userId || 'guest', projectId: projectId || undefined }
    });
    const state = data.state || emptyCanvasState(projectId);
    return {
      ...state,
      metadata: {
        ...(state.metadata || {}),
        projectId: state.metadata?.projectId ?? projectId ?? null,
        workflowId: data.workflowId || state.metadata?.workflowId || null
      }
    };
  } catch (e) {
    console.warn('Canvas state API fetch failed:', e);
    return emptyCanvasState(projectId);
  }
}

export async function saveCanvasState(state: CanvasState, userId?: string, projectId?: string | null): Promise<void> {
  if (!userId || userId === 'guest') return;
  try {
    await apiJson('/api/canvas-state', { userId: userId || 'guest', projectId: projectId || undefined, state });
  } catch (e) {
    console.warn('Canvas state API save failed:', e);
    throw e;
  }
}
