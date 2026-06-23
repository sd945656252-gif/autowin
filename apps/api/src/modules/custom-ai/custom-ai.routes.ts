import crypto from "crypto";
import type express from "express";
import { ModelCapability, UserRole, WorkflowRunStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { safeFetch } from "../../security/safe-outbound";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth, requireRoles } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { resolveCustomApiRuntimeConfig } from "../custom-api-configs/custom-api-configs.service";
import { setWorkflowTask, setWorkflowTaskRunLink } from "../workflow/workflow-task.store";
import { buildTextProviderRequest, callTextProvider, classifyProviderError, createGeminiStreamExtractor, createOpenAiStreamExtractor, createPathStreamExtractor, nowMs, ProviderCallError } from "./provider-client";

type Attachment = {
  mimeType?: string;
  data?: string;
  name?: string;
};

const MAX_ATTACHMENT_COUNT = 6;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const STREAM_UPSTREAM_TIMEOUT_MS = Number(process.env.CUSTOM_AI_STREAM_TIMEOUT_MS || 180_000);
const TASK_UPSTREAM_TIMEOUT_MS = Number(process.env.CUSTOM_AI_TASK_TIMEOUT_MS || 180_000);
const MAX_TASK_PROMPT_COUNT = Number(process.env.CUSTOM_AI_TASK_PROMPT_COUNT_MAX || 10);

const FAST_DIRECTOR_SYSTEM_PROMPT = `你是“提示词优化”的快速视频提示词导演。目标是把用户输入快速转成可直接用于视频生成的中文导演提示词。

输出要求：
1. 立刻输出正文，不要寒暄、不要解释、不要展示思考过程。
2. 优先保留用户的核心人物、动作、情绪、场景、镜头和风格要求。
3. 用连续自然中文描述，强调镜头语言、表演状态、光影、运动节奏、物理细节和可执行画面。
4. 严格贴合字数限制；不要为了堆砌而扩写无关背景。
5. 如果输入信息不足，直接补全为一个高质量、可执行的电影级镜头描述。`;

function estimateBase64Bytes(value?: string) {
  if (!value) return 0;
  return Math.ceil(value.length * 0.75);
}

function assertAttachmentLimits(attachments: Attachment[]) {
  if (attachments.length > MAX_ATTACHMENT_COUNT) throw new ProviderCallError(413, "Too many attachments.", "ATTACHMENT_TOO_LARGE", { maxCount: MAX_ATTACHMENT_COUNT, count: attachments.length });
  let totalBytes = 0;
  for (const attachment of attachments) {
    const size = estimateBase64Bytes(attachment.data);
    if (size > MAX_ATTACHMENT_BYTES) throw new ProviderCallError(413, "Attachment is too large.", "ATTACHMENT_TOO_LARGE", { maxBytes: MAX_ATTACHMENT_BYTES, bytes: size, name: attachment.name || null });
    totalBytes += size;
  }
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new ProviderCallError(413, "Total attachment size is too large.", "ATTACHMENT_TOO_LARGE", { maxTotalBytes: MAX_TOTAL_ATTACHMENT_BYTES, totalBytes });
}

function sanitizeTextTaskInput(input: any) {
  return {
    kind: "custom_ai_text_task",
    configId: input.configId || input.customModelId || null,
    systemPrompt: typeof input.systemPrompt === "string" ? input.systemPrompt.slice(0, 4000) : null,
    userPrompt: typeof input.userPrompt === "string" ? input.userPrompt.slice(0, 8000) : null,
    attachments: Array.isArray(input.attachments)
      ? input.attachments.map((attachment: Attachment) => ({
          name: attachment.name || null,
          mimeType: attachment.mimeType || null,
          hasData: Boolean(attachment.data)
        }))
      : [],
    isRealtimeSpeed: Boolean(input.isRealtimeSpeed),
    promptCount: Number.isFinite(Number(input.promptCount)) ? Math.max(1, Math.min(MAX_TASK_PROMPT_COUNT, Number(input.promptCount))) : 1,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : null
  };
}

async function markTextTaskRun(runId: string, status: WorkflowRunStatus, data: { outputJson?: any; error?: string } = {}) {
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status,
      ...(status === WorkflowRunStatus.RUNNING ? { startedAt: new Date() } : {}),
      ...(status === WorkflowRunStatus.SUCCEEDED || status === WorkflowRunStatus.FAILED || status === WorkflowRunStatus.CANCELED ? { finishedAt: new Date() } : {}),
      ...(data.outputJson !== undefined ? { outputJson: data.outputJson } : {}),
      ...(data.error ? { error: data.error } : {})
    }
  }).catch((error) => console.warn("[custom-ai-task] Failed to update WorkflowRun:", error?.message || error));
}

