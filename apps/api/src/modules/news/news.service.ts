import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getPrivateStorageDir } from "../../shared/storage-paths";
import { assertSafeOutboundUrl } from "../../security/outbound-url";
import { readBroadcastItemsFlat, readBroadcastNews, refreshBroadcastNews } from "./news-broadcast.service";
import { MODEL_ARENA_SOURCES } from "./news-sources";

export type BroadcastNewsItem = {
  id?: string;
  publishedAt: string;
  category: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  credibilityStatus?: string;
};

export type ArenaModelType = "MULTIMODAL" | "IMAGE" | "VIDEO" | "AUDIO" | "OPEN_SOURCE" | "TEXT" | "UNKNOWN";
export type ArenaMetricKey =
  | "overallScore"
  | "qualityScore"
  | "reasoningScore"
  | "codingScore"
  | "multimodalScore"
  | "speedScore"
  | "costScore"
  | "imageQualityScore"
  | "promptAdherenceScore"
  | "characterConsistencyScore"
  | "imageEditingScore"
  | "videoQualityScore"
  | "motionStabilityScore"
  | "videoCharacterConsistencyScore"
  | "maxDurationScore";

export type ModelTrendSnapshot = {
  checkedAt: string;
  overallScore?: number | null;
  rank?: number | null;
  priceNote?: string | null;
  speedScore?: number | null;
  videoQualityScore?: number | null;
  motionStabilityScore?: number | null;
  costScore?: number | null;
  sourceUrl: string;
};

export type ModelArenaItem = {
  modelName: string;
  provider: string;
  category: string;
  modelType: ArenaModelType;
  officialUrl?: string | null;
  source: string;
  sourceUrl: string;
  priceNote?: string | null;
  overallScore?: number | null;
  qualityScore?: number | null;
  reasoningScore?: number | null;
  codingScore?: number | null;
  multimodalScore?: number | null;
  speedScore?: number | null;
  costScore?: number | null;
  rank?: number | null;
  imageQualityScore?: number | null;
  promptAdherenceScore?: number | null;
  characterConsistencyScore?: number | null;
  imageEditingScore?: number | null;
  videoQualityScore?: number | null;
  motionStabilityScore?: number | null;
  videoCharacterConsistencyScore?: number | null;
  maxDurationScore?: number | null;
  audioQualityScore?: number | null;
  naturalnessScore?: number | null;
  controllabilityScore?: number | null;
  multilingualScore?: number | null;
  openSourceControlScore?: number | null;
  localDeployScore?: number | null;
  hardwareEfficiencyScore?: number | null;
  communityActivityScore?: number | null;
  trendSnapshots: ModelTrendSnapshot[];
  lastCheckedAt: string;
  lastChangedAt?: string | null;
  impact: string;
};

export type ArenaSourceStatus = {
  source: string;
  sourceUrl: string;
  ok: boolean;
  statusCode?: number;
  itemCount?: number;
  parsedMetricCount?: number;
  message?: string;
  fetchedAt: string;
};

export type ArenaSchedulerReason = "cron" | "startup-catchup" | "manual";
export type ArenaSchedulerStatusValue = "idle" | "running" | "ok" | "empty" | "failed" | "skipped";

export type ArenaSchedulerStatus = {
  running: boolean;
  runId: string | null;
  reason: ArenaSchedulerReason | null;
  startedAt: string | null;
  expiresAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessDateGroup?: string | null;
  lastStatus: ArenaSchedulerStatusValue;
  lastMessage?: string;
  nextScheduledRunAt?: string | null;
};

export type ArenaCategoryKey = "MULTIMODAL" | "IMAGE" | "VIDEO" | "AUDIO";
export type ArenaBarMetricKey = "quality" | "price" | "speed" | "costPerformance";

export type ArenaBarDatum = {
  modelName: string;
  provider: string;
  modelType: ArenaCategoryKey;
  source: string;
  sourceUrl: string;
  officialUrl?: string | null;
  value: number;
  metric: ArenaBarMetricKey;
  displayValue: string;
  priceNote?: string | null;
  rank?: number | null;
  lastCheckedAt: string;
};

export type ArenaCategoryChart = {
  category: ArenaCategoryKey;
  label: string;
  defaultMetric: ArenaBarMetricKey;
  availableMetrics: ArenaBarMetricKey[];
  bars: Record<ArenaBarMetricKey, ArenaBarDatum[]>;
};

export type ArenaResponse = {
  updatedAt: string | null;
  lastChangedAt?: string | null;
  scheduler?: ArenaSchedulerStatus;
  sources: string[];
  sourceStatuses: ArenaSourceStatus[];
  items: ModelArenaItem[];
  categoryCharts?: ArenaCategoryChart[];
  topModelsByCategory?: Array<{
    category: ArenaCategoryKey;
    label: string;
    item: ModelArenaItem | null;
  }>;
  radar: {
    model: ModelArenaItem | null;
    peerAverage: Partial<Record<ArenaMetricKey, number | null>>;
    metrics: ArenaMetricKey[];
  };
  imageRanking: ModelArenaItem[];
  videoTrendModels: ModelArenaItem[];
  representatives: Array<{ type: ArenaModelType; item: ModelArenaItem | null }>;
  maxTrendDays: number;
  status: "ok" | "empty" | "failed";
  message?: string;
};

type ArenaCacheFile = {
  updatedAt: string | null;
  lastChangedAt?: string | null;
  items: ModelArenaItem[];
  sourceStatuses: ArenaSourceStatus[];
  trendHistory: Record<string, ModelTrendSnapshot[]>;
  scheduler?: ArenaSchedulerStatus;
  status: ArenaResponse["status"];
  message?: string;
};

type ArenaSource = (typeof ARENA_SOURCES)[number];

type ArenaSourceResult = {
  status: ArenaSourceStatus;
  items: ModelArenaItem[];
};

type OpenRouterModel = {
  id?: string;
  name?: string;
  description?: string | null;
  context_length?: number | null;
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] } | null;
  pricing?: { prompt?: string; completion?: string; image?: string; request?: string } | null;
};

type HuggingFaceModel = {
  id?: string;
  modelId?: string;
  pipeline_tag?: string | null;
  downloads?: number | null;
  likes?: number | null;
  tags?: string[];
};

