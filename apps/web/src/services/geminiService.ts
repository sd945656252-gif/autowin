import {
  IMAGE_EDIT_SYSTEM_PROMPT,
  IMAGE_PROMPT_SYSTEM_PROMPT,
  MUSIC_PROMPT_SYSTEM_PROMPT,
  REVERSE_INFER_SYSTEM_PROMPT,
  SEEDANCE_SYSTEM_PROMPT
} from '../constants';
import { apiFetch, apiJson } from '../lib/api';
import { CustomApiConfig } from '../types';

export type Attachment = {
  mimeType: string;
  data: string;
  name: string;
};

export type GenerationErrorCode =
  | 'FRONTEND_WATCHDOG_TIMEOUT'
  | 'BACKEND_REQUEST_TIMEOUT'
  | 'UPSTREAM_MODEL_TIMEOUT'
  | 'UPSTREAM_EMPTY_RESPONSE'
  | 'INVALID_MODEL_SELECTION'
  | 'PROMPT_TOO_LONG'
  | 'ATTACHMENT_TOO_LARGE'
  | 'STREAM_ABORTED'
  | 'UPSTREAM_HTTP_ERROR';

export class GenerationError extends Error {
  code: GenerationErrorCode;
  details?: unknown;

  constructor(code: GenerationErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
    this.details = details;
  }
}

const FAST_DIRECTOR_SYSTEM_PROMPT = `你是“提示词优化”的快速视频提示词导演。目标是把用户输入快速转成可直接用于视频生成的中文导演提示词。

输出要求：
1. 立刻输出正文，不要寒暄、不要解释、不要展示思考过程。
2. 优先保留用户的核心人物、动作、情绪、场景、镜头和风格要求。
3. 用连续自然中文描述，强调镜头语言、表演状态、光影、运动节奏、物理细节和可执行画面。
4. 严格贴合字数限制；不要为了堆砌而扩写无关背景。
5. 如果输入信息不足，直接补全为一个高质量、可执行的电影级镜头描述。`;

function compactText(value: string, maxChars: number) {
  const text = value.trim();
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.65));
  const tail = text.slice(-Math.floor(maxChars * 0.35));
  return `${head}\n\n[中间内容已压缩，以提升实时生成速度]\n\n${tail}`;
}

function requireBackendProvider(config?: CustomApiConfig): CustomApiConfig {
  if (!config?.id || config.id === 'default') {
    throw new Error('请先登录，并在配置与监控的模型中心保存可用的文字生成模型。浏览器端不会读取或保存 API key。');
  }
  return config;
}

async function* callCustomAiStream(
  systemPrompt: string,
  userPrompt: string,
  config: CustomApiConfig,
  attachments: Attachment[] = [],
  signal?: AbortSignal,
  isRealtimeSpeed: boolean = false
): AsyncGenerator<string, void, unknown> {
  const provider = requireBackendProvider(config);
  const requestStartedAt = performance.now();
  const response = await fetch('/api/custom-ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      customModelId: provider.id,
      configId: provider.id,
      systemPrompt,
      userPrompt,
      attachments,
      isRealtimeSpeed
    }),
    signal
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const code = parsed?.code || (response.status === 413 ? 'ATTACHMENT_TOO_LARGE' : response.status === 504 ? 'UPSTREAM_MODEL_TIMEOUT' : 'UPSTREAM_HTTP_ERROR');
    throw new GenerationError(code, parsed?.error || raw || response.statusText || 'Custom AI generation failed.', parsed?.details || { status: response.status });
  }

  const responseReceivedAt = performance.now();
  const proxyTtfbMs = response.headers.get('X-Jiying-Proxy-TTFB-Ms');
  const authMs = response.headers.get('X-Jiying-Auth-Ms');
  const promptBuildMs = response.headers.get('X-Jiying-Prompt-Build-Ms');
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let firstChunkLogged = false;
  let totalText = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (!text) continue;
    totalText += text.length;
    if (!firstChunkLogged) {
      firstChunkLogged = true;
      console.info('[custom-ai-stream-client] first text chunk', {
        responseMs: Math.round(responseReceivedAt - requestStartedAt),
        firstTextMs: Math.round(performance.now() - requestStartedAt),
        proxyTtfbMs: proxyTtfbMs ? Number(proxyTtfbMs) : null,
        authMs: authMs ? Number(authMs) : null,
        promptBuildMs: promptBuildMs ? Number(promptBuildMs) : null
      });
    }
    yield text;
  }

  if (totalText === 0) {
    throw new GenerationError('UPSTREAM_EMPTY_RESPONSE', '模型连接成功，但没有返回任何可用文本。');
  }
}

