import type express from "express";
import { safeAxiosGet, safeAxiosPost } from "../../security/safe-outbound";
import { HttpError, sendApiError } from "../../shared/http";
import { requireAuth, requireRoles } from "../auth/auth.shared";
import { AuditAction, UserRole } from "@prisma/client";
import { writeAuditLog } from "../audit/audit.service";
import { buildPayload, nowMs, toProviderUrl } from "../custom-ai/provider-client";
import { prisma } from "../../db/prisma";
import { decryptSecret } from "../../security/crypto";

export type WorkflowAiClient = {
  models: {
    generateContent(input: any): Promise<any>;
  };
};

const PIPELINE_INSTRUCTIONS: Record<string, string> = {
  "01": "Professional Executive Film Producer and Story Consultant. Create a structured film synopsis.",
  "02": "Award-winning Screenwriter. Produce a formatted film screenplay scene.",
  "03": "Storyboard Artist and Director of Photography. Generate a pre-visualization shot list.",
  "04": "Concept Artist. Generate a character/environment concept sheet.",
  "05": "Technical Art Director. Generate a 3D Asset Production Specification.",
  "06": "Pre-viz Director and Animator. Create a detailed blocking and animation prep log.",
  "07": "Technical Gaffer and Key Grip. Build a professional green-screen stage blueprint.",
  "08": "VFX Pipeline TD. Design a compositing node pipeline specification.",
  "09": "Chief Film Editor. Generate a professional Dailies log and edit pacing directive.",
  "10": "Film Composer and Sound Designer. Design a rich Audio Cue Sheet.",
  "11": "Master Colorist. Formulate a LUT design and primary grading setup.",
  "12": "Mastering & Delivery Director. Prepare a final DCP packaging checklist."
};

const PIPELINE_GENERATE_TIMEOUT_MS = Number(process.env.PIPELINE_GENERATE_TIMEOUT_MS || 90_000);
const PIPELINE_MAX_PROMPT_CHARS = Number(process.env.PIPELINE_MAX_PROMPT_CHARS || 8_000);