const ARENA_CACHE_FILE = "model-arena-v2.json";
const MAX_TREND_DAYS = 30;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const DAILY_REFRESH_HOUR = 8;
const DAILY_REFRESH_MINUTE = 55;
const ARENA_SCHEDULER_LOCK_TTL_MS = 15 * 60 * 1000;
const ARENA_SOURCES = MODEL_ARENA_SOURCES
  .filter((source) => source.enabled)
  .map((source) => ({
    id: source.id,
    source: source.name,
    sourceUrl: source.url,
    category: source.category,
    parser: source.parser,
    maxItemsPerFetch: source.maxItemsPerFetch,
    minFetchIntervalHours: source.minFetchIntervalHours
  }));

const RADAR_METRICS: ArenaMetricKey[] = [
  "overallScore",
  "reasoningScore",
  "codingScore",
  "multimodalScore",
  "speedScore",
  "costScore"
];

const REPRESENTATIVE_TYPES: ArenaModelType[] = ["MULTIMODAL", "IMAGE", "VIDEO", "AUDIO", "OPEN_SOURCE"];

function privateCachePath(fileName: string) {
  return path.join(getPrivateStorageDir(), "cache", fileName);
}

async function readJsonCache<T>(fileName: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(privateCachePath(fileName), "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonCache(fileName: string, value: unknown) {
  const target = privateCachePath(fileName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(value, null, 2), "utf8");
}

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}