function attachmentReferenceList(attachments: Attachment[]) {
  if (attachments.length === 0) return '';
  return `\n\n[附件引用列表]\n${attachments.map((att, idx) => {
    const sameType = attachments.slice(0, idx + 1).filter((item) => {
      if (att.mimeType.startsWith('image/')) return item.mimeType.startsWith('image/');
      if (att.mimeType.startsWith('video/')) return item.mimeType.startsWith('video/');
      if (att.mimeType.startsWith('audio/')) return item.mimeType.startsWith('audio/');
      return false;
    });
    const prefix = att.mimeType.startsWith('image/') ? 'image' : att.mimeType.startsWith('video/') ? 'video' : att.mimeType.startsWith('audio/') ? 'audio' : 'file';
    return `@${prefix}${sameType.length}: ${att.name}`;
  }).join('\n')}\n`;
}

export async function testCustomApiConnection(config: CustomApiConfig): Promise<boolean> {
  const provider = requireBackendProvider(config);
  const response = await fetch('/api/custom-ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ configId: provider.id })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Provider test failed: ${response.status}`);
  }
  return true;
}

export type CustomAiTextTask = {
  taskId: string;
  runId?: string;
};

export type WorkflowTaskStatus = {
  progress: number;
  status: string;
  completed: boolean;
  output_text?: string;
  media_data?: string;
  error?: string;
};

export function buildPromptMatrixTaskPrompt(input: {
  userInput: string;
  mode?: 'auto' | 'light' | 'standard' | 'cinematic';
  duration?: string;
  attachments?: Attachment[];
  wordCountConstraint?: string;
  isRealtimeSpeed?: boolean;
  systemPrompt?: string;
}) {
  const systemPrompt = input.systemPrompt || (input.isRealtimeSpeed ? FAST_DIRECTOR_SYSTEM_PROMPT : SEEDANCE_SYSTEM_PROMPT);
  const userPrompt = compactText(
    `档位: ${input.mode || 'auto'}\n期望时长: ${input.duration || '未指定'}\n字数限制: ${input.wordCountConstraint || '800~950'}\n${attachmentReferenceList(input.attachments || [])}\n需求: ${input.userInput || '请生成一段电影级视频提示词。'}`,
    input.isRealtimeSpeed ? 4_000 : 10_000
  );
  return { systemPrompt, userPrompt };
}

export function buildImagePromptTaskPrompt(input: {
  userInput: string;
  attachments?: Attachment[];
  style?: string;
  systemPrompt?: string;
}) {
  const styleContext = input.style && input.style !== 'auto' ? `\n[MANDATORY STYLE GENE]: ${input.style}\n` : '';
  const userPrompt = compactText(`${input.userInput || '请生成一个视觉张力强的画面提示词。'}${styleContext}${attachmentReferenceList(input.attachments || [])}`, 8_000);
  return { systemPrompt: input.systemPrompt || IMAGE_PROMPT_SYSTEM_PROMPT, userPrompt };
}

export function buildReversePromptTaskPrompt(input: {
  userInput: string;
  attachments?: Attachment[];
  systemPrompt?: string;
}) {
  const userPrompt = compactText(`${input.userInput || '请反推提供的媒体文件。'}${attachmentReferenceList(input.attachments || [])}`, 8_000);
  return { systemPrompt: input.systemPrompt || REVERSE_INFER_SYSTEM_PROMPT, userPrompt };
}

export function buildMusicPromptTaskPrompt(input: {
  userInput: string;
  attachments?: Attachment[];
  systemPrompt?: string;
}) {
  const userPrompt = compactText(`${input.userInput || ''}${attachmentReferenceList(input.attachments || [])}`, 8_000);
  return { systemPrompt: input.systemPrompt || MUSIC_PROMPT_SYSTEM_PROMPT, userPrompt };
}

export function buildImageEditTaskPrompt(input: {
  userInput: string;
  attachments?: Attachment[];
  systemPrompt?: string;
}) {
  const userPrompt = compactText(`${input.userInput || 'Process'}${attachmentReferenceList(input.attachments || [])}`, 8_000);
  return { systemPrompt: input.systemPrompt || IMAGE_EDIT_SYSTEM_PROMPT, userPrompt };
}

export async function startCustomAiTask(input: {
  customConfig?: CustomApiConfig;
  systemPrompt: string;
  userPrompt: string;
  attachments?: Attachment[];
  isRealtimeSpeed?: boolean;
  promptCount?: number;
  metadata?: Record<string, any>;
}): Promise<CustomAiTextTask> {
  const provider = requireBackendProvider(input.customConfig);
  const data = await apiJson<{ task_id: string; run_id?: string }>('/api/custom-ai/tasks', {
    customModelId: provider.id,
    configId: provider.id,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    attachments: input.attachments || [],
    isRealtimeSpeed: input.isRealtimeSpeed ?? false,
    promptCount: input.promptCount || 1,
    metadata: input.metadata || {}
  });
  return { taskId: data.task_id, runId: data.run_id };
}

