import { CanvasNode } from '../../types';
import { makeUrlPermanent } from '../../utils/persistence';

export type WorkflowStatusPayload = {
  progress?: number;
  status?: string;
  media_data?: string;
  error?: string;
  completed?: boolean;
};

type NodeUpdate = (updatedFields: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) => void;

export function mediaAssetIdFromUrl(url?: string | null) {
  if (!url) return null;
  const match = url.match(/\/api\/media\/assets\/([^/?#]+)\/stream/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

type ApplyGeneratedWorkflowStatusOptions = {
  statusData: WorkflowStatusPayload;
  currentProgress?: number;
  currentStatusMessage?: string;
  emptyMediaError: string;
  persistMedia?: boolean;
  permanentMediaPrefix: string;
  onUpdate: NodeUpdate;
};

export function applyGeneratedWorkflowStatus({
  statusData,
  currentProgress,
  currentStatusMessage,
  emptyMediaError,
  persistMedia,
  permanentMediaPrefix,
  onUpdate
}: ApplyGeneratedWorkflowStatusOptions) {
  const nextProgress = Math.max(1, Math.min(100, Number(statusData.progress ?? currentProgress ?? 1)));

  if (statusData.completed) {
    if (statusData.media_data) {
      const finish = (mediaUrl: string) => {
        onUpdate({
          generated_media: mediaUrl,
          isLoading: false,
          progress: 100,
          statusMessage: '生成完成',
          error: ''
        });
      };

      if (persistMedia) {
        onUpdate({
          isLoading: true,
          statusMessage: '正在保存到云端...',
          progress: 95
        });
        makeUrlPermanent(statusData.media_data, permanentMediaPrefix)
          .then(finish)
          .catch((err) => {
            console.warn(`Failed to persist ${permanentMediaPrefix}, saving original URL`, err);
            finish(statusData.media_data!);
          });
        return;
      }

      finish(statusData.media_data);
      return;
    }

    onUpdate({
      isLoading: false,
      progress: statusData.progress ?? 100,
      statusMessage: statusData.status || '生成失败',
      error: statusData.error || emptyMediaError
    });
    return;
  }

  if (statusData.error) {
    onUpdate({
      isLoading: false,
      progress: nextProgress,
      statusMessage: statusData.status || '生成失败',
      error: statusData.error
    });
    return;
  }

  onUpdate({
    isLoading: true,
    progress: nextProgress,
    statusMessage: statusData.status || currentStatusMessage || 'Workflow running',
    error: ''
  });
}

type PollWorkflowTaskStatusOptions = {
  taskId: string;
  maxPollMs: number;
  persistMedia?: boolean;
  permanentMediaPrefix: string;
  emptyMediaError: string;
  timeoutError: string;
  syncFailureError: string;
  missingStatusError?: string;
  currentProgress?: number;
  currentStatusMessage?: string;
  onUpdate: NodeUpdate;
};

export function pollWorkflowTaskStatus({
  taskId,
  maxPollMs,
  persistMedia,
  permanentMediaPrefix,
  emptyMediaError,
  timeoutError,
  syncFailureError,
  missingStatusError = '任务状态不存在或已过期，请重新运行该节点。',
  currentProgress,
  currentStatusMessage,
  onUpdate
}: PollWorkflowTaskStatusOptions) {
  const pollStartedAt = Date.now();
  let missingStatusCount = 0;

  const poll = async () => {
    if (Date.now() - pollStartedAt > maxPollMs) {
      onUpdate({
        isLoading: false,
        error: timeoutError,
        statusMessage: '状态同步超时'
      });
      return;
    }

    try {
      const statusRes = await fetch(`/api/workflow/status/${taskId}`, { credentials: 'same-origin' });
      if (!statusRes.ok) {
        missingStatusCount += statusRes.status === 404 ? 1 : 0;
        if (missingStatusCount >= 6) {
          onUpdate({
            isLoading: false,
            error: missingStatusError,
            statusMessage: '任务状态丢失'
          });
          return;
        }
        window.setTimeout(poll, 2000);
        return;
      }

      missingStatusCount = 0;
      const statusData = await statusRes.json() as WorkflowStatusPayload;
      applyGeneratedWorkflowStatus({
        statusData,
        currentProgress,
        currentStatusMessage,
        emptyMediaError,
        persistMedia,
        permanentMediaPrefix,
        onUpdate
      });
      if (!statusData.completed && !statusData.error) window.setTimeout(poll, 2000);
    } catch (pollErr) {
      console.error('Workflow task polling error:', pollErr);
      if (Date.now() - pollStartedAt > maxPollMs) {
        onUpdate({
          isLoading: false,
          error: syncFailureError,
          statusMessage: '状态同步失败'
        });
        return;
      }
      window.setTimeout(poll, 2000);
    }
  };

  window.setTimeout(poll, 2000);
}

