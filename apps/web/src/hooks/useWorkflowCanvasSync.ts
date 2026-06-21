import { useEffect, useRef, useState } from 'react';
import { initialShots } from '../data/presets';
import { connectWorkflowRealtime } from '../lib/workflowRealtime';
import type { CanvasNode, CanvasState, PromptShot } from '../types';

type SyncStatus = 'offline' | 'connecting' | 'online' | 'conflict';

type WorkflowPresenceUser = {
  userId: string;
  displayName: string;
};

type WorkflowCanvasSyncUser = {
  uid?: string | null;
} | null | undefined;

type WorkflowCanvasSyncState = {
  nodes: CanvasNode[];
  shotNodes: CanvasNode[];
  shots: PromptShot[];
  activeStage: string;
};

type WorkflowCanvasSyncArgs = {
  currentProjectId?: string | null;
  user?: WorkflowCanvasSyncUser;
  isAuthLoading: boolean;
  canvasState: CanvasState | null;
  loadCanvasForProject: (projectId?: string | null) => Promise<CanvasState>;
  saveCanvas: (state: CanvasState, projectId?: string | null) => Promise<void>;
};

const DEFAULT_ACTIVE_STAGE = '02';
const ACTIVE_STAGE_MIGRATION: Record<string, string> = { '03': '04' };
const REMOTE_ECHO_GRACE_MS = 2500;
const AUTOSAVE_INTERVAL_MS = 3000;

function buildEmptyCanvasState(): WorkflowCanvasSyncState {
  return {
    nodes: [],
    shotNodes: [],
    shots: initialShots,
    activeStage: DEFAULT_ACTIVE_STAGE
  };
}

function serializeCanvasState(state: WorkflowCanvasSyncState): string {
  return JSON.stringify(state);
}

function ensureModuleType(nodes: CanvasNode[], moduleType: '04' | '05'): CanvasNode[] {
  return nodes.map((node) => (node.moduleType ? node : { ...node, moduleType }));
}

function mergeRemoteNode(remoteNode: CanvasNode, localNode: CanvasNode | undefined, hasPendingChanges: boolean): CanvasNode {
  if (!localNode) {
    return remoteNode;
  }

  const merged = { ...remoteNode };

  if (localNode.isLoading && !localNode.error && !remoteNode.isLoading && !remoteNode.generated_media) {
    merged.isLoading = true;
    merged.progress = localNode.progress;
    merged.statusMessage = localNode.statusMessage;
    merged.error = localNode.error || '';
  }

  if (localNode.error) {
    merged.isLoading = false;
    merged.progress = localNode.progress;
    merged.statusMessage = localNode.statusMessage;
    merged.error = localNode.error;
  }

  if (localNode.generated_media && !remoteNode.generated_media) {
    merged.generated_media = localNode.generated_media;
    merged.isLoading = false;
    merged.progress = 100;
    merged.error = '';
  }

  if (hasPendingChanges) {
    merged.uploaded_images = localNode.uploaded_images;
    merged.video_media_list = localNode.video_media_list;
    merged.prompt = localNode.prompt || remoteNode.prompt;
    merged.use_custom_api = localNode.use_custom_api;
  } else {
    if (localNode.uploaded_images?.length && (!remoteNode.uploaded_images || remoteNode.uploaded_images.length < localNode.uploaded_images.length)) {
      merged.uploaded_images = localNode.uploaded_images;
    }
    if (localNode.video_media_list?.length && (!remoteNode.video_media_list || remoteNode.video_media_list.length < localNode.video_media_list.length)) {
      merged.video_media_list = localNode.video_media_list;
    }
  }

  return merged;
}

function mergeRemoteNodes(remoteNodes: CanvasNode[], localNodes: CanvasNode[], hasPendingChanges: boolean): CanvasNode[] {
  const localOnlyNodes = localNodes.filter((localNode) => !remoteNodes.some((remoteNode) => remoteNode.id === localNode.id));
  const mergedRemoteNodes = remoteNodes.map((remoteNode) => mergeRemoteNode(remoteNode, localNodes.find((node) => node.id === remoteNode.id), hasPendingChanges));
  return [...mergedRemoteNodes, ...localOnlyNodes];
}