function shanghaiDateKey(date = new Date()) {
  const parts = shanghaiParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dateKeyToUtcNoon(dateGroup: string) {
  return new Date(`${dateGroup}T04:00:00.000Z`);
}

function addShanghaiDays(dateGroup: string, days: number) {
  const date = dateKeyToUtcNoon(dateGroup);
  date.setUTCDate(date.getUTCDate() + days);
  return shanghaiDateKey(date);
}

function hasPassedDailyRefresh(date = new Date()) {
  const parts = shanghaiParts(date);
  return parts.hour > DAILY_REFRESH_HOUR || (parts.hour === DAILY_REFRESH_HOUR && parts.minute >= DAILY_REFRESH_MINUTE);
}

function shanghaiScheduledInstant(dateGroup: string) {
  return new Date(`${dateGroup}T${String(DAILY_REFRESH_HOUR).padStart(2, "0")}:${String(DAILY_REFRESH_MINUTE).padStart(2, "0")}:00+08:00`).toISOString();
}

function nextArenaScheduledRunAt(date = new Date()) {
  const today = shanghaiDateKey(date);
  return shanghaiScheduledInstant(hasPassedDailyRefresh(date) ? addShanghaiDays(today, 1) : today);
}

function defaultArenaScheduler(base: Partial<ArenaSchedulerStatus> = {}): ArenaSchedulerStatus {
  return {
    running: false,
    runId: null,
    reason: null,
    startedAt: null,
    expiresAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastSuccessDateGroup: null,
    lastStatus: "idle",
    nextScheduledRunAt: nextArenaScheduledRunAt(),
    ...base
  };
}

function mergeArenaScheduler(scheduler?: ArenaSchedulerStatus | null, patch: Partial<ArenaSchedulerStatus> = {}) {
  return defaultArenaScheduler({ ...(scheduler || {}), ...patch, nextScheduledRunAt: nextArenaScheduledRunAt() });
}

function hasFreshArenaLock(cache: ArenaCacheFile, now = new Date()) {
  if (!cache.scheduler?.running || cache.scheduler.lastStatus !== "running" || !cache.scheduler.expiresAt) return false;
  return new Date(cache.scheduler.expiresAt).getTime() > now.getTime();
}

function wasArenaRefreshedForToday(cache: ArenaCacheFile, today = shanghaiDateKey()) {
  if (cache.scheduler?.lastSuccessDateGroup === today) return true;
  if (cache.scheduler?.lastSuccessDateGroup) return false;
  if (cache.scheduler?.lastSuccessAt && shanghaiDateKey(new Date(cache.scheduler.lastSuccessAt)) === today) return true;
  return Boolean(cache.updatedAt && (cache.status === "ok" || cache.status === "empty") && shanghaiDateKey(new Date(cache.updatedAt)) === today);
}

function modelKey(item: Pick<ModelArenaItem, "provider" | "modelName" | "modelType">) {
  return `${item.modelType}:${item.provider}:${item.modelName}`.toLowerCase();
}

function score(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function titleCaseProvider(value: string) {
  const normalized = value.replace(/^~+/, "");
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ") || "unknown";
}

function providerFromModelId(id: string) {
  const namespace = id.split("/")[0] || "unknown";
  return titleCaseProvider(namespace);
}

function normalizeModelName(id: string, name?: string | null) {
  return (name || id.split("/").pop() || id).replace(/[-_]+/g, " ").trim();
}

function inferModelType(value: string, pipelineTag?: string | null): ArenaModelType {
  const pipeline = (pipelineTag || "").toLowerCase();
  if (/text-to-image|image-to-image|image-generation|unconditional-image-generation/.test(pipeline)) return "IMAGE";
  if (/text-to-video|video-generation|image-to-video/.test(pipeline)) return "VIDEO";
  if (/text-to-speech|automatic-speech-recognition|audio|music|voice/.test(pipeline)) return "AUDIO";
  if (/visual-question-answering|image-text-to-text|any-to-any|multimodal|document-question-answering/.test(pipeline)) return "MULTIMODAL";
  const text = value.toLowerCase();
  if (/\b(flux|stable diffusion|sdxl|imagen|dall[- ]?e|midjourney|ideogram|recraft|playground)\b/.test(text)) return "IMAGE";
  if (/\b(sora|veo|runway|gen-?3|gen-?4|kling|luma|ray\s?2|hailuo|wan\d|text-to-video|image-to-video)\b/.test(text)) return "VIDEO";
  if (/\b(whisper|tts|voice|audio|music|suno|elevenlabs|speech)\b/.test(text)) return "AUDIO";
  if (/\b(gpt-4o|omni|vision|vl|llava|pixtral|gemini|claude|qwen\d?\.?(?:5)?-vl|multimodal)\b/.test(text)) return "MULTIMODAL";
  if (/\b(llama|mistral|mixtral|qwen|deepseek|yi-|glm|nemotron|phi-|gemma|command-r|openchat|nous|hermes|open-source|open source|:free)\b/.test(text)) return "OPEN_SOURCE";
  if (pipeline.includes("text-generation") || pipeline.includes("conversational")) return "OPEN_SOURCE";
  return "TEXT";
}

function arenaRepresentativeScoreBase(item: ModelArenaItem) {
  return score(item.overallScore)
    ?? score(item.communityActivityScore)
    ?? score(item.costScore)
    ?? (item.priceNote && item.priceNote !== "价格/上下文未公开" ? 50 : null)
    ?? 0;
}

function categoryForType(type: ArenaModelType, fallback: string) {
  if (type === "MULTIMODAL") return "多模态模型";
  if (type === "IMAGE") return "生图模型";
  if (type === "VIDEO") return "生视频模型";
  if (type === "AUDIO") return "音频模型";
  if (type === "OPEN_SOURCE") return "开源模型";
  if (type === "TEXT") return "语言模型";
  return fallback;
}

function impactForType(type: ArenaModelType, source: string) {
  if (type === "IMAGE") return `来自 ${source} 的可验证模型清单，可用于评估 JIYING 生图节点的候选模型、价格和供应商覆盖。`;
  if (type === "VIDEO") return `来自 ${source} 的可验证模型清单，可用于跟踪生视频节点的模型可选项与后续接入优先级。`;
  if (type === "AUDIO") return `来自 ${source} 的可验证模型清单，可用于维护音频生成、语音和转写能力的模型池。`;
  if (type === "MULTIMODAL") return `来自 ${source} 的可验证模型清单，可用于评估多模态理解和图文工作流节点的模型覆盖。`;
  if (type === "OPEN_SOURCE") return `来自 ${source} 的开源模型热度数据，可用于判断本地部署、私有化和低成本推理的候选方向。`;
  return `来自 ${source} 的可验证模型清单，可用于维护 JIYING 模型中心的供应商与价格信息。`;
}

function pricePerMillion(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed * 1_000_000;
}

function costScoreFromPrices(inputPerMillion: number | null, outputPerMillion: number | null) {
  const total = (inputPerMillion || 0) + (outputPerMillion || 0);
  if (total <= 0) return 100;
  if (total <= 1) return 95;
  if (total <= 5) return 85;
  if (total <= 15) return 70;
  if (total <= 50) return 55;
  return 35;
}

function formatTokenPriceNote(inputPerMillion: number | null, outputPerMillion: number | null, contextLength?: number | null) {
  const parts: string[] = [];
  if (inputPerMillion !== null) parts.push(`input $${inputPerMillion.toFixed(inputPerMillion >= 1 ? 2 : 4)}/1M tokens`);
  if (outputPerMillion !== null) parts.push(`output $${outputPerMillion.toFixed(outputPerMillion >= 1 ? 2 : 4)}/1M tokens`);
  if (contextLength) parts.push(`context ${contextLength.toLocaleString("en-US")}`);
  return parts.join("; ") || "价格/上下文未公开";
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\\u0026/g, "&")
    .trim();
}

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function scoreFromRank(rank: number, total: number) {
  if (!Number.isFinite(rank) || rank <= 0) return null;
  const safeTotal = Math.max(total || 100, rank, 1);
  return boundedScore(100 - ((rank - 1) / safeTotal) * 45);
}

function providerFromArtificialSummary(modelName: string) {
  const text = modelName.toLowerCase();
  if (/claude|anthropic/.test(text)) return "Anthropic";
  if (/gpt|openai|o\d\b|codex/.test(text)) return "OpenAI";
  if (/gemini|google|veo|imagen/.test(text)) return "Google";
  if (/deepseek/.test(text)) return "DeepSeek";
  if (/qwen/.test(text)) return "Qwen";
  if (/grok|xai/.test(text)) return "xAI";
  if (/llama|meta/.test(text)) return "Meta";
  if (/mistral|mixtral|codestral|magistral/.test(text)) return "Mistral";
  if (/kimi|moonshot/.test(text)) return "Moonshot";
  if (/nova|amazon/.test(text)) return "Amazon";
  if (/command|cohere|north/.test(text)) return "Cohere";
  if (/granite|ibm/.test(text)) return "IBM";
  if (/step/.test(text)) return "StepFun";
  if (/mercury/.test(text)) return "Inception Labs";
  if (/flux|black forest/.test(text)) return "Black Forest Labs";
  if (/stable|stability/.test(text)) return "Stability AI";
  if (/runway|gen-/.test(text)) return "Runway";
  if (/kling/.test(text)) return "Kling";
  if (/luma|ray/.test(text)) return "Luma";
  if (/hailuo|minimax/.test(text)) return "MiniMax";
  return providerFromModelId(modelName);
}

function extractArtificialSummaryModels(text: string) {
  const cleaned = stripHtml(text).replace(/\.$/, "");
  const normalized = cleaned
    .replace(/ are the highest intelligence models, followed by /i, ", ")
    .replace(/ are the fastest models, followed by /i, ", ")
    .replace(/ are the lowest latency models, followed by /i, ", ")
    .replace(/ are the cheapest models, followed by /i, ", ")
    .replace(/ support the largest context windows, followed by /i, ", ")
    .replace(/ is the highest[^,]*, followed by /i, ", ")
    .replace(/ and /g, ", ");
  return Array.from(new Set(normalized.split(",").map((item) => item.trim()).filter((item) => item.length >= 2 && !/^the |^followed$/i.test(item))));
}

function parseArtificialAnalysisHighlights(source: ArenaSource, body: string, now: string, forcedType?: ArenaModelType): ModelArenaItem[] {
  const cards = Array.from(body.matchAll(/<h4[^>]*>([^<]+)<\/h4>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g));
  const items: ModelArenaItem[] = [];
  for (const card of cards) {
    const metricLabel = stripHtml(card[1]);
    const summary = stripHtml(card[2]);
    if (!summary || !/(highest|fastest|lowest|cheapest|largest|followed by)/i.test(summary)) continue;
    const names = extractArtificialSummaryModels(summary).slice(0, 6);
    names.forEach((name, index) => {
      const modelType = forcedType || inferModelType(name);
      const rank = index + 1;
      const item: ModelArenaItem = {
        modelName: name,
        provider: providerFromArtificialSummary(name),
        category: categoryForType(modelType, source.category),
        modelType,
        officialUrl: source.sourceUrl,
        source: source.source,
        sourceUrl: source.sourceUrl,
        rank,
        overallScore: metricLabel === "Intelligence" ? scoreFromRank(rank, Math.max(names.length, 6)) : undefined,
        speedScore: metricLabel === "Output Speed" || metricLabel === "Latency" ? scoreFromRank(rank, Math.max(names.length, 6)) : undefined,
        costScore: metricLabel === "Price" ? scoreFromRank(rank, Math.max(names.length, 6)) : undefined,
        priceNote: `Artificial Analysis highlight: ${metricLabel}`,
        trendSnapshots: [],
        lastCheckedAt: now,
        impact: `Artificial Analysis 摘录：${summary}`
      };
      items.push(item);
    });
  }
  return items.slice(0, Math.min(source.maxItemsPerFetch, 80));
}

function parseArtificialEmbeddedModels(source: ArenaSource, body: string, now: string, forcedType?: ArenaModelType): ModelArenaItem[] {
  const seen = new Set<string>();
  const items: ModelArenaItem[] = [];
  const pattern = /\\"slug\\":\\"([^\\"]+)\\",\\"name\\":\\"([^\\"]+)\\",\\"shortName\\":\\"([^\\"]*)\\",\\"deprecated\\":(true|false),\\"isReasoning\\":(true|false),\\"creator\\":\{[\s\S]{0,220}?\\"name\\":\\"([^\\"]+)\\"/g;
  for (const match of body.matchAll(pattern)) {
    const deprecated = match[4] === "true";
    if (deprecated) continue;
    const slug = decodeHtml(match[1]);
    const modelName = decodeHtml(match[3] || match[2]);
    const provider = decodeHtml(match[6]);
    const key = `${provider}:${modelName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const modelType = forcedType || inferModelType(`${slug} ${modelName}`);
    const rank = items.length + 1;
    items.push({
      modelName,
      provider,
      category: categoryForType(modelType, source.category),
      modelType,
      officialUrl: `${source.sourceUrl.replace(/\/$/, "")}/${slug}`,
      source: source.source,
      sourceUrl: source.sourceUrl,
      rank,
      overallScore: scoreFromRank(rank, Math.max(source.maxItemsPerFetch, 80)),
      priceNote: "Artificial Analysis public model comparison entry",
      trendSnapshots: [],
      lastCheckedAt: now,
      impact: `Artificial Analysis 公开模型对比中收录的前沿模型：${provider} ${modelName}。`
    });
    if (items.length >= source.maxItemsPerFetch) break;
  }
  return items;
}

function parseArtificialAnalysisPage(source: ArenaSource, body: string, now: string): ModelArenaItem[] {
  const forcedType = source.id === "artificial-analysis-image" ? "IMAGE" : source.id === "artificial-analysis-video" ? "VIDEO" : undefined;
  const highlights = parseArtificialAnalysisHighlights(source, body, now, forcedType);
  if (source.id !== "artificial-analysis-models") {
    return highlights.slice(0, source.maxItemsPerFetch);
  }
  const embedded = parseArtificialEmbeddedModels(source, body, now, forcedType);
  return mergeArenaItems([...highlights, ...embedded]).slice(0, source.maxItemsPerFetch);
}

function parseLmArena(source: ArenaSource, body: string, now: string): ModelArenaItem[] {
  const rows = Array.from(body.matchAll(/<tr[\s\S]*?<\/tr>/g));
  const items: ModelArenaItem[] = [];
  for (const rowMatch of rows) {
    const row = rowMatch[0];
    const titleMatch = row.match(/title="([^"]+)"/);
    if (!titleMatch) continue;
    const ranks = Array.from(row.matchAll(/<span[^>]*font-mono[^>]*>(\d+(?:\.\d+)?)<\/span>/g)).map((match) => Number(match[1]));
    if (ranks.length < 1 || !Number.isFinite(ranks[0])) continue;
    const modelName = decodeHtml(titleMatch[1]);
    const overallRank = ranks[0];
    const modelType = inferModelType(modelName);
    items.push({
      modelName,
      provider: providerFromArtificialSummary(modelName),
      category: categoryForType(modelType, source.category),
      modelType,
      officialUrl: source.sourceUrl,
      source: source.source,
      sourceUrl: source.sourceUrl,
      rank: overallRank,
      overallScore: scoreFromRank(overallRank, 659),
      codingScore: ranks[3] ? scoreFromRank(ranks[3], 659) : undefined,
      reasoningScore: ranks[1] ? scoreFromRank(ranks[1], 659) : undefined,
      qualityScore: ranks[2] ? scoreFromRank(ranks[2], 659) : undefined,
      priceNote: `LMArena public rank #${overallRank}`,
      trendSnapshots: [],
      lastCheckedAt: now,
      impact: `LMArena 公开榜单收录，Overall 排名 #${overallRank}；其他维度按页面公开排名换算展示。`
    });
    if (items.length >= source.maxItemsPerFetch) break;
  }
  return items;
}