export async function startOptimizedPromptTask(
  userInput: string,
  mode: 'auto' | 'light' | 'standard' | 'cinematic' = 'auto',
  duration?: string,
  attachments: Attachment[] = [],
  _model: string = 'custom',
  customConfig?: CustomApiConfig,
  wordCountConstraint: string = '800~950',
  isRealtimeSpeed: boolean = true,
  metadata: Record<string, any> = {}
): Promise<CustomAiTextTask> {
  const { systemPrompt, userPrompt } = buildPromptMatrixTaskPrompt({
    userInput,
    mode,
    duration,
    attachments,
    wordCountConstraint,
    isRealtimeSpeed
  });
  return startCustomAiTask({
    customConfig,
    systemPrompt,
    userPrompt,
    attachments,
    isRealtimeSpeed,
    metadata
  });
}

export async function fetchWorkflowTaskStatus(taskId: string): Promise<WorkflowTaskStatus> {
  return apiFetch<WorkflowTaskStatus>(`/api/workflow/status/${encodeURIComponent(taskId)}`);
}

export async function transcribeAndPolishAudio(
  audioBase64: string,
  _model: string = 'custom',
  customConfig?: CustomApiConfig,
  mimeType: string = 'audio/webm'
): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of callCustomAiStream(
    '你是专业语音转文字与提示词润色助手。请准确转写音频，过滤无意义口头禅，保留原意。',
    '请转写并润色这段语音。',
    requireBackendProvider(customConfig),
    [{ mimeType, data: audioBase64, name: 'voice-input.webm' }]
  )) {
    chunks.push(chunk);
  }
  return chunks.join('');
}

export async function* generateImagePromptStream(
  userInput: string,
  attachments: Attachment[] = [],
  _model: string = 'custom',
  style: string = 'auto',
  _count: number = 1,
  customConfig?: CustomApiConfig,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const styleContext = style !== 'auto' ? `\n[MANDATORY STYLE GENE]: ${style}\n` : '';
  const textPrompt = compactText(`${userInput || '请生成一个视觉张力强的画面提示词。'}${styleContext}${attachmentReferenceList(attachments)}`, 8_000);
  yield* callCustomAiStream(IMAGE_PROMPT_SYSTEM_PROMPT, textPrompt, requireBackendProvider(customConfig), attachments, signal);
}

export async function* generateOptimizedPromptStream(
  userInput: string,
  mode: 'auto' | 'light' | 'standard' | 'cinematic' = 'auto',
  duration?: string,
  attachments: Attachment[] = [],
  _model: string = 'custom',
  customConfig?: CustomApiConfig,
  signal?: AbortSignal,
  wordCountConstraint: string = '800~950',
  isRealtimeSpeed: boolean = false
): AsyncGenerator<string, void, unknown> {
  const systemPrompt = isRealtimeSpeed ? FAST_DIRECTOR_SYSTEM_PROMPT : SEEDANCE_SYSTEM_PROMPT;
  const textPrompt = compactText(
    `档位: ${mode}\n期望时长: ${duration || '未指定'}\n字数限制: ${wordCountConstraint}\n${attachmentReferenceList(attachments)}\n需求: ${userInput || '请生成一段电影级视频提示词。'}`,
    isRealtimeSpeed ? 4_000 : 10_000
  );
  yield* callCustomAiStream(systemPrompt, textPrompt, requireBackendProvider(customConfig), attachments, signal, isRealtimeSpeed);
}

export async function* processImageEditStream(
  userInput: string,
  attachments: Attachment[] = [],
  _model: string = 'custom',
  systemPrompt: string = IMAGE_EDIT_SYSTEM_PROMPT,
  customConfig?: CustomApiConfig,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const prompt = compactText(`${userInput || 'Process'}${attachmentReferenceList(attachments)}`, 8_000);
  yield* callCustomAiStream(systemPrompt, prompt, requireBackendProvider(customConfig), attachments, signal);
}

export async function* reverseInferStream(
  userInput: string,
  attachments: Attachment[] = [],
  _model: string = 'custom',
  systemPrompt: string = REVERSE_INFER_SYSTEM_PROMPT,
  customConfig?: CustomApiConfig,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const prompt = compactText(`${userInput || '请反推提供的媒体文件。'}${attachmentReferenceList(attachments)}`, 8_000);
  yield* callCustomAiStream(systemPrompt, prompt, requireBackendProvider(customConfig), attachments, signal);
}

export async function* generateMusicPromptStream(
  userInput: string,
  attachments: Attachment[] = [],
  _model: string = 'custom',
  customConfig?: CustomApiConfig,
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const prompt = compactText(`${userInput}${attachmentReferenceList(attachments)}`, 8_000);
  yield* callCustomAiStream(MUSIC_PROMPT_SYSTEM_PROMPT, prompt, requireBackendProvider(customConfig), attachments, signal);
}
