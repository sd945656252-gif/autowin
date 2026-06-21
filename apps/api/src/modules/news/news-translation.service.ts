import { ModelCapability } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { decryptSecret } from "../../security/crypto";
import { callTextProvider, nowMs } from "../custom-ai/provider-client";

export type NewsTranslationStats = {
  candidateModelCount: number;
  attemptedModelCount: number;
  successCount: number;
  failureCount: number;
  lastError: string | null;
};

export type NewsTranslationResult = {
  titleZh: string;
  summaryZh: string;
  modelConfigId: string;
  modelAlias: string;
  provider: string;
  elapsedMs: number;
};

export type NewsTranslationInput = {
  title: string;
  body: string;
  sourceName: string;
  sourceUrl: string;
  category: string;
};

const EMPTY_STATS: NewsTranslationStats = {
  candidateModelCount: 0,
  attemptedModelCount: 0,
  successCount: 0,
  failureCount: 0,
  lastError: null
};

const BAD_SUMMARY_PATTERNS = [
  /官方页面近期 AI 更新/i,
  /该来源可能包含模型、API 或工作流能力变化/i,
  /点击原文核验完整发布内容/i,
  /无法访问原文/i,
  /无法确认/i,
  /please click/i,
  /may include/i
];

function hasChineseText(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

function isMultimodalConfig(config: any) {
  const metadata = config?.metadata;
  return Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && (
    (metadata as any).supportsMultimodal === true ||
    (metadata as any).multimodal === true ||
    (metadata as any).capabilities?.includes?.("multimodal")
  ));
}

function sanitizeForPrompt(value: string, maxChars: number) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxChars);
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Provider did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function validateTranslation(data: any) {
  const titleZh = String(data?.titleZh || "").trim();
  const summaryZh = String(data?.summaryZh || "").trim();
  if (!titleZh || !summaryZh) throw new Error("Translation JSON missing titleZh or summaryZh.");
  if (!hasChineseText(`${titleZh} ${summaryZh}`)) throw new Error("Translation output is not Chinese.");
  if (summaryZh.length < 36) throw new Error("Translation summary is too short.");
  if (BAD_SUMMARY_PATTERNS.some((pattern) => pattern.test(summaryZh))) throw new Error("Translation output contains placeholder text.");
  return {
    titleZh: titleZh.slice(0, 220),
    summaryZh: summaryZh.slice(0, 360)
  };
}

async function loadTranslationModelConfigs() {
  const configs = await prisma.customApiConfig.findMany({
    where: {
      ownerId: null,
      isEnabled: true,
      capability: ModelCapability.TEXT_GENERATOR,
      encryptedKey: { not: null }
    },
    orderBy: [{ updatedAt: "desc" }, { alias: "asc" }]
  });
  const multimodal = configs.filter(isMultimodalConfig);
  return multimodal.length > 0 ? multimodal : configs;
}

function activeRevisionFor(profile: any) {
  const activeId = profile?.activeRevisionId;
  const revisions = Array.isArray(profile?.revisions) ? profile.revisions : [];
  return revisions.find((revision: any) => revision.id === activeId) || revisions[0] || null;
}

async function loadTextCapabilitiesForConfig(config: any) {
  if (!config.canonicalModelId) return undefined;
  const profile = await prisma.modelCapabilityProfile.findFirst({
    where: { canonicalModelId: config.canonicalModelId, capability: ModelCapability.TEXT_GENERATOR },
    include: { revisions: { orderBy: { revision: "desc" }, take: 20 } }
  });
  const activeRevision = activeRevisionFor(profile);
  if (config.activeCapabilityRevisionId && activeRevision?.id && config.activeCapabilityRevisionId !== activeRevision.id) return undefined;
  return activeRevision?.params?.textCapabilities;
}

export function createTranslationStats(): NewsTranslationStats {
  return { ...EMPTY_STATS };
}

export function mergeTranslationStats(target: NewsTranslationStats, source: NewsTranslationStats) {
  target.candidateModelCount = Math.max(target.candidateModelCount, source.candidateModelCount);
  target.attemptedModelCount += source.attemptedModelCount;
  target.successCount += source.successCount;
  target.failureCount += source.failureCount;
  if (source.lastError) target.lastError = source.lastError;
}

export async function translateNewsEvidence(input: NewsTranslationInput): Promise<{ result: NewsTranslationResult | null; stats: NewsTranslationStats }> {
  const stats = createTranslationStats();
  const configs = await loadTranslationModelConfigs();
  stats.candidateModelCount = configs.length;
  if (configs.length === 0) {
    stats.lastError = "没有可用的 TEXT_GENERATOR 翻译模型。";
    return { result: null, stats };
  }

  const systemPrompt = [
    "你是 JIYING 的 AI 行业新闻中文编辑。",
    "任务：基于给定的原文正文证据，输出中文新闻标题和中文摘要。",
    "要求：只使用正文证据，不编造事实，不输出占位话术，不要解释过程。",
    "输出必须是严格 JSON，格式为 {\"titleZh\":\"...\",\"summaryZh\":\"...\"}。",
    "summaryZh 用 1-2 句话，说明原文到底发布了什么，简短、真实、直击要害。"
  ].join("\n");

  const bodyExcerpt = sanitizeForPrompt(input.body, 7_500);
  const userPrompt = [
    `来源：${sanitizeForPrompt(input.sourceName, 120)}`,
    `原链接：${input.sourceUrl}`,
    `分类：${sanitizeForPrompt(input.category, 80)}`,
    `原始标题：${sanitizeForPrompt(input.title, 260)}`,
    "正文证据：",
    bodyExcerpt
  ].join("\n");

  for (const config of configs) {
    const startedAt = nowMs();
    stats.attemptedModelCount += 1;
    try {
      if (!config.encryptedKey) throw new Error("API key is not configured.");
      const apiKey = decryptSecret(config.encryptedKey);
      const textCapabilities = await loadTextCapabilitiesForConfig(config);
      const providerResponse = await callTextProvider({
        baseUrl: config.baseUrl,
        apiKey,
        modelName: config.modelName,
        systemPrompt,
        userPrompt,
        timeoutMs: 20_000,
        maxOutputTokens: 900,
        temperature: 0.1,
        capabilities: textCapabilities
      });
      const parsed = validateTranslation(parseJsonObject(providerResponse.text));
      stats.successCount += 1;
      return {
        result: {
          ...parsed,
          modelConfigId: config.id,
          modelAlias: config.alias,
          provider: config.provider || "Custom",
          elapsedMs: nowMs() - startedAt
        },
        stats
      };
    } catch (error: any) {
      stats.failureCount += 1;
      stats.lastError = error?.message || "新闻翻译模型调用失败。";
      console.warn("[NewsTranslation] model failed", {
        configId: config.id,
        alias: config.alias,
        provider: config.provider,
        elapsedMs: nowMs() - startedAt,
        error: stats.lastError
      });
    }
  }

  return { result: null, stats };
}