async function fetchArenaText(source: ArenaSource) {
  await assertSafeOutboundUrl(source.sourceUrl, "model arena source URL");
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(source.sourceUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; JiyingModelArena/1.0; +https://localhost)",
          Accept: "application/json,text/html;q=0.8,*/*;q=0.7"
        },
        signal: AbortSignal.timeout(25_000)
      });
      const body = await response.text();
      return { response, body };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastError;
}

function countParsedMetrics(items: ModelArenaItem[]) {
  return items.reduce((sum, item) => {
    return sum + [
      item.overallScore,
      item.qualityScore,
      item.reasoningScore,
      item.codingScore,
      item.multimodalScore,
      item.speedScore,
      item.costScore,
      item.imageQualityScore,
      item.videoQualityScore,
      item.motionStabilityScore
    ].filter((value) => typeof value === "number").length;
  }, 0);
}

function sourceStatus(source: ArenaSource, ok: boolean, fetchedAt: string, statusCode?: number, message?: string, itemCount = 0, parsedMetricCount = 0): ArenaSourceStatus {
  return { source: source.source, sourceUrl: source.sourceUrl, ok, statusCode, fetchedAt, message, itemCount, parsedMetricCount };
}

function parseOpenRouterModels(source: ArenaSource, body: string, now: string): ModelArenaItem[] {
  const parsed = JSON.parse(body) as { data?: OpenRouterModel[] };
  const models = Array.isArray(parsed.data) ? parsed.data : [];
  return models.slice(0, source.maxItemsPerFetch).flatMap((model) => {
    const id = model.id || model.name;
    if (!id) return [];
    const modelName = normalizeModelName(id, model.name);
    const provider = providerFromModelId(id);
    const modalities = [model.architecture?.modality, ...(model.architecture?.input_modalities || []), ...(model.architecture?.output_modalities || [])].filter(Boolean).join(" ");
    const modelType = inferModelType(`${id} ${modelName} ${modalities}`);
    const inputPrice = pricePerMillion(model.pricing?.prompt);
    const outputPrice = pricePerMillion(model.pricing?.completion);
    const item: ModelArenaItem = {
      modelName,
      provider,
      category: categoryForType(modelType, source.category),
      modelType,
      officialUrl: `https://openrouter.ai/${id}`,
      source: source.source,
      sourceUrl: source.sourceUrl,
      priceNote: formatTokenPriceNote(inputPrice, outputPrice, model.context_length || null),
      costScore: costScoreFromPrices(inputPrice, outputPrice),
      trendSnapshots: [],
      lastCheckedAt: now,
      impact: impactForType(modelType, source.source)
    };
    return [item];
  });
}