async function executeTextTaskInBackground(input: {
  taskId: string;
  runId: string;
  ownerId: string;
  role: UserRole | "GUEST";
  configId: string;
  systemPrompt: string;
  userPrompt: string;
  attachments: Attachment[];
  isRealtimeSpeed: boolean;
  promptCount: number;
}) {
  const startedAt = nowMs();
  await markTextTaskRun(input.runId, WorkflowRunStatus.RUNNING);
  await setWorkflowTask(input.taskId, {
    ownerId: input.ownerId,
    runId: input.runId,
    progress: 12,
    status: "Text generation running",
    completed: false
  });

  try {
    const runtime = await resolveCustomApiRuntimeConfig({
      useCustomApi: true,
      customConfigId: input.configId,
      expectedCapability: ModelCapability.TEXT_GENERATOR,
      ownerId: input.ownerId,
      role: input.role,
      audit: undefined
    });
    if (!runtime.customUrl || !runtime.customKey || !runtime.customModel) throw new HttpError(400, "Provider is incomplete.");

    await setWorkflowTask(input.taskId, {
      ownerId: input.ownerId,
      runId: input.runId,
      progress: 35,
      status: "Waiting for text model",
      completed: false
    });

    const promptCount = Math.max(1, Math.min(MAX_TASK_PROMPT_COUNT, Math.floor(input.promptCount || 1)));
    const outputs: string[] = [];
    let isGeminiNative = false;
    for (let index = 0; index < promptCount; index += 1) {
      if (promptCount > 1) {
        await setWorkflowTask(input.taskId, {
          ownerId: input.ownerId,
          runId: input.runId,
          progress: Math.min(95, 35 + Math.round((index / promptCount) * 60)),
          status: `Waiting for text model (${index + 1}/${promptCount})`,
          completed: false
        });
      }
      const result = await callTextProvider({
        baseUrl: runtime.customUrl,
        apiKey: runtime.customKey,
        modelName: runtime.customModel,
        systemPrompt: input.systemPrompt || FAST_DIRECTOR_SYSTEM_PROMPT,
        userPrompt: promptCount > 1
          ? `${input.userPrompt}\n\n请生成第 ${index + 1} 条独立版本，避免与前面版本重复。`
          : input.userPrompt,
        attachments: input.attachments,
        timeoutMs: TASK_UPSTREAM_TIMEOUT_MS,
        maxOutputTokens: input.isRealtimeSpeed ? 4096 : 8192,
        maxPromptChars: input.isRealtimeSpeed ? 6000 : 12000,
        isRealtimeSpeed: input.isRealtimeSpeed,
        temperature: promptCount > 1 ? 0.65 : input.isRealtimeSpeed ? 0.15 : 0.7,
        capabilities: runtime.textCapabilities
      });
      isGeminiNative = result.isGeminiNative;
      outputs.push(result.text.trim());
    }

    const outputText = promptCount > 1
      ? outputs.map((text, index) => `### [PROMPT_ENTRY_${index + 1}]\n${text}`).join("\n\n")
      : outputs[0] || "";
    await setWorkflowTask(input.taskId, {
      ownerId: input.ownerId,
      runId: input.runId,
      progress: 100,
      status: "Generation completed",
      output_text: outputText,
      completed: true
    });
    await markTextTaskRun(input.runId, WorkflowRunStatus.SUCCEEDED, {
      outputJson: {
        taskId: input.taskId,
        outputText,
        output_text: outputText,
        model: runtime.customModel,
        isGeminiNative,
        promptCount,
        elapsedMs: nowMs() - startedAt
      }
    });
  } catch (error: any) {
    const classified = classifyProviderError(error);
    await setWorkflowTask(input.taskId, {
      ownerId: input.ownerId,
      runId: input.runId,
      progress: 100,
      status: "Execution failed",
      error: classified.message,
      completed: true
    });
    await markTextTaskRun(input.runId, WorkflowRunStatus.FAILED, { error: classified.message });
    console.warn("[custom-ai-task] failed", {
      taskId: input.taskId,
      runId: input.runId,
      code: classified.code,
      elapsedMs: nowMs() - startedAt,
      error: error?.message || "Generation failed."
    });
  }
}

