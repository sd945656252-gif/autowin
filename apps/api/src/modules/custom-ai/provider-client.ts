import { safeFetch } from "../../security/safe-outbound";
import { HttpError } from "../../shared/http";
import { joinProviderEndpoint, pickFirstPathValue } from "../workflow/provider-adapters";

export type ProviderAttachment = {
  mimeType?: string;
  data?: string;
  name?: string;
};

const MAX_PROMPT_CHARS = 12_000;
const DEFAULT_TEXT_RESPONSE_PATHS = [
  "choices.0.message.content",
  "choices.0.text",
  "candidates.0.content.parts.0.text",
  "text",
  "output_text"
];
const DEFAULT_OPENAI_STREAM_CHUNK_PATHS = ["choices.0.delta.content", "choices.0.text", "delta.content"];
const DEFAULT_GEMINI_STREAM_CHUNK_PATHS = ["candidates.0.content.parts.0.text", "text"];

export type ProviderErrorCode =
  | "BACKEND_REQUEST_TIMEOUT"
  | "UPSTREAM_MODEL_TIMEOUT"
  | "UPSTREAM_EMPTY_RESPONSE"
  | "INVALID_MODEL_SELECTION"
  | "PROMPT_TOO_LONG"
  | "ATTACHMENT_TOO_LARGE"
  | "STREAM_ABORTED"
  | "UPSTREAM_HTTP_ERROR";

export class ProviderCallError extends HttpError {
  constructor(status: number, message: string, code: ProviderErrorCode, details?: any) {
    super(status, message, code, details);
  }
}

export function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

