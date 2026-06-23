import { ModelCapability, UserRole, type CustomApiConfig } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../shared/http";
import type { RequestUser } from "../auth/auth.shared";
import { callTextProvider, nowMs } from "../custom-ai/provider-client";
import { resolveCustomApiRuntimeConfig } from "../custom-api-configs/custom-api-configs.service";
import { normalizeScriptRows, scriptBreakdownRowsSchema, type ScriptBreakdownRowInput } from "./script-breakdown.shared";

const SCRIPT_TEXT_MODEL_ORDER = [{ updatedAt: "desc" as const }, { alias: "asc" as const }];
const SCRIPT_BREAKDOWN_MAX_PROMPT_CHARS = Number(process.env.SCRIPT_BREAKDOWN_MAX_PROMPT_CHARS || 80_000);
const SCRIPT_BREAKDOWN_MAX_OUTPUT_TOKENS = Number(process.env.SCRIPT_BREAKDOWN_MAX_OUTPUT_TOKENS || 12_000);
const SCRIPT_BREAKDOWN_TIMEOUT_MS = Number(process.env.SCRIPT_BREAKDOWN_TIMEOUT_MS || 60_000);

export type ScriptBreakdownModelAttempt = {
  configId: string;
  alias: string;
  provider: string;
  modelName: string;
  attempt: number;
  elapsedMs: number;
  error: string;
};

export type ScriptBreakdownModelResult = {
  rows: ScriptBreakdownRowInput[];
  model: {
    configId: string;
    alias: string;
    provider: string;
    modelName: string;
    elapsedMs: number;
    fallbackAttempts: number;
  };
  attempts: ScriptBreakdownModelAttempt[];
};

export function stripJsonMarkdown(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstArray = trimmed.indexOf("[");
  const lastArray = trimmed.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) return trimmed.slice(firstArray, lastArray + 1);
  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) return trimmed.slice(firstObject, lastObject + 1);
  return trimmed;
}

function parseAiRows(raw: string): ScriptBreakdownRowInput[] {
  const cleaned = stripJsonMarkdown(raw);
  const parsed = JSON.parse(cleaned);
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  return normalizeScriptRows(scriptBreakdownRowsSchema.parse(rows));
}

function sanitizeModelError(error: any) {
  return String(error?.message || error || "模型调用失败。")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function safeModelInfo(config: Pick<CustomApiConfig, "id" | "alias" | "provider" | "modelName">) {
  return {
    configId: config.id,
    alias: config.alias,
    provider: config.provider || "Custom",
    modelName: config.modelName
  };
}

async function loadScriptTextModelConfigs() {
  return prisma.customApiConfig.findMany({
    where: {
      ownerId: null,
      isEnabled: true,
      capability: ModelCapability.TEXT_GENERATOR,
      encryptedKey: { not: null }
    },
    orderBy: SCRIPT_TEXT_MODEL_ORDER
  });
}

function scriptAiRequestUser(ownerId: string): RequestUser {
  return { id: ownerId, role: UserRole.USER, isGuest: false };
}

function buildBreakdownPrompts(input: { text: string; mode: "file" | "idea"; repairOnly?: boolean }) {
  const systemPrompt = "你是 JIYING 的影视工业分镜拆解系统。请严格输出 JSON，不要输出 Markdown、解释或额外文字。";
  const repairInstruction = input.repairOnly
    ? "\n\n上一次输出未通过 JSON schema 校验。请只重新输出合法 JSON 数组，不要 Markdown，不要解释。"
    : "";
  const userPrompt = `任务：${input.mode === "idea" ? "先将用户创意扩写成连续剧情，再拆解成分镜表。" : "将剧本文本拆解成分镜表。"}

字段要求：每一行必须包含以下全部字段，空值用空字符串，不要缺字段：
orderIndex, shotSize, shot, cameraMovement, characters, scene, action, props, composition, emotion, lighting, soundEffect, dialogueOrVoiceover, vfx, duration, motionSpeed, dynamic, storyboardImagePrompt, storyboardVideoPrompt, sourceText, confidence

规则：
1. 每行对应一个镜头或明确剧情单元。
2. 不凭空添加与剧情无关的角色、道具或特效。
3. 信息不足可以合理补全，但 confidence 必须低于 0.65。
4. storyboardImagePrompt 必须基于本行的景别、镜头、角色、场景、动作、道具、构图、情绪、光影、特效生成，强调静态画面，不写时间流动和复杂镜头运动。
5. storyboardVideoPrompt 必须基于本行全部动态相关字段生成，强调镜头运动、动作、环境变化、声音、节奏、时长、运动速度和动态过程，对白/旁白需要自然整合。
6. 正常内容使用中文，专业模型名或固定英文名可保留英文。
7. 输出 JSON 数组，最多 80 行。

待处理文本：
${input.text.slice(0, SCRIPT_BREAKDOWN_MAX_PROMPT_CHARS)}${repairInstruction}`;

  return { systemPrompt, userPrompt };
}

export async function generateScriptBreakdownRows(input: { text: string; mode: "file" | "idea"; ownerId: string }): Promise<ScriptBreakdownModelResult> {
  const configs = await loadScriptTextModelConfigs();
  const attempts: ScriptBreakdownModelAttempt[] = [];
  const actor = scriptAiRequestUser(input.ownerId);

  if (configs.length === 0) {
    throw new HttpError(
      400,
      "模型中心没有可用的文字生成模型，请先在配置与监控 > 模型中心配置并启用文字生成模型。",
      "SCRIPT_TEXT_MODEL_NOT_CONFIGURED"
    );
  }

  for (const config of configs) {
    const modelInfo = safeModelInfo(config);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const startedAt = nowMs();
      try {
        const runtime = await resolveCustomApiRuntimeConfig({
          useCustomApi: true,
          customConfigId: config.id,
          expectedCapability: ModelCapability.TEXT_GENERATOR,
          ownerId: input.ownerId,
          role: UserRole.USER,
          audit: { actor, source: "script_breakdown" }
        });
        if (!runtime.customUrl || !runtime.customKey || !runtime.customModel) throw new Error("文字生成模型配置不完整。");

        const prompts = buildBreakdownPrompts({ ...input, repairOnly: attempt > 1 });
        const response = await callTextProvider({
          baseUrl: runtime.customUrl,
          apiKey: runtime.customKey,
          modelName: runtime.customModel,
          systemPrompt: prompts.systemPrompt,
          userPrompt: prompts.userPrompt,
          timeoutMs: SCRIPT_BREAKDOWN_TIMEOUT_MS,
          maxOutputTokens: SCRIPT_BREAKDOWN_MAX_OUTPUT_TOKENS,
          maxPromptChars: SCRIPT_BREAKDOWN_MAX_PROMPT_CHARS,
          isRealtimeSpeed: false,
          temperature: attempt === 1 ? 0.35 : 0.15,
          capabilities: runtime.textCapabilities
        });
        const rows = parseAiRows(response.text);
        return {
          rows,
          model: {
            ...modelInfo,
            elapsedMs: nowMs() - startedAt,
            fallbackAttempts: attempts.length
          },
          attempts
        };
      } catch (error: any) {
        const failure = {
          ...modelInfo,
          attempt,
          elapsedMs: nowMs() - startedAt,
          error: sanitizeModelError(error)
        };
        attempts.push(failure);
        console.warn("[ScriptBreakdown] text model attempt failed", failure);
      }
    }
  }

  throw new HttpError(
    502,
    "所有已配置的文字生成模型均生成失败，请检查模型中心配置或稍后重试。",
    "SCRIPT_TEXT_MODELS_EXHAUSTED",
    { attempts }
  );
}
