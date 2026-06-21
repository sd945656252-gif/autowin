import type { CustomApiConfig } from '../../types';
import type { GenerationErrorCode } from '../../services/geminiService';
import type { FeatureMode } from './promptMatrixTypes';

export const FEATURE_MODE_LABELS: Record<FeatureMode, string> = {
  prompt: '视频提示词',
  image_prompt: '生图提示词',
  reverse: '反推解析',
  music_prompt: '音乐提示词',
  edit: '图像修改'
};

export const UNAVAILABLE_GEMINI_MODELS = new Set([
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview'
]);

export const PROMPT_OPTIMIZATION_TASK_POLL_MS = 1800;

export function userMessageForGenerationError(error: any) {
  const code = error?.code as GenerationErrorCode | undefined;
  if (code === 'FRONTEND_WATCHDOG_TIMEOUT') return '模型首段响应过慢，已停止本次等待。建议缩短输入、减少附件，或切换到响应更快的文字模型。';
  if (code === 'UPSTREAM_MODEL_TIMEOUT' || code === 'BACKEND_REQUEST_TIMEOUT') return '上游模型响应超时。建议稍后重试，或切换到更快的模型。';
  if (code === 'UPSTREAM_EMPTY_RESPONSE') return '模型返回了空内容。请重试，或检查当前模型是否支持文字生成。';
  if (code === 'INVALID_MODEL_SELECTION') return '当前文字模型配置不可用，请在模型中心重新选择可用模型。';
  if (code === 'PROMPT_TOO_LONG') return '输入内容过长，已超过实时生成预算。请缩短文本或拆分生成。';
  if (code === 'ATTACHMENT_TOO_LARGE') return '附件过大或数量过多。请压缩附件或减少附件数量后重试。';
  if (code === 'STREAM_ABORTED') return '生成连接已中断，请重新发起生成。';
  return error?.message || '生成出错，请重试';
}

export function getTextModelDisplayName(model?: Pick<CustomApiConfig, 'displayName' | 'alias' | 'modelName'> | null) {
  const rawLabel = String(model?.displayName || model?.alias || '').trim();
  if (rawLabel) return rawLabel.replace(/\s*\([^)]*\)\s*$/, '').trim() || rawLabel;
  return '未命名文字模型';
}

export function promptOptimizationTaskStorageKey(userId?: string, projectId?: string | null) {
  return `prompt_optimization_task_v1:${userId || 'guest'}:${projectId || 'global'}`;
}