export function truncatePrompt(value: string, maxChars = MAX_PROMPT_CHARS) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.floor(maxChars * 0.7))}\n\n[Prompt truncated by proxy to reduce latency.]\n\n${value.slice(-Math.floor(maxChars * 0.3))}`;
}

export function toProviderUrl(baseUrl: string, modelName?: string, stream = false) {
  const trimmedBase = baseUrl.trim();
  const lowerBase = trimmedBase.toLowerCase();
  const lowerModel = (modelName || "").toLowerCase();
  const isExplicitGeminiUrl = lowerBase.includes("generatecontent") || lowerBase.includes("streamgeneratecontent");
  const isGeminiModel = lowerModel.includes("gemini");
  const hasOpenAiPath = lowerBase.includes("chat/completions");
  const isGeminiNative = isExplicitGeminiUrl || (isGeminiModel && !hasOpenAiPath);

  if (isGeminiNative || hasOpenAiPath || lowerBase.includes("v1/completions")) {
    const url = stream && isGeminiNative && lowerBase.includes("generatecontent") && !lowerBase.includes("streamgeneratecontent")
      ? trimmedBase.replace(/generateContent/i, "streamGenerateContent")
      : trimmedBase;
    return { url, isGeminiNative };
  }

  return {
    url: trimmedBase.endsWith("/") ? `${trimmedBase}chat/completions` : `${trimmedBase}/chat/completions`,
    isGeminiNative
  };
}

function normalizeTextAdapter(capabilities?: any, baseUrl?: string, modelName?: string) {
  const explicit = capabilities?.providerAdapter;
  if (explicit === "openai-chat" || explicit === "gemini-native" || explicit === "custom") return explicit;
  const lowerBase = String(baseUrl || "").toLowerCase();
  const lowerModel = String(modelName || "").toLowerCase();
  const hasOpenAiPath = lowerBase.includes("chat/completions");
  const isExplicitGeminiUrl = lowerBase.includes("generatecontent") || lowerBase.includes("streamgeneratecontent");
  if (isExplicitGeminiUrl || (lowerModel.includes("gemini") && !hasOpenAiPath)) return "gemini-native";
  return "openai-chat";
}

export function buildTextProviderRequest(input: {
  baseUrl: string;
  modelName: string;
  systemPrompt: string;
  userPrompt: string;
  attachments?: ProviderAttachment[];
  stream?: boolean;
  isRealtimeSpeed?: boolean;
  maxOutputTokens?: number;
  maxPromptChars?: number;
  temperature?: number;
  capabilities?: any;
}) {
  const adapter = normalizeTextAdapter(input.capabilities, input.baseUrl, input.modelName);
  const runtime = input.capabilities?.runtime || {};
  const { url: inferredUrl, isGeminiNative } = toProviderUrl(input.baseUrl, input.modelName, Boolean(input.stream));
  const endpoint = runtime[input.stream ? "streamEndpoint" : "endpoint"]
    ? joinProviderEndpoint(input.baseUrl, runtime[input.stream ? "streamEndpoint" : "endpoint"])
    : inferredUrl;
  const effectiveGeminiNative = adapter === "gemini-native" || isGeminiNative;
  const payload = buildPayload({
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    modelName: input.modelName,
    attachments: input.attachments || [],
    isGeminiNative: effectiveGeminiNative,
    isRealtimeSpeed: input.isRealtimeSpeed,
    stream: Boolean(input.stream),
    maxOutputTokens: input.maxOutputTokens,
    maxPromptChars: input.maxPromptChars ?? input.capabilities?.controls?.maxPromptChars,
    temperature: input.temperature
  });
  return {
    endpoint,
    payload,
    isGeminiNative: effectiveGeminiNative,
    responsePaths: runtime.responsePaths || DEFAULT_TEXT_RESPONSE_PATHS,
    streamChunkPaths: runtime.streamChunkPaths || (effectiveGeminiNative ? DEFAULT_GEMINI_STREAM_CHUNK_PATHS : DEFAULT_OPENAI_STREAM_CHUNK_PATHS)
  };
}

export function buildPayload(input: {
  systemPrompt: string;
  userPrompt: string;
  modelName: string;
  attachments?: ProviderAttachment[];
  isGeminiNative: boolean;
  isRealtimeSpeed?: boolean;
  stream?: boolean;
  maxOutputTokens?: number;
  maxPromptChars?: number;
  temperature?: number;
}) {
  const isRealtimeSpeed = Boolean(input.isRealtimeSpeed);
  const promptLimit = input.maxPromptChars || (isRealtimeSpeed ? 6_000 : MAX_PROMPT_CHARS);
  if (input.userPrompt.length > promptLimit * 3 || input.systemPrompt.length > MAX_PROMPT_CHARS * 2) {
    throw new ProviderCallError(413, "Prompt is too long for realtime generation.", "PROMPT_TOO_LONG", {
      userPromptChars: input.userPrompt.length,
      systemPromptChars: input.systemPrompt.length,
      promptLimit
    });
  }
  const systemPrompt = truncatePrompt(input.systemPrompt, Math.min(promptLimit, MAX_PROMPT_CHARS));
  const userPrompt = truncatePrompt(input.userPrompt, promptLimit);
  const finalUserPrompt = isRealtimeSpeed
    ? `SPEED ENGINE REQUIREMENT: BYPASS DELIBERATION/THINKING. RESPOND QUICKLY. NO INTROS.\n${userPrompt}`
    : userPrompt;
  const attachments = input.attachments || [];
  const maxOutputTokens = input.maxOutputTokens || (isRealtimeSpeed ? 4096 : 8192);
  const temperature = input.temperature ?? (isRealtimeSpeed ? 0.15 : 0.7);

  if (input.isGeminiNative) {
    const parts = attachments.map((attachment) => ({
      inline_data: {
        mime_type: attachment.mimeType,
        data: attachment.data
      }
    }));
    parts.push({ text: `System Instruction: ${systemPrompt}\n\nUser Input: ${finalUserPrompt}` } as any);
    return {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature,
        maxOutputTokens,
        topP: isRealtimeSpeed ? 0.8 : 0.95,
        topK: isRealtimeSpeed ? 20 : 40
      },
      ...(input.modelName ? { model: input.modelName } : {})
    };
  }

  const contentParts: any[] = [{ type: "text", text: finalUserPrompt }];
  for (const attachment of attachments) {
    if (attachment.mimeType?.startsWith("image/") && attachment.data) {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}`, detail: "high" }
      });
    } else if (attachment.mimeType) {
      contentParts.push({
        type: "text",
        text: `[Attached File: ${attachment.name || "file"} (${attachment.mimeType})]`
      });
    }
  }

  return {
    model: input.modelName || "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: contentParts }
    ],
    stream: Boolean(input.stream),
    max_tokens: maxOutputTokens,
    temperature
  };
}

export function createOpenAiStreamExtractor() {
  let buffer = "";
  return (raw: string, flush = false) => {
    buffer += raw;
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? "" : lines.pop() || "";
    const chunks: string[] = [];

    for (const line of lines) {
      const cleanedLine = line.replace(/^data:\s*/, "").trim();
      if (!cleanedLine || cleanedLine === "[DONE]") continue;
      try {
        const json = JSON.parse(cleanedLine);
        const text = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || "";
        if (text) chunks.push(text);
      } catch {
        buffer = `${cleanedLine}\n${buffer}`;
      }
    }

    return chunks;
  };
}