function parseHuggingFaceModels(source: ArenaSource, body: string, now: string): ModelArenaItem[] {
  const parsed = JSON.parse(body) as HuggingFaceModel[];
  const models = Array.isArray(parsed) ? parsed : [];
  return models.slice(0, source.maxItemsPerFetch).flatMap((model, index) => {
    const id = model.modelId || model.id;
    if (!id) return [];
    const modelType = inferModelType(`${id} ${(model.tags || []).join(" ")}`, model.pipeline_tag);
    const downloads = typeof model.downloads === "number" ? model.downloads : null;
    const likes = typeof model.likes === "number" ? model.likes : null;
    const item: ModelArenaItem = {
      modelName: normalizeModelName(id),
      provider: providerFromModelId(id),
      category: categoryForType(modelType, source.category),
      modelType,
      officialUrl: `https://huggingface.co/${id}`,
      source: source.source,
      sourceUrl: source.sourceUrl,
      priceNote: [downloads !== null ? `${downloads.toLocaleString("en-US")} downloads` : null, likes !== null ? `${likes.toLocaleString("en-US")} likes` : null, model.pipeline_tag || null].filter(Boolean).join("; ") || "社区热度未公开",
      rank: index + 1,
      communityActivityScore: boundedScore(Math.log10((downloads || 0) + 1) * 12 + Math.log10((likes || 0) + 1) * 8),
      trendSnapshots: [],
      lastCheckedAt: now,
      impact: impactForType(modelType, source.source)
    };
    return [item];
  });
}

function parseLiteLlmPrices(source: ArenaSource, body: string, now: string): ModelArenaItem[] {
  const parsed = JSON.parse(body) as Record<string, any>;
  return Object.entries(parsed).slice(0, source.maxItemsPerFetch).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== "object" || id.startsWith("sample_spec")) return [];
    const inputPrice = pricePerMillion(raw.input_cost_per_token ?? raw.prompt_cost_per_token);
    const outputPrice = pricePerMillion(raw.output_cost_per_token ?? raw.completion_cost_per_token);
    const contextLength = Number(raw.max_input_tokens || raw.max_tokens || raw.max_context_tokens || 0) || null;
    if (inputPrice === null && outputPrice === null && contextLength === null) return [];
    const provider = titleCaseProvider(String(raw.litellm_provider || raw.provider || id.split("/")[0] || "unknown"));
    const modelType = inferModelType(`${id} ${raw.mode || ""}`);
    const item: ModelArenaItem = {
      modelName: normalizeModelName(id, raw.display_name || raw.model_name),
      provider,
      category: categoryForType(modelType, source.category),
      modelType,
      officialUrl: null,
      source: source.source,
      sourceUrl: source.sourceUrl,
      priceNote: formatTokenPriceNote(inputPrice, outputPrice, contextLength),
      costScore: costScoreFromPrices(inputPrice, outputPrice),
      trendSnapshots: [],
      lastCheckedAt: now,
      impact: impactForType(modelType, source.source)
    };
    return [item];
  });
}