export function useWorkflowCanvasSync({
  currentProjectId,
  user,
  isAuthLoading,
  canvasState,
  loadCanvasForProject,
  saveCanvas
}: WorkflowCanvasSyncArgs) {
  const [activeNode, setActiveNode] = useState(DEFAULT_ACTIVE_STAGE);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [shotNodes, setShotNodes] = useState<CanvasNode[]>([]);
  const [shots, setShots] = useState<PromptShot[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<WorkflowPresenceUser[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('offline');
  const workflowRevisionRef = useRef(0);
  const lastSavedRef = useRef(serializeCanvasState(buildEmptyCanvasState()));
  const realtimeRef = useRef<ReturnType<typeof connectWorkflowRealtime> | null>(null);
  const applyingRemoteRef = useRef(false);
  const deletedNodeIdsRef = useRef<Set<string>>(new Set());
  const currentLocalStateRef = useRef<WorkflowCanvasSyncState>(buildEmptyCanvasState());
  const lastSaveTimeRef = useRef(0);
  const loadedProjectIdRef = useRef<string | null>(null);
  const pendingSaveRef = useRef(false);
  const savingRef = useRef(false);

  currentLocalStateRef.current = { nodes, shotNodes, shots, activeStage: activeNode };
  useEffect(() => {
    const emptyState = buildEmptyCanvasState();

    workflowRevisionRef.current = 0;
    deletedNodeIdsRef.current.clear();
    pendingSaveRef.current = false;
    savingRef.current = false;
    loadedProjectIdRef.current = null;
    setPresenceUsers([]);
    setSyncStatus('offline');
    setNodes(emptyState.nodes);
    setShotNodes(emptyState.shotNodes);
    setShots(emptyState.shots);
    setActiveNode(emptyState.activeStage);
    lastSavedRef.current = serializeCanvasState(emptyState);
    currentLocalStateRef.current = emptyState;
  }, [currentProjectId]);

  useEffect(() => {
    if (!user?.uid || !currentProjectId) {
      return;
    }

    let cancelled = false;

    async function ensureWorkflowRoom() {
      setSyncStatus('connecting');

      try {
        const roomName = `极影实时协作画布:${currentProjectId}`;
        const listResponse = await fetch('/api/workflows', { credentials: 'same-origin' });
        const listData = await listResponse.json().catch(() => ({}));
        if (!listResponse.ok || !listData.success) {
          throw new Error(listData.error || 'Failed to load workflows.');
        }

        let workflow = (listData.workflows || []).find((item: { name?: string }) => item.name === roomName);
        if (!workflow) {
          const createResponse = await fetch('/api/workflows', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: roomName, canvas: { nodes: [], shotNodes: [], shots: [] } })
          });
          const createData = await createResponse.json().catch(() => ({}));
          if (!createResponse.ok || !createData.success) {
            throw new Error(createData.error || 'Failed to create workflow room.');
          }
          workflow = createData.workflow;
        }

        if (cancelled || !workflow?.id) {
          return;
        }

        workflowRevisionRef.current = Number(workflow.draftRevision || 0);
        realtimeRef.current?.close();
        realtimeRef.current = connectWorkflowRealtime(workflow.id, {
          onPresence: setPresenceUsers,
          onConflict: () => setSyncStatus('conflict'),
          onMessage: (message) => {
            if (message.type === 'joined' || message.type === 'connected') {
              setSyncStatus('online');
            }

            if (message.type === 'revision-updated' && typeof message.revision === 'number') {
              workflowRevisionRef.current = message.revision;
              setSyncStatus('online');
            }

            if (message.type === 'canvas-event' && message.payload) {
              applyingRemoteRef.current = true;

              if (message.scope === 'nodes') {
                setNodes(message.payload.nodes || []);
              }
              if (message.scope === 'shotNodes') {
                setShotNodes(message.payload.nodes || []);
              }
              if (message.scope === 'shots') {
                setShots(message.payload.shots || []);
              }

              window.setTimeout(() => {
                applyingRemoteRef.current = false;
              }, 0);
            }
          }
        });
      } catch (error) {
        console.warn('[Realtime] Failed to initialize workflow room:', error);
        if (!cancelled) {
          setSyncStatus('offline');
        }
      }
    }

    void ensureWorkflowRoom();

    return () => {
      cancelled = true;
      realtimeRef.current?.close();
      realtimeRef.current = null;
      setPresenceUsers([]);
      setSyncStatus('offline');
    };
  }, [currentProjectId, user?.uid]);

  useEffect(() => {
    if (isAuthLoading || !user?.uid || !currentProjectId) {
      return;
    }

    void loadCanvasForProject(currentProjectId).catch((error) => {
      console.warn('[Canvas] Failed to load project canvas:', error);
    });
  }, [currentProjectId, isAuthLoading, loadCanvasForProject, user?.uid]);

  useEffect(() => {
    if (isAuthLoading || !user?.uid || !canvasState) {
      return;
    }

    const canvasProjectId = typeof canvasState.metadata?.projectId === 'string' ? canvasState.metadata.projectId : null;
    if ((currentProjectId || null) !== canvasProjectId) {
      return;
    }

    const filteredRemoteNodes = (canvasState.nodes || []).filter((node) => !deletedNodeIdsRef.current.has(node.id));
    const filteredRemoteShotNodes = (canvasState.shotNodes || []).filter((node) => !deletedNodeIdsRef.current.has(node.id));
    const savedActiveStage = typeof canvasState.activeStage === 'string' ? canvasState.activeStage : DEFAULT_ACTIVE_STAGE;
    const migratedActiveStage = ACTIVE_STAGE_MIGRATION[savedActiveStage] || savedActiveStage;
    const remoteActiveStage = /^0(2|4|5|6)$/.test(migratedActiveStage) ? migratedActiveStage : DEFAULT_ACTIVE_STAGE;
    const remoteState: WorkflowCanvasSyncState = {
      nodes: filteredRemoteNodes,
      shotNodes: filteredRemoteShotNodes,
      shots: canvasState.shots?.length ? canvasState.shots : initialShots,
      activeStage: remoteActiveStage
    };
    const remoteStateStr = serializeCanvasState(remoteState);
    const currentStateStr = serializeCanvasState(currentLocalStateRef.current);

    if (Date.now() - lastSaveTimeRef.current < REMOTE_ECHO_GRACE_MS) {
      return;
    }

    const hasPendingChanges = currentStateStr !== lastSavedRef.current;
    if (remoteStateStr !== currentStateStr) {
      setNodes((prevNodes) => mergeRemoteNodes(remoteState.nodes, prevNodes, hasPendingChanges));
      setShotNodes((prevShotNodes) => mergeRemoteNodes(remoteState.shotNodes, prevShotNodes, hasPendingChanges));
      setShots(remoteState.shots);
      setActiveNode(remoteActiveStage);
      lastSavedRef.current = remoteStateStr;
    }

    loadedProjectIdRef.current = currentProjectId || null;
  }, [canvasState, currentProjectId, isAuthLoading, user?.uid]);

  useEffect(() => {
    if (!user?.uid || loadedProjectIdRef.current !== (currentProjectId || null)) {
      return;
    }

    const currentState = serializeCanvasState({ nodes, shotNodes, shots, activeStage: activeNode });
    if (currentState === lastSavedRef.current) {
      return;
    }

    pendingSaveRef.current = true;
  }, [activeNode, currentProjectId, nodes, shotNodes, shots, user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!pendingSaveRef.current || savingRef.current) {
        return;
      }
      if (loadedProjectIdRef.current !== (currentProjectId || null)) {
        return;
      }

      const state = currentLocalStateRef.current;
      const currentState = serializeCanvasState(state);
      if (currentState === lastSavedRef.current) {
        pendingSaveRef.current = false;
        return;
      }

      savingRef.current = true;
      void saveCanvas({ ...state, apiConfigs: [] }, currentProjectId)
        .then(() => {
          realtimeRef.current?.saveRevision(workflowRevisionRef.current);
          lastSavedRef.current = currentState;
          lastSaveTimeRef.current = Date.now();
          pendingSaveRef.current = false;
        })
        .catch((error) => {
          console.warn('[Canvas] Failed to autosave project canvas:', error);
        })
        .finally(() => {
          savingRef.current = false;
        });
    }, AUTOSAVE_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [currentProjectId, saveCanvas, user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    const onAssistantCanvasConfirmed = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.stage !== 'ART_03' && detail.stage !== 'SHOT_04') {
        return;
      }

      window.setTimeout(() => {
        const state = currentLocalStateRef.current;
        const currentState = serializeCanvasState(state);

        void saveCanvas({ ...state, apiConfigs: [] }, currentProjectId)
          .then(() => {
            realtimeRef.current?.saveRevision(workflowRevisionRef.current);
            lastSavedRef.current = currentState;
            lastSaveTimeRef.current = Date.now();
            pendingSaveRef.current = false;
          })
          .catch((error) => {
            console.warn('[Canvas] Failed to save assistant-confirmed canvas:', error);
          });
      }, 300);
    };

    window.addEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantCanvasConfirmed);
    return () => window.removeEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantCanvasConfirmed);
  }, [currentProjectId, saveCanvas, user?.uid]);

  const updateNodesState = (newNodesOrUpdater: CanvasNode[] | ((prev: CanvasNode[]) => CanvasNode[])) => {
    setNodes((prevNodes) => {
      const resolvedNodes = typeof newNodesOrUpdater === 'function' ? newNodesOrUpdater(prevNodes) : newNodesOrUpdater;
      const deletedNodes = prevNodes.filter((node) => !resolvedNodes.some((resolvedNode) => resolvedNode.id === node.id));
      if (deletedNodes.length > 0) {
        deletedNodes.forEach((node) => {
          deletedNodeIdsRef.current.add(node.id);
        });
      }

      const nextNodes = ensureModuleType(resolvedNodes, '04');
      if (!applyingRemoteRef.current) {
        realtimeRef.current?.sendCanvasEvent({ scope: 'nodes', payload: { nodes: nextNodes } });
      }
      return nextNodes;
    });
  };

  const updateShotNodesState = (newNodesOrUpdater: CanvasNode[] | ((prev: CanvasNode[]) => CanvasNode[])) => {
    setShotNodes((prevNodes) => {
      const resolvedNodes = typeof newNodesOrUpdater === 'function' ? newNodesOrUpdater(prevNodes) : newNodesOrUpdater;
      const deletedNodes = prevNodes.filter((node) => !resolvedNodes.some((resolvedNode) => resolvedNode.id === node.id));
      if (deletedNodes.length > 0) {
        deletedNodes.forEach((node) => {
          deletedNodeIdsRef.current.add(node.id);
        });
      }

      const nextNodes = ensureModuleType(resolvedNodes, '05');
      if (!applyingRemoteRef.current) {
        realtimeRef.current?.sendCanvasEvent({ scope: 'shotNodes', payload: { nodes: nextNodes } });
      }
      return nextNodes;
    });
  };

  const updateShotsState = (newShots: PromptShot[]) => {
    setShots(newShots);
    if (!applyingRemoteRef.current) {
      realtimeRef.current?.sendCanvasEvent({ scope: 'shots', payload: { shots: newShots } });
    }
  };

  return {
    activeNode,
    setActiveNode,
    nodes,
    shotNodes,
    shots,
    presenceUsers,
    syncStatus,
    updateNodesState,
    updateShotNodesState,
    updateShotsState
  };
}