export function createPathStreamExtractor(paths: string[], options: { sse?: boolean } = {}) {
  let buffer = "";
  return (raw: string, flush = false) => {
    buffer += raw;
    const chunks: string[] = [];
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? "" : lines.pop() || "";
    for (const line of lines) {
      const candidate = options.sse ? line.replace(/^data:\s*/, "").trim() : line.trim();
      if (!candidate || candidate === "[DONE]") continue;
      try {
        const json = JSON.parse(candidate);
        const text = pickFirstPathValue(json, paths);
        if (typeof text === "string" && text) chunks.push(text);
      } catch {
        buffer = `${candidate}\n${buffer}`;
      }
    }
    return chunks;
  };
}

export function classifyProviderError(error: any): { code: ProviderErrorCode; status: number; message: string } {
  const message = error?.message || String(error || "");
  const name = error?.name || "";
  const causeCode = error?.cause?.code || "";
  if (error instanceof ProviderCallError) return { code: error.code as ProviderErrorCode, status: error.status, message: error.message };
  if (name === "AbortError") return { code: "STREAM_ABORTED", status: 499, message: "Stream was aborted." };
  if (name === "TimeoutError" || causeCode === "UND_ERR_CONNECT_TIMEOUT" || /timeout|timed out/i.test(message)) {
    return { code: "UPSTREAM_MODEL_TIMEOUT", status: 504, message: "Upstream model timed out before producing a usable response." };
  }
  if (/empty/i.test(message)) return { code: "UPSTREAM_EMPTY_RESPONSE", status: 502, message: "Upstream model returned an empty response." };
  if (/model.*not.*found|invalid.*model|Provider is incomplete/i.test(message)) {
    return { code: "INVALID_MODEL_SELECTION", status: 400, message: "Selected model is invalid or incomplete." };
  }
  return { code: "UPSTREAM_HTTP_ERROR", status: 502, message: "Upstream model request failed." };
}

export function createGeminiStreamExtractor() {
  let buffer = "";
  return (raw: string, flush = false) => {
    buffer += raw;
    const chunks: string[] = [];
    const pattern = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let lastConsumed = 0;

    for (const match of buffer.matchAll(pattern)) {
      try {
        const text = JSON.parse(`"${match[1]}"`);
        if (text) chunks.push(text);
        lastConsumed = (match.index || 0) + match[0].length;
      } catch {
        break;
      }
    }

    buffer = flush ? "" : buffer.slice(lastConsumed);
    if (buffer.length > 16_384) buffer = buffer.slice(-8_192);
    return chunks;
  };
}

function extractProviderText(data: any, responsePaths = DEFAULT_TEXT_RESPONSE_PATHS) {
  if (!data || typeof data !== "object") return "";
  const configuredText = pickFirstPathValue(data, responsePaths);
  if (typeof configuredText === "string") return configuredText;
  const choice = data.choices?.[0];
  const openAiText = choice?.message?.content || choice?.text;
  if (typeof openAiText === "string") return openAiText;
  const geminiText = data.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("");
  if (typeof geminiText === "string" && geminiText.trim()) return geminiText;
  const text = data.text || data.output_text;
  return typeof text === "string" ? text : "";
}

export async function callTextProvider(input: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  systemPrompt: string;
  userPrompt: string;
  attachments?: ProviderAttachment[];
  timeoutMs?: number;
  maxOutputTokens?: number;
  maxPromptChars?: number;
  isRealtimeSpeed?: boolean;
  temperature?: number;
  capabilities?: any;
}) {
  const providerRequest = buildTextProviderRequest({
    baseUrl: input.baseUrl,
    modelName: input.modelName,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    attachments: input.attachments || [],
    isRealtimeSpeed: input.isRealtimeSpeed ?? true,
    stream: false,
    maxOutputTokens: input.maxOutputTokens || 2048,
    maxPromptChars: input.maxPromptChars,
    temperature: input.temperature ?? 0.1,
    capabilities: input.capabilities
  });
  const response = await safeFetch(providerRequest.endpoint, {
    label: "custom AI provider URL",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify(providerRequest.payload),
    signal: AbortSignal.timeout(input.timeoutMs || 20_000)
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new HttpError(502, `Provider request failed with HTTP ${response.status}.`);
  }
  const data = await response.json().catch(() => null);
  const text = extractProviderText(data, providerRequest.responsePaths).trim();
  if (!text) throw new HttpError(502, "Provider returned empty text.");
  return { text, isGeminiNative: providerRequest.isGeminiNative };
}