function mergeArenaItems(items: ModelArenaItem[]) {
  const merged = new Map<string, ModelArenaItem>();
  for (const item of items) {
    const key = `${item.provider}:${item.modelName}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, {
      ...previous,
      modelType: previous.modelType !== "TEXT" && previous.modelType !== "UNKNOWN" ? previous.modelType : item.modelType,
      category: previous.category || item.category,
      officialUrl: previous.officialUrl || item.officialUrl,
      rank: previous.rank ?? item.rank ?? null,
      overallScore: previous.overallScore ?? item.overallScore ?? null,
      qualityScore: previous.qualityScore ?? item.qualityScore ?? null,
      reasoningScore: previous.reasoningScore ?? item.reasoningScore ?? null,
      codingScore: previous.codingScore ?? item.codingScore ?? null,
      multimodalScore: previous.multimodalScore ?? item.multimodalScore ?? null,
      speedScore: previous.speedScore ?? item.speedScore ?? null,
      imageQualityScore: previous.imageQualityScore ?? item.imageQualityScore ?? null,
      promptAdherenceScore: previous.promptAdherenceScore ?? item.promptAdherenceScore ?? null,
      characterConsistencyScore: previous.characterConsistencyScore ?? item.characterConsistencyScore ?? null,
      imageEditingScore: previous.imageEditingScore ?? item.imageEditingScore ?? null,
      videoQualityScore: previous.videoQualityScore ?? item.videoQualityScore ?? null,
      motionStabilityScore: previous.motionStabilityScore ?? item.motionStabilityScore ?? null,
      videoCharacterConsistencyScore: previous.videoCharacterConsistencyScore ?? item.videoCharacterConsistencyScore ?? null,
      maxDurationScore: previous.maxDurationScore ?? item.maxDurationScore ?? null,
      priceNote: previous.priceNote && previous.priceNote !== "价格/上下文未公开" ? previous.priceNote : item.priceNote,
      costScore: previous.costScore ?? item.costScore ?? null,
      communityActivityScore: previous.communityActivityScore ?? item.communityActivityScore ?? null,
      source: previous.source === item.source ? previous.source : `${previous.source}, ${item.source}`,
      sourceUrl: previous.sourceUrl,
      impact: previous.impact || item.impact
    });
  }
  const typeOrder: Record<ArenaModelType, number> = { MULTIMODAL: 0, IMAGE: 1, VIDEO: 2, AUDIO: 3, OPEN_SOURCE: 4, TEXT: 5, UNKNOWN: 6 };
  return Array.from(merged.values()).sort((a, b) => typeOrder[a.modelType] - typeOrder[b.modelType] || a.provider.localeCompare(b.provider) || a.modelName.localeCompare(b.modelName));
}

function average(items: ModelArenaItem[], metric: ArenaMetricKey) {
  const values = items.map((item) => score(item[metric] as number | null | undefined)).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function arenaCategoryForType(type: ArenaModelType): ArenaCategoryKey | null {
  if (type === "MULTIMODAL") return "MULTIMODAL";
  if (type === "IMAGE") return "IMAGE";
  if (type === "VIDEO") return "VIDEO";
  if (type === "AUDIO") return "AUDIO";
  return null;
}

function arenaCategoryLabel(category: ArenaCategoryKey) {
  if (category === "MULTIMODAL") return "多模态模型";
  if (category === "IMAGE") return "生图模型";
  if (category === "VIDEO") return "生视频模型";
  return "音频模型";
}

function parseComparablePriceValue(note?: string | null) {
  if (!note) return null;
  const normalized = note.replace(/,/g, " ").toLowerCase();
  const hasCurrency = /(?:\$|usd|us\$)/i.test(normalized);
  const hasComparableUnit = /(?:1\s*(?:m|k)|per|\/)\s*(?:tokens?|token|images?|image|generations?|generation|requests?|request|seconds?|second|secs?|minutes?|minute|chars?|characters?|videos?|video|audios?|audio)/i.test(normalized)
    || /\b(?:tokens?|token|images?|image|generations?|generation|requests?|request|seconds?|second|secs?|minutes?|minute|chars?|characters?|videos?|video|audios?|audio)\b/i.test(normalized);
  if (!hasCurrency || !hasComparableUnit) return null;
  const matches =
    normalized.match(/(?:\$|usd|us\$)\s*(\d+(?:\.\d+)?)/i) ||
    normalized.match(/(\d+(?:\.\d+)?)\s*(?:\$|usd|us\$)/i) ||
    normalized.match(/(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(?:1\s*(?:m|k)|)\s*(?:tokens?|token|images?|image|generations?|generation|requests?|request|seconds?|second|secs?|minutes?|minute|chars?|characters?|videos?|video|audios?|audio)/i);
  if (!matches) return null;
  const value = Number(matches[1]);
  return Number.isFinite(value) ? value : null;
}

function formatComparablePriceValue(value: number) {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function representativeScore(item: ModelArenaItem) {
  if (item.modelType === "IMAGE") return item.imageQualityScore ?? item.overallScore ?? item.qualityScore ?? item.communityActivityScore ?? 0;
  if (item.modelType === "VIDEO") return item.videoQualityScore ?? item.overallScore ?? item.qualityScore ?? item.communityActivityScore ?? 0;
  if (item.modelType === "AUDIO") return item.audioQualityScore ?? item.overallScore ?? item.communityActivityScore ?? 0;
  return item.overallScore ?? item.qualityScore ?? item.multimodalScore ?? item.codingScore ?? item.communityActivityScore ?? 0;
}

function buildArenaCategoryCharts(items: ModelArenaItem[]): ArenaCategoryChart[] {
  const categories: ArenaCategoryKey[] = ["MULTIMODAL", "IMAGE", "VIDEO", "AUDIO"];
  return categories.map((category) => {
    const categoryItems = items.filter((item) => arenaCategoryForType(item.modelType) === category);
    const byQuality = [...categoryItems]
      .filter((item) => representativeScore(item) > 0)
      .sort((a, b) => representativeScore(b) - representativeScore(a))
      .slice(0, 15)
      .map((item) => ({
        modelName: item.modelName,
        provider: item.provider,
        modelType: category,
        source: item.source,
        sourceUrl: item.sourceUrl,
        officialUrl: item.officialUrl || null,
        value: representativeScore(item),
        metric: "quality" as const,
        displayValue: displayBarValue(representativeScore(item)),
        priceNote: item.priceNote || null,
        rank: item.rank ?? null,
        lastCheckedAt: item.lastCheckedAt
      }));
    const byPrice = [...categoryItems]
      .map((item) => ({ item, priceValue: parseComparablePriceValue(item.priceNote) }))
      .filter((entry): entry is { item: ModelArenaItem; priceValue: number } => entry.priceValue !== null)
      .sort((a, b) => a.priceValue - b.priceValue)
      .slice(0, 15)
      .map(({ item, priceValue }) => ({
        modelName: item.modelName,
        provider: item.provider,
        modelType: category,
        source: item.source,
        sourceUrl: item.sourceUrl,
        officialUrl: item.officialUrl || null,
        value: priceValue,
        metric: "price" as const,
        displayValue: formatComparablePriceValue(priceValue),
        priceNote: item.priceNote || null,
        rank: item.rank ?? null,
        lastCheckedAt: item.lastCheckedAt
      }));
    const bySpeed = [...categoryItems]
      .map((item) => ({ item, value: item.speedScore ?? null }))
      .filter(({ value }) => value !== null)
      .sort((a, b) => (b.value || 0) - (a.value || 0))
      .slice(0, 15)
      .map(({ item, value }) => ({
        modelName: item.modelName,
        provider: item.provider,
        modelType: category,
        source: item.source,
        sourceUrl: item.sourceUrl,
        officialUrl: item.officialUrl || null,
        value: value || 0,
        metric: "speed" as const,
        displayValue: displayBarValue(value || 0),
        priceNote: item.priceNote || null,
        rank: item.rank ?? null,
        lastCheckedAt: item.lastCheckedAt
      }));
    const byCost = [...categoryItems]
      .map((item) => ({
        item,
        value: item.costScore
      }))
      .filter((entry): entry is { item: ModelArenaItem; value: number } => typeof entry.value === "number")
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(({ item, value }) => ({
        modelName: item.modelName,
        provider: item.provider,
        modelType: category,
        source: item.source,
        sourceUrl: item.sourceUrl,
        officialUrl: item.officialUrl || null,
        value: value || 0,
        metric: "costPerformance" as const,
        displayValue: displayBarValue(value || 0),
        priceNote: item.priceNote || null,
        rank: item.rank ?? null,
        lastCheckedAt: item.lastCheckedAt
      }));
    const bars = {
      quality: byQuality,
      price: byPrice,
      speed: bySpeed,
      costPerformance: byCost
    };
    const availableMetrics = (["quality", "speed", "costPerformance", "price"] as ArenaBarMetricKey[]).filter((metric) => bars[metric].length > 0);
    return {
      category,
      label: arenaCategoryLabel(category),
      defaultMetric: availableMetrics[0] || "quality",
      availableMetrics,
      bars
    };
  });
}

function displayBarValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function sortByOverall(items: ModelArenaItem[]) {
  return [...items].sort((a, b) => arenaRepresentativeScoreBase(b) - arenaRepresentativeScoreBase(a));
}

function sourceStatusesWithFallback(cache: ArenaCacheFile) {
  const byUrl = new Map((cache.sourceStatuses || []).map((source) => [source.sourceUrl, source]));
  return ARENA_SOURCES.map((source) => byUrl.get(source.sourceUrl) || {
    source: source.source,
    sourceUrl: source.sourceUrl,
    ok: false,
    fetchedAt: cache.updatedAt || new Date(0).toISOString(),
    itemCount: 0,
    parsedMetricCount: 0,
    message: "该来源尚未完成本轮刷新。"
  });
}

function mergeTrendHistory(cache: ArenaCacheFile, items: ModelArenaItem[], now: string) {
  const cutoff = Date.now() - MAX_TREND_DAYS * 24 * 60 * 60 * 1000;
  const nextHistory: Record<string, ModelTrendSnapshot[]> = {};
  for (const item of items) {
    const key = modelKey(item);
    const previous = Array.isArray(cache.trendHistory?.[key]) ? cache.trendHistory[key] : [];
    const snapshot: ModelTrendSnapshot = {
      checkedAt: now,
      overallScore: item.overallScore ?? null,
      rank: item.rank ?? null,
      priceNote: item.priceNote ?? null,
      speedScore: item.speedScore ?? null,
      videoQualityScore: item.videoQualityScore ?? null,
      motionStabilityScore: item.motionStabilityScore ?? null,
      costScore: item.costScore ?? null,
      sourceUrl: item.sourceUrl
    };
    const byDay = new Map<string, ModelTrendSnapshot>();
    for (const entry of [...previous, snapshot]) {
      const time = new Date(entry.checkedAt).getTime();
      if (Number.isNaN(time) || time < cutoff) continue;
      byDay.set(entry.checkedAt.slice(0, 10), entry);
    }
    nextHistory[key] = Array.from(byDay.values()).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt)).slice(-MAX_TREND_DAYS);
  }
  return nextHistory;
}

function attachTrends(items: ModelArenaItem[], trendHistory: Record<string, ModelTrendSnapshot[]>) {
  return items.map((item) => ({ ...item, trendSnapshots: trendHistory[modelKey(item)] || [] }));
}

function buildArenaResponse(cache: ArenaCacheFile): ArenaResponse {
  const items = attachTrends(cache.items || [], cache.trendHistory || {});
  const multimodal = sortByOverall(items.filter((item) => item.modelType === "MULTIMODAL"));
  const radarModel = multimodal[0] || null;
  const peerAverage = Object.fromEntries(RADAR_METRICS.map((metric) => [metric, average(multimodal, metric)]));
  const imageRanking = sortByOverall(items.filter((item) => item.modelType === "IMAGE")).slice(0, 10);
  const videoTrendModels = sortByOverall(items.filter((item) => item.modelType === "VIDEO")).slice(0, 5);
  const representatives = REPRESENTATIVE_TYPES.map((type) => ({
    type,
    item: sortByOverall(items.filter((item) => item.modelType === type))[0] || null
  }));
  const categoryCharts = buildArenaCategoryCharts(items);
  const topModelsByCategory = categoryCharts.map((chart) => ({
    category: chart.category,
    label: chart.label,
    item: sortByOverall(items.filter((item) => arenaCategoryForType(item.modelType) === chart.category))[0] || null
  }));
  const status: ArenaResponse["status"] = cache.status || (items.length > 0 ? "ok" : "empty");
  return {
    updatedAt: cache.updatedAt || null,
    lastChangedAt: cache.lastChangedAt || null,
    scheduler: mergeArenaScheduler(cache.scheduler),
    sources: ARENA_SOURCES.map((source) => source.sourceUrl),
    sourceStatuses: sourceStatusesWithFallback(cache),
    items,
    categoryCharts,
    topModelsByCategory,
    radar: { model: radarModel, peerAverage, metrics: RADAR_METRICS },
    imageRanking,
    videoTrendModels,
    representatives,
    maxTrendDays: MAX_TREND_DAYS,
    status,
    message: cache.message || (items.length > 0 ? undefined : "暂无可靠模型竞技场数据。来源不可用或未提供可验证结构化评分时，系统不会生成假分数。")
  };
}

function defaultArenaCache(): ArenaCacheFile {
  return {
    updatedAt: null,
    lastChangedAt: null,
    items: [],
    sourceStatuses: [],
    trendHistory: {},
    scheduler: defaultArenaScheduler(),
    status: "empty",
    message: "暂无可靠模型竞技场数据。来源不可用或未提供可验证结构化评分时，系统不会生成假分数。"
  };
}

async function fetchArenaSource(source: ArenaSource, now: string): Promise<ArenaSourceResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const { response, body } = await fetchArenaText(source);
    if (!response.ok) {
      return { status: sourceStatus(source, false, fetchedAt, response.status, `Source returned HTTP ${response.status}.`), items: [] };
    }

    let items: ModelArenaItem[] = [];
    if (source.id === "openrouter-models") {
      items = parseOpenRouterModels(source, body, now);
    } else if (source.id === "huggingface-models") {
      items = parseHuggingFaceModels(source, body, now);
    } else if (source.id === "litellm-prices") {
      items = parseLiteLlmPrices(source, body, now);
    } else if (source.id === "lmarena") {
      items = parseLmArena(source, body, now);
    } else if (source.id.startsWith("artificial-analysis-")) {
      items = parseArtificialAnalysisPage(source, body, now);
    }

    if (items.length > 0) {
      return {
        status: sourceStatus(source, true, fetchedAt, response.status, `Parsed ${items.length} verified model records from public structured data.`, items.length, countParsedMetrics(items)),
        items
      };
    }

    const hasStructuredData = body.includes("__NEXT_DATA__") || body.includes("application/ld+json") || body.trim().startsWith("{") || body.trim().startsWith("[");
    return {
      status: sourceStatus(
        source,
        false,
        fetchedAt,
        response.status,
        hasStructuredData
          ? "Source is reachable, but this source does not expose a supported public parser yet."
          : "Source is reachable but did not expose supported public structured model data.",
        0,
        0
      ),
      items: []
    };
  } catch (error: any) {
    return { status: sourceStatus(source, false, fetchedAt, undefined, error?.message || "Source fetch failed."), items: [] };
  }
}

async function collectArenaModels() {
  const now = new Date().toISOString();
  const results = await Promise.all(ARENA_SOURCES.map((source) => fetchArenaSource(source, now)));
  return {
    sourceStatuses: results.map((result) => result.status),
    items: mergeArenaItems(results.flatMap((result) => result.items))
  };
}

export async function readNewsFromDatabase(): Promise<BroadcastNewsItem[]> {
  return readBroadcastItemsFlat() as any;
}

export async function fetchAndStoreNews() {
  return refreshBroadcastNews();
}

export async function readBroadcast() {
  return readBroadcastNews();
}

export async function readArenaSnapshot() {
  const cache = await readJsonCache<ArenaCacheFile>(ARENA_CACHE_FILE, defaultArenaCache());
  return buildArenaResponse(cache);
}

export async function refreshArenaSnapshot() {
  const previous = await readJsonCache<ArenaCacheFile>(ARENA_CACHE_FILE, defaultArenaCache());
  const now = new Date().toISOString();
  const collected = await collectArenaModels();

  if (collected.items.length === 0) {
    const next: ArenaCacheFile = {
      ...previous,
      updatedAt: now,
      sourceStatuses: collected.sourceStatuses,
      scheduler: mergeArenaScheduler(previous.scheduler),
      status: previous.items.length > 0 ? "failed" : "empty",
      message: previous.items.length > 0
        ? "模型竞技场刷新失败或来源未提供可验证结构化评分，当前保留上一版可信快照。"
        : "模型竞技场来源暂不可用或未提供可验证结构化评分，暂无可靠数据。"
    };
    await writeJsonCache(ARENA_CACHE_FILE, next);
    return buildArenaResponse(next);
  }

  const trendHistory = mergeTrendHistory(previous, collected.items, now);
  const next: ArenaCacheFile = {
    updatedAt: now,
    lastChangedAt: now,
    items: collected.items,
    sourceStatuses: collected.sourceStatuses,
    trendHistory,
    scheduler: mergeArenaScheduler(previous.scheduler),
    status: "ok"
  };
  await writeJsonCache(ARENA_CACHE_FILE, next);
  return buildArenaResponse(next);
}

export async function runScheduledArenaRefresh(reason: ArenaSchedulerReason) {
  const cache = await readJsonCache<ArenaCacheFile>(ARENA_CACHE_FILE, defaultArenaCache());
  const now = new Date();
  const nowIso = now.toISOString();
  const today = shanghaiDateKey(now);

  if (hasFreshArenaLock(cache, now)) {
    return buildArenaResponse({
      ...cache,
      scheduler: mergeArenaScheduler(cache.scheduler, {
        lastMessage: `已有模型竞技场刷新任务正在运行，runId=${cache.scheduler?.runId || "unknown"}。`
      })
    });
  }

  if ((reason === "cron" || reason === "startup-catchup") && wasArenaRefreshedForToday(cache, today)) {
    const skipped: ArenaCacheFile = {
      ...cache,
      scheduler: mergeArenaScheduler(cache.scheduler, {
        running: false,
        runId: null,
        reason,
        startedAt: null,
        expiresAt: null,
        lastRunAt: nowIso,
        lastStatus: "skipped",
        lastMessage: `${today} 已有模型竞技场成功刷新记录，跳过重复执行。`
      })
    };
    await writeJsonCache(ARENA_CACHE_FILE, skipped);
    return buildArenaResponse(skipped);
  }

  const runId = crypto.randomUUID();
  const running: ArenaCacheFile = {
    ...cache,
    scheduler: mergeArenaScheduler(cache.scheduler, {
      running: true,
      runId,
      reason,
      startedAt: nowIso,
      expiresAt: new Date(now.getTime() + ARENA_SCHEDULER_LOCK_TTL_MS).toISOString(),
      lastRunAt: nowIso,
      lastStatus: "running",
      lastMessage: "模型竞技场刷新任务正在执行。"
    })
  };
  await writeJsonCache(ARENA_CACHE_FILE, running);

  try {
    const snapshot = await refreshArenaSnapshot();
    const completedAt = new Date().toISOString();
    const latest = await readJsonCache<ArenaCacheFile>(ARENA_CACHE_FILE, defaultArenaCache());
    const status: ArenaSchedulerStatusValue = snapshot.status;
    const success = status === "ok" || status === "empty";
    const completed: ArenaCacheFile = {
      ...latest,
      scheduler: mergeArenaScheduler(latest.scheduler, {
        running: false,
        runId: null,
        reason,
        startedAt: null,
        expiresAt: null,
        lastRunAt: completedAt,
        lastSuccessAt: success ? completedAt : latest.scheduler?.lastSuccessAt || null,
        lastSuccessDateGroup: success ? today : latest.scheduler?.lastSuccessDateGroup || null,
        lastStatus: status,
        lastMessage: snapshot.message || (status === "ok" ? `模型竞技场刷新完成，获取 ${snapshot.items.length} 个模型。` : "模型竞技场来源可访问，但没有新的可解析模型数据。")
      })
    };
    await writeJsonCache(ARENA_CACHE_FILE, completed);
    return buildArenaResponse(completed);
  } catch (error: any) {
    const failedAt = new Date().toISOString();
    const latest = await readJsonCache<ArenaCacheFile>(ARENA_CACHE_FILE, defaultArenaCache());
    const failed: ArenaCacheFile = {
      ...latest,
      status: latest.items.length > 0 ? "failed" : "empty",
      message: latest.items.length > 0
        ? "模型竞技场刷新失败，当前保留上一版可信快照。"
        : "模型竞技场刷新失败，暂无可靠数据。",
      scheduler: mergeArenaScheduler(latest.scheduler, {
        running: false,
        runId: null,
        reason,
        startedAt: null,
        expiresAt: null,
        lastRunAt: failedAt,
        lastStatus: "failed",
        lastMessage: error?.message || "模型竞技场刷新失败。"
      })
    };
    await writeJsonCache(ARENA_CACHE_FILE, failed);
    throw error;
  }
}

export async function ensureArenaCache() {
  const cache = await readJsonCache<ArenaCacheFile>(ARENA_CACHE_FILE, defaultArenaCache());
  if (!cache.items?.length) {
    await runScheduledArenaRefresh("startup-catchup");
    return;
  }
  if (hasPassedDailyRefresh() && !wasArenaRefreshedForToday(cache)) {
    await runScheduledArenaRefresh("startup-catchup");
  }
}

export function webSearchStatus() {
  return {
    tavilyConfigured: Boolean(process.env.TAVILY_API_KEY),
    braveConfigured: Boolean(process.env.BRAVE_SEARCH_API_KEY)
  };
}