function compactPipelinePrompt(value: string) {
  if (value.length <= PIPELINE_MAX_PROMPT_CHARS) return value;
  const head = value.slice(0, Math.floor(PIPELINE_MAX_PROMPT_CHARS * 0.7));
  const tail = value.slice(-Math.floor(PIPELINE_MAX_PROMPT_CHARS * 0.3));
  return `${head}\n\n[Pipeline prompt truncated to reduce generation latency.]\n\n${tail}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new HttpError(504, "Pipeline model request timed out.", "UPSTREAM_MODEL_TIMEOUT", { timeoutMs })), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function registerWorkflowSupportRoutes(app: express.Express, dependencies: { getAI: () => WorkflowAiClient }) {
  app.post("/api/pipeline/generate", async (req, res) => {
    const requestStartedAt = nowMs();
    let authCompletedAt = 0;
    let promptBuiltAt = 0;
    let upstreamStartedAt = 0;
    try {
      await requireAuth(req);
      authCompletedAt = nowMs();
      const { nodeId, nodeName, projectName, prompt, extraData } = req.body;
      if (!nodeId || !nodeName) {
        res.status(400).json({ error: "Missing parameters." });
        return;
      }

      const ai = dependencies.getAI();
      const systemInstruction = PIPELINE_INSTRUCTIONS[nodeId] || "Expert film visual designer. Assist with professional advice and technical specs.";

      const compiledPrompt = compactPipelinePrompt(`
Project Context: ${projectName || "Untitled Project"}
Current Pipeline Stage: Node ${nodeId} - ${nodeName}
User Goal / Idea: ${prompt}
Additional Parameters: ${JSON.stringify(extraData || {})}

Please write a highly stylized, professional response in Markdown. Use film industry terminology. Keep formatting extremely tidy, technical, and beautiful.
`);
      promptBuiltAt = nowMs();

      upstreamStartedAt = nowMs();
      const response = await withTimeout(ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: compiledPrompt,
        config: { systemInstruction, temperature: 0.75 }
      }), PIPELINE_GENERATE_TIMEOUT_MS);

      const resultText = response.text || "";
      if (!resultText.trim()) {
        throw new HttpError(502, "Pipeline model returned empty text.", "UPSTREAM_EMPTY_RESPONSE", {
          totalMs: nowMs() - requestStartedAt,
          upstreamMs: nowMs() - upstreamStartedAt
        });
      }

      console.info("[pipeline-generate] completed", {
        nodeId,
        authMs: authCompletedAt - requestStartedAt,
        promptBuildMs: promptBuiltAt - authCompletedAt,
        upstreamMs: nowMs() - upstreamStartedAt,
        totalMs: nowMs() - requestStartedAt,
        promptChars: compiledPrompt.length
      });

      res.json({
        success: true,
        result: resultText,
        timestamp: new Date().toISOString(),
        diagnostics: {
          authMs: authCompletedAt - requestStartedAt,
          promptBuildMs: promptBuiltAt - authCompletedAt,
          upstreamMs: nowMs() - upstreamStartedAt,
          totalMs: nowMs() - requestStartedAt,
          promptChars: compiledPrompt.length
        }
      });
    } catch (error: any) {
      console.warn("[pipeline-generate] failed", {
        totalMs: nowMs() - requestStartedAt,
        authMs: authCompletedAt ? authCompletedAt - requestStartedAt : null,
        promptBuildMs: promptBuiltAt && authCompletedAt ? promptBuiltAt - authCompletedAt : null,
        upstreamMs: upstreamStartedAt ? nowMs() - upstreamStartedAt : null,
        code: error?.code || null,
        error: error?.message || String(error)
      });
      sendApiError(res, error, "Pipeline generation failed.");
    }
  });

  app.get("/api/workflow/check", async (req, res) => {
    try {
      await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const hasKey = !!process.env.GEMINI_API_KEY;
      if (!hasKey) {
        res.json({
          status: "error",
          message: "GEMINI_API_KEY is not configured. AI diagnostics are unavailable.",
          details: { hasKey: false, testPassed: false }
        });
        return;
      }

      const ai = dependencies.getAI();
      console.log("[WorkflowCheck] Running diagnostic check...");
      const testResp = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: "Confirm connectivity: output only 'ONLINE'."
      });

      const trimText = testResp.text ? testResp.text.trim() : "";
      const passed = trimText.length > 0;
      res.json({
        status: "ok",
        message: passed ? "API diagnostic passed." : "API diagnostic returned an empty response.",
        details: {
          hasKey: true,
          testPassed: passed,
          selectedModel: "gemini-1.5-flash",
          imageModel: "gemini-2.5-flash-image",
          responseSnippet: trimText || null
        }
      });
    } catch (err: any) {
      console.error("[WorkflowCheck] Diagnostic check failed:", err);
      res.status(err?.status || 500).json({
        status: "error",
        message: err?.status ? err.message : "API diagnostic failed.",
        details: { hasKey: !!process.env.GEMINI_API_KEY, testPassed: false }
      });
    }
  });

  app.post("/api/api-configs/test", async (req, res) => {
    const startedAt = Date.now();
    try {
      const actor = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
      const { provider, alias, type } = req.body;
      const configId = typeof req.body?.configId === "string" && !req.body.configId.startsWith("draft_")
        ? req.body.configId.trim()
        : "";
      const savedConfig = configId
        ? await prisma.customApiConfig.findFirst({ where: { id: configId, ownerId: null } })
        : null;
      const baseUrl = String(req.body?.baseUrl || savedConfig?.baseUrl || "").trim();
      const modelName = String(req.body?.modelName || savedConfig?.modelName || "").trim();
      const apiKey = String(req.body?.apiKey || (savedConfig?.encryptedKey ? decryptSecret(savedConfig.encryptedKey) : "") || "").trim();
      const effectiveType = String(type || savedConfig?.type || "").trim().toLowerCase();
      if (!baseUrl) {
        res.status(400).json({ success: false, error: "Base URL is required for test" });
        return;
      }
      let cleanBase = baseUrl.trim();
      if (cleanBase.endsWith("/")) cleanBase = cleanBase.slice(0, -1);
      const providerTarget = modelName ? toProviderUrl(baseUrl, modelName) : null;
      const shouldUseGenerationProbeFirst = effectiveType === "text"
        || Boolean(providerTarget?.isGeminiNative || cleanBase.toLowerCase().includes("chat/completions"));
      const cleanUrl = cleanBase.toLowerCase().endsWith("/v1")
        ? cleanBase
        : `${cleanBase}/v1`.replace(/\/v1\/v1/g, "/v1");
      const safeHost = (() => {
        try {
          return new URL(cleanUrl).host;
        } catch {
          return null;
        }
      })();

      const writeConnectionAudit = async (input: { success: boolean; status?: number | null; error?: string | null; latencyMs: number }) => {
        await writeAuditLog({
          actor,
          action: AuditAction.ACCESS,
          entityType: "CustomApiConfigConnectionTest",
          req,
          metadata: {
            success: input.success,
            status: input.status ?? null,
            error: input.error ?? null,
            latencyMs: input.latencyMs,
            provider: typeof provider === "string" ? provider.slice(0, 80) : savedConfig?.provider || null,
            alias: typeof alias === "string" ? alias.slice(0, 120) : savedConfig?.alias || null,
            type: effectiveType || null,
            modelName: modelName ? modelName.slice(0, 120) : null,
            host: safeHost
          }
        });
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        const authHeaders = {
          ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "application/json"
        };
        const runGenerationProbe = async (reason: string) => {
          if (!providerTarget || !modelName || !apiKey) {
            const latency = Date.now() - startedAt;
            await writeConnectionAudit({ success: false, status: null, error: `${reason}_missing_model_or_key`, latencyMs: latency });
            res.json({
              success: false,
              error: '请填写模型 ID 和 API Key 后再用实际生成接口测试。'
            });
            return true;
          }
          const payload = buildPayload({
            systemPrompt: "Connection diagnostic. Reply with OK only.",
            userPrompt: "OK",
            modelName: String(modelName).trim(),
            isGeminiNative: providerTarget.isGeminiNative,
            stream: false,
            maxOutputTokens: 8,
            maxPromptChars: 64,
            temperature: 0
          });
          const probeResponse = await safeAxiosPost(providerTarget.url, payload, {
            label: "baseUrl",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders
            },
            timeout: 8000,
            validateStatus: null
          });
          const totalLatency = Date.now() - startedAt;
          if (probeResponse.status >= 200 && probeResponse.status < 300) {
            await writeConnectionAudit({ success: true, status: probeResponse.status, latencyMs: totalLatency });
            res.json({
              success: true,
              message: `${reason === 'direct_generation_probe' ? '实际生成接口' : '/models 不可用，但实际生成接口'}探测成功：HTTP ${probeResponse.status}，耗时 ${totalLatency}ms。`
            });
            return true;
          }
          const errorPreview = typeof probeResponse.data === "string" ? probeResponse.data.slice(0, 240) : JSON.stringify(probeResponse.data || {}).slice(0, 240);
          await writeConnectionAudit({ success: false, status: probeResponse.status, error: "generation_probe_failed", latencyMs: totalLatency });
          res.json({
            success: false,
            error: `实际生成接口探测失败：HTTP ${probeResponse.status}${errorPreview ? `，${errorPreview}` : ''}`
          });
          return true;
        };

        if (shouldUseGenerationProbeFirst) {
          clearTimeout(timeoutId);
          await runGenerationProbe('direct_generation_probe');
          return;
        }

        const response = await safeAxiosGet(`${cleanUrl}/models`, {
          label: "baseUrl",
          headers: authHeaders,
          signal: controller.signal,
          timeout: 6000,
          validateStatus: null
        });
        clearTimeout(timeoutId);
        const latency = Date.now() - startedAt;

        if (response.status === 200) {
          await writeConnectionAudit({ success: true, status: response.status, latencyMs: latency });
          res.json({
            success: true,
            message: `模型列表连接成功：HTTP ${response.status}，耗时 ${latency}ms。`
          });
        } else if (response.status === 401 || response.status === 403) {
          await writeConnectionAudit({ success: false, status: response.status, error: "auth_failed", latencyMs: latency });
          res.json({
            success: false,
            error: `连接已到达供应商，但鉴权失败：HTTP ${response.status}。请检查 API Key 或供应商权限。`
          });
          } else if (response.status === 404 || response.status === 405) {
          if (!modelName || !apiKey) {
            await writeConnectionAudit({ success: false, status: response.status, error: "models_endpoint_unsupported", latencyMs: latency });
            res.json({
              success: false,
              error: `供应商不支持 /models 测试端点（HTTP ${response.status}）。请填写模型 ID 和 API Key 后再用实际生成接口测试。`
            });
            return;
          }
          await runGenerationProbe('models_endpoint_unsupported');
        } else {
          const txt = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
          console.warn("[ApiConfigTest] Provider test failed", { status: response.status, bodyPreviewLength: txt.length });
          await writeConnectionAudit({ success: false, status: response.status, error: "unexpected_http_status", latencyMs: latency });
          res.json({
            success: false,
            error: `Connection test failed with HTTP ${response.status}.`
          });
        }
          } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        const latency = Date.now() - startedAt;
        if (fetchErr instanceof HttpError) {
          await writeConnectionAudit({ success: false, status: fetchErr.status, error: fetchErr.message, latencyMs: latency });
          throw fetchErr;
        }
        if (fetchErr.name === "AbortError") {
          await writeConnectionAudit({ success: false, status: null, error: "timeout", latencyMs: latency });
          res.json({
            success: false,
            error: "Connection timed out after 6 seconds. Check the base URL or network."
          });
        } else {
          const rawMessage = fetchErr?.message || "unknown";
          console.warn("[ApiConfigTest] Connection test failed", { latencyMs: latency, message: rawMessage });
          await writeConnectionAudit({ success: false, status: null, error: fetchErr?.message || "unknown", latencyMs: latency });
          const isProxyRefused = /ECONNREFUSED\s+127\.0\.0\.1:7897/i.test(rawMessage);
          res.json({
            success: false,
            error: isProxyRefused
              ? `连接测试失败：后端代理指向 127.0.0.1:7897，但容器内无法访问该代理。请使用容器可访问的代理地址，或关闭代理后重试。`
              : `连接测试失败：${rawMessage}（耗时 ${latency}ms）`
          });
        }
      }
    } catch (err: any) {
      sendApiError(res, err, "API config test failed.");
    }
  });
}