export function registerCustomAiRoutes(app: express.Express) {
  app.post("/api/custom-ai/test", async (req, res) => {
    try {
      const requestUser = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const configId = String(req.body?.customModelId || req.body?.configId || "").trim();
      if (!configId) throw new HttpError(400, "configId is required.");
      const runtime = await resolveCustomApiRuntimeConfig({
        useCustomApi: true,
        customConfigId: configId,
        expectedCapability: ModelCapability.TEXT_GENERATOR,
        ownerId: requestUser.id,
        role: requestUser.role,
        audit: { actor: requestUser, req, source: "custom-ai-test" }
      });
      if (!runtime.customUrl || !runtime.customKey) throw new HttpError(400, "Provider is incomplete.");

      const cleanBase = runtime.customUrl.replace(/\/+$/, "");
      const testUrl = cleanBase.toLowerCase().endsWith("/v1") ? `${cleanBase}/models` : `${cleanBase}/v1/models`.replace(/\/v1\/v1/g, "/v1");
      const response = await safeFetch(testUrl, {
        label: "provider test URL",
        headers: { Authorization: `Bearer ${runtime.customKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(6000)
      });
      res.json({ success: [200, 401, 404].includes(response.status), status: response.status });
    } catch (error: any) {
      sendApiError(res, error, "Custom AI provider test failed.");
    }
  });

  app.post("/api/custom-ai/tasks", async (req, res) => {
    try {
      const requestUser = await requireAuth(req);
      const configId = String(req.body?.customModelId || req.body?.configId || "").trim();
      const systemPrompt = String(req.body?.systemPrompt || FAST_DIRECTOR_SYSTEM_PROMPT);
      const userPrompt = String(req.body?.userPrompt || "");
      const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments as Attachment[] : [];
      const isRealtimeSpeed = Boolean(req.body?.isRealtimeSpeed);
      const promptCount = Math.max(1, Math.min(MAX_TASK_PROMPT_COUNT, Math.floor(Number(req.body?.promptCount || 1))));
      if (!configId) throw new HttpError(400, "configId is required.");
      if (!systemPrompt || !userPrompt) throw new HttpError(400, "systemPrompt and userPrompt are required.");
      assertAttachmentLimits(attachments);

      const taskId = crypto.randomUUID();
      const run = await prisma.workflowRun.create({
        data: {
          ownerId: requestUser.id,
          status: WorkflowRunStatus.QUEUED,
          inputJson: sanitizeTextTaskInput(req.body)
        }
      });

      await setWorkflowTaskRunLink(taskId, { ownerId: requestUser.id, runId: run.id });
      await setWorkflowTask(taskId, {
        ownerId: requestUser.id,
        runId: run.id,
        progress: 0,
        status: "Text generation queued",
        completed: false
      });

      void executeTextTaskInBackground({
        taskId,
        runId: run.id,
        ownerId: requestUser.id,
        role: requestUser.role,
        configId,
        systemPrompt,
        userPrompt,
        attachments,
        isRealtimeSpeed,
        promptCount
      });

      await writeAuditLog({
        actor: requestUser,
        action: "EXECUTE",
        entityType: "WorkflowRun",
        entityId: run.id,
        req,
        afterJson: {
          taskId,
          nodeType: "custom_ai_text",
          configId,
          metadata: req.body?.metadata || null
        }
      });

      res.json({ success: true, task_id: taskId, run_id: run.id });
    } catch (error: any) {
      sendApiError(res, error, "Custom AI text task failed.");
    }
  });

  app.post("/api/custom-ai/stream", async (req, res) => {
    const requestStartedAt = nowMs();
    let authCompletedAt = 0;
    let promptBuiltAt = 0;
    let upstreamStartedAt = 0;
    let providerRespondedAt = 0;
    let firstChunkAt = 0;
    let outputChars = 0;
    try {
      const requestUser = await requireAuth(req);
      authCompletedAt = nowMs();
      const configId = String(req.body?.customModelId || req.body?.configId || "").trim();
      const systemPrompt = String(req.body?.systemPrompt || "");
      const userPrompt = String(req.body?.userPrompt || "");
      const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments as Attachment[] : [];
      const isRealtimeSpeed = Boolean(req.body?.isRealtimeSpeed);
      if (!configId) throw new HttpError(400, "configId is required.");
      if (!systemPrompt || !userPrompt) throw new HttpError(400, "systemPrompt and userPrompt are required.");
      assertAttachmentLimits(attachments);

      const runtime = await resolveCustomApiRuntimeConfig({
        useCustomApi: true,
        customConfigId: configId,
        expectedCapability: ModelCapability.TEXT_GENERATOR,
        ownerId: requestUser.id,
        role: requestUser.role,
        audit: { actor: requestUser, req, source: "custom-ai-stream" }
      });
      if (!runtime.customUrl || !runtime.customKey || !runtime.customModel) throw new HttpError(400, "Provider is incomplete.");

      const providerRequest = buildTextProviderRequest({
        baseUrl: runtime.customUrl,
        modelName: runtime.customModel,
        systemPrompt,
        userPrompt,
        attachments,
        isRealtimeSpeed,
        stream: true,
        capabilities: runtime.textCapabilities
      });
      const { endpoint: url, payload, isGeminiNative } = providerRequest;
      promptBuiltAt = nowMs();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: isGeminiNative ? "application/json" : "text/event-stream",
        Authorization: `Bearer ${runtime.customKey}`
      };

      upstreamStartedAt = nowMs();
      const response = await safeFetch(url, {
        label: "custom AI provider URL",
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(STREAM_UPSTREAM_TIMEOUT_MS)
      });
      providerRespondedAt = nowMs();
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        console.warn("[custom-ai-stream] provider request failed", { status: response.status, bodyPreviewLength: text.length });
        throw new HttpError(502, `Provider request failed with HTTP ${response.status}.`);
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Jiying-Proxy-TTFB-Ms", String(providerRespondedAt - requestStartedAt));
      res.setHeader("X-Jiying-Auth-Ms", String(authCompletedAt - requestStartedAt));
      res.setHeader("X-Jiying-Prompt-Build-Ms", String(promptBuiltAt - authCompletedAt));
      res.setHeader("X-Jiying-Upstream-Timeout-Ms", String(STREAM_UPSTREAM_TIMEOUT_MS));
      res.flushHeaders?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const hasCustomStreamPaths = !isGeminiNative && Array.isArray(runtime.textCapabilities?.runtime?.streamChunkPaths) && runtime.textCapabilities.runtime.streamChunkPaths.length > 0;
      const extractText = hasCustomStreamPaths
        ? createPathStreamExtractor(providerRequest.streamChunkPaths, { sse: !isGeminiNative })
        : isGeminiNative ? createGeminiStreamExtractor() : createOpenAiStreamExtractor();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const raw = decoder.decode(value, { stream: true });
        const texts = extractText(raw);
        for (const text of texts) {
          if (!firstChunkAt) firstChunkAt = nowMs();
          outputChars += text.length;
          res.write(text);
        }
      }

      for (const text of extractText(decoder.decode(), true)) {
        if (!firstChunkAt) firstChunkAt = nowMs();
        outputChars += text.length;
        res.write(text);
      }
      res.end();
      console.info("[custom-ai-stream] completed", {
        provider: isGeminiNative ? "gemini-native" : "openai-compatible",
        model: runtime.customModel,
        authMs: authCompletedAt - requestStartedAt,
        promptBuildMs: promptBuiltAt - authCompletedAt,
        upstreamRequestMs: providerRespondedAt - upstreamStartedAt,
        proxyTtfbMs: providerRespondedAt - requestStartedAt,
        firstTextMs: firstChunkAt ? firstChunkAt - requestStartedAt : null,
        totalMs: nowMs() - requestStartedAt,
        outputChars,
        promptChars: systemPrompt.length + userPrompt.length,
        attachments: attachments.length
      });
    } catch (error: any) {
      const classified = classifyProviderError(error);
      console.warn("[custom-ai-stream] failed", {
        totalMs: nowMs() - requestStartedAt,
        authMs: authCompletedAt ? authCompletedAt - requestStartedAt : null,
        promptBuildMs: promptBuiltAt && authCompletedAt ? promptBuiltAt - authCompletedAt : null,
        upstreamRequestMs: providerRespondedAt && upstreamStartedAt ? providerRespondedAt - upstreamStartedAt : null,
        providerTtfbMs: providerRespondedAt ? providerRespondedAt - requestStartedAt : null,
        firstTextMs: firstChunkAt ? firstChunkAt - requestStartedAt : null,
        code: classified.code,
        error: error?.message || "Generation failed."
      });
      if (res.headersSent) {
        res.end(`\n[Custom AI error] ${classified.code}: ${classified.message}`);
        return;
      }
      if (!(error instanceof HttpError)) {
        sendApiError(res, new ProviderCallError(classified.status, classified.message, classified.code, {
          totalMs: nowMs() - requestStartedAt,
          providerTtfbMs: providerRespondedAt ? providerRespondedAt - requestStartedAt : null,
          firstTextMs: firstChunkAt ? firstChunkAt - requestStartedAt : null
        }), "Custom AI generation failed.");
        return;
      }
      sendApiError(res, error, "Custom AI generation failed.");
    }
  });
}
