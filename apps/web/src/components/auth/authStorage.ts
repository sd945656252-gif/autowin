import { get, set } from 'idb-keyval';
import type { CanvasState, CustomApiConfig, HistoryItem, SavedPrompt } from '../../types';
import { deleteCustomApiConfig, fetchCanvasState, fetchCustomApiConfigs, fetchPromptHistory, fetchSavedPrompts, saveCanvasState, saveCustomApiConfig } from '../../lib/db';

export function emptyCanvasState(projectId?: string | null): CanvasState {
  return { nodes: [], shotNodes: [], shots: [], apiConfigs: [], activeStage: '02', metadata: { projectId: projectId || null } };
}

export function withCanvasProjectMetadata(state: CanvasState, projectId?: string | null): CanvasState {
  return {
    ...state,
    metadata: {
      ...(state.metadata || {}),
      projectId: projectId || null
    }
  };
}

export async function loadStoredAuthData(ownerId: string) {
  const [localCanvas, localHistory, localSaved] = await Promise.all([
    get(`canvasState_${ownerId}`),
    get(`history_${ownerId}`),
    get(`savedPrompts_${ownerId}`)
  ]);
  return {
    localCanvas: localCanvas as CanvasState | undefined,
    localHistory: localHistory as HistoryItem[] | undefined,
    localSaved: localSaved as SavedPrompt[] | undefined
  };
}

export async function loadRemoteAuthData(ownerId: string, canManageApiConfigs: boolean) {
  const [remoteCanvas, remoteHistory, remoteSaved, remoteConfigs] = await Promise.all([
    fetchCanvasState(ownerId),
    fetchPromptHistory(ownerId),
    fetchSavedPrompts(ownerId),
    canManageApiConfigs ? fetchCustomApiConfigs(ownerId) : Promise.resolve([] as CustomApiConfig[])
  ]);
  return { remoteCanvas, remoteHistory, remoteSaved, remoteConfigs };
}

export async function persistAuthData(ownerId: string, canvasState: CanvasState, history: HistoryItem[], savedPrompts: SavedPrompt[]) {
  await Promise.all([
    set(`canvasState_${ownerId}`, canvasState),
    set(`history_${ownerId}`, history),
    set(`savedPrompts_${ownerId}`, savedPrompts)
  ]);
}

export async function saveScopedCanvas(state: CanvasState, ownerId: string, projectId?: string | null) {
  const storageKey = projectId ? `canvasState_${ownerId}_${projectId}` : `canvasState_${ownerId}`;
  const scopedState = withCanvasProjectMetadata(state, projectId);
  await set(storageKey, scopedState);
  const cleanState = JSON.parse(JSON.stringify(scopedState));
  cleanState.nodes?.forEach((n: any) => {
    if (n.generated_media?.startsWith('data:')) n.generated_media = '[LOCAL_CACHE_ONLY]';
    if (n.refImage?.startsWith('data:')) n.refImage = '[LOCAL_CACHE_ONLY]';
  });
  cleanState.shotNodes?.forEach((n: any) => {
    if (n.generated_media?.startsWith('data:')) n.generated_media = '[LOCAL_CACHE_ONLY]';
    if (n.refImage?.startsWith('data:')) n.refImage = '[LOCAL_CACHE_ONLY]';
  });
  return { scopedState, cleanState };
}

export async function syncCanvasToServer(cleanState: CanvasState, ownerId: string, projectId?: string | null) {
  await saveCanvasState(cleanState, ownerId, projectId);
}

export async function saveGlobalApiConfigsForUser(configs: CustomApiConfig[], previousConfigs: CustomApiConfig[], ownerId: string) {
  const removedConfigs = previousConfigs.filter((prev) => !configs.some((next) => next.id === prev.id));
  const savedConfigs = await Promise.all(configs.map((config) => saveCustomApiConfig(config, ownerId)));
  await Promise.all(removedConfigs.map((config) => deleteCustomApiConfig(config.id, ownerId)));
  return savedConfigs.filter(Boolean) as CustomApiConfig[];
}
