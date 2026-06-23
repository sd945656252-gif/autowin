import crypto from "crypto";
import { prisma } from "../../db/prisma";
import { assertSafeOutboundUrl, parseHttpUrl } from "../../security/outbound-url";
import { NEWS_BROADCAST_SOURCES } from "./news-sources";
import { createTranslationStats, mergeTranslationStats, translateNewsEvidence, type NewsTranslationStats } from "./news-translation.service";

export type BroadcastCredibilityStatus = "VERIFIED" | "PENDING_REVIEW";

export type BroadcastNewsItem = {
  id?: string;
  dateGroup: string;
  category: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  credibilityStatus: BroadcastCredibilityStatus;
  fetchedAt: string;
  updatedAt?: string;
};

export type BroadcastRefreshStats = {
  updatedAt: string | null;
  status: "ok" | "failed" | "empty";
  message?: string;
  sourceCount: number;
  fetchedCount: number;
  filteredCount: number;
  pendingReviewCount: number;
  translation?: NewsTranslationStats;
  cacheDateRange: { from: string; to: string };
  lastSuccessfulUpdateAt: string | null;
  sourceStatuses?: BroadcastSourceStatus[];
  scheduler?: BroadcastSchedulerStats;
};

export type BroadcastSchedulerReason = "cron" | "startup-catchup" | "manual";

export type BroadcastSchedulerStatus = "idle" | "running" | "ok" | "empty" | "failed" | "skipped";

export type BroadcastSchedulerStats = {
  schedulerEnabled: boolean;
  dailyRunTime: string;
  nextScheduledRunAt: string | null;
  lastScheduledRunAt: string | null;
  lastScheduledReason: BroadcastSchedulerReason | null;
  lastScheduledStatus: BroadcastSchedulerStatus;
  lastScheduledMessage?: string;
  runningRunId?: string | null;
  startedAt?: string | null;
  expiresAt?: string | null;
  lastCompletedRunId?: string | null;
  lastSuccessfulDateGroup?: string | null;
};

export type BroadcastSourceStatus = {
  sourceName: string;
  sourceUrl: string;
  category: string;
  trustLevel: SourceDefinition["trustLevel"];
  parser: SourceDefinition["parser"];
  ok: boolean;
  statusCode?: number;
  linkCount: number;
  candidateCount: number;
  filteredCount: number;
  pendingReviewCount: number;
  fetchedAt: string;
  message?: string;
};

export type BroadcastResponse = {
  days: string[];
  groups: Array<{ dateGroup: string; items: BroadcastNewsItem[] }>;
  items: BroadcastNewsItem[];
  maxPerDay: number;
  retentionDays: number;
  stats: BroadcastRefreshStats;
  updateFailed: boolean;
  statusMessage?: string;
  webSearch?: { tavilyConfigured: boolean; braveConfigured: boolean };
};

type SourceDefinition = {
  sourceName: string;
  url: string;
  category: string;
  trustLevel: "OFFICIAL" | "BENCHMARK" | "GITHUB" | "MEDIA" | "COMMUNITY";
  parser: "HTML_ARTICLE" | "SITEMAP" | "RSS" | "GITHUB_RELEASES" | "STATIC_JSON" | "LEADERBOARD_PAGE";
  maxItemsPerFetch: number;
};

type Candidate = {
  dateGroup: string;
  category: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  credibilityStatus: BroadcastCredibilityStatus;
};

type ArticleLink = {
  url: string;
  label: string;
  dateGroup?: string | null;
  excerpt?: string;
};

type ExtraBroadcastSourceInput = {
  name?: string;
  url?: string;
  category?: string;
  trustLevel?: SourceDefinition["trustLevel"];
  maxItemsPerFetch?: number;
};

const RETENTION_DAYS = 7;
const MAX_NEWS_PER_DAY = 20;
const MIN_TARGET_NEWS_PER_DAY = 8;
const CATEGORY_TARGET_PER_DAY = 2;
const CATEGORY_SOFT_LIMIT_PER_DAY = 3;
const CATEGORY_HARD_LIMIT_PER_DAY = 7;
const INITIALIZE_MAX_ITEMS_PER_SOURCE = 30;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const BROADCAST_META_KEY = "__broadcast_refresh_status__";
const DAILY_REFRESH_HOUR = 8;
const DAILY_REFRESH_MINUTE = 55;
const SCHEDULER_LOCK_TTL_MS = 15 * 60 * 1000;
const MIN_SUMMARY_LENGTH = 36;
const STARTUP_EMPTY_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PLACEHOLDER_PATTERNS = [
  /官方页面近期 AI 更新/i,
  /该来源可能包含模型、API 或工作流能力变化/i,
  /点击原文核验完整发布内容/i,
  /please click/i,
  /may include/i
];

const AI_NEWS_CATEGORIES = [
  "大语言模型",
  "多模态模型",
  "生图模型",
  "生视频模型",
  "音频模型",
  "智能体",
  "AI 3D",
  "大厂AI动态",
  "开源工具",
  "AI插件和网站"
] as const;

type AiNewsCategory = typeof AI_NEWS_CATEGORIES[number];

const BIG_TECH_PATTERN = /(OpenAI|Google|Gemini|DeepMind|Meta|Microsoft|NVIDIA|Adobe|Apple|Amazon|Anthropic|xAI|Alibaba|Qwen|Tencent|ByteDance|Baidu|Kuaishou|Kling|DeepSeek|MiniMax|Moonshot|Zhipu|阿里|腾讯|字节|百度|快手|月之暗面|智谱|大厂)/i;
const CATEGORY_RULES: Array<{ category: AiNewsCategory; pattern: RegExp }> = [
  { category: "AI 3D", pattern: /(3D|text-to-3d|image-to-3d|Meshy|mesh|Gaussian Splatting|NeRF|spatial|Blender|Unity|Unreal|三维|文生\s*3D|图生\s*3D|空间重建|材质|贴图)/i },
  { category: "生视频模型", pattern: /(video generation|text-to-video|image-to-video|video model|Runway|Kling|Luma|Sora|Veo|Pika|Gen-\d|video editing|视频生成|文生视频|图生视频|生视频|镜头|分镜|补帧|视频编辑)/i },
  { category: "生图模型", pattern: /(image generation|text-to-image|image editing|image model|Midjourney|FLUX|Stable Diffusion|Firefly|Ideogram|DALL-E|Imagen|ControlNet|LoRA|inpaint|outpaint|upscale|图像生成|文生图|图生图|生图|图像编辑|角色一致性|扩图|重绘)/i },
  { category: "音频模型", pattern: /(audio|voice|speech|TTS|text-to-speech|voice clone|music generation|Suno|ElevenLabs|Udio|sound effect|Foley|语音|音频|声音克隆|配音|音乐生成|音效|拟音|降噪)/i },
  { category: "智能体", pattern: /(agent|agents|agentic|multi-agent|tool use|tools|browser|operator|Manus|AutoGen|CrewAI|LangGraph|workflow automation|computer use|代码执行|智能体|多工具|多智能体|自动执行|任务规划|工作流自动化|NPC)/i },
  { category: "多模态模型", pattern: /(multimodal|vision-language|vision language|VLM|image understanding|video understanding|audio.*vision|real-time voice|live translate|视觉理解|视频理解|图文问答|多模态|实时语音|跨模态)/i },
  { category: "大语言模型", pattern: /(LLM|large language model|language model|GPT|Claude|Gemini|Qwen|DeepSeek|Llama|Mistral|Mixtral|GLM|Moonshot|Kimi|context|reasoning|code model|coding model|大语言模型|语言模型|推理模型|代码模型|长上下文|文本生成)/i },
  { category: "开源工具", pattern: /(open source|GitHub|Hugging Face|ComfyUI|Stable Diffusion|LoRA|ControlNet|local deploy|inference|quantization|vLLM|Ollama|llama.cpp|开源|本地部署|推理加速|量化|节点|工作流模板)/i },
  { category: "AI插件和网站", pattern: /(plugin|extension|website|web app|platform|Figma|Photoshop|VS Code|browser extension|ComfyUI plugin|Blender plugin|Unity plugin|Unreal plugin|插件|网站|平台|浏览器扩展|在线工具)/i }
];

function parseExtraBroadcastSources(): SourceDefinition[] {
  const raw = process.env.NEWS_BROADCAST_EXTRA_RSS_SOURCES?.trim();
  if (!raw) return [];
  let values: ExtraBroadcastSourceInput[];
  try {
    const parsed = JSON.parse(raw);
    values = Array.isArray(parsed) ? parsed : [];
  } catch {
    values = raw.split(",").map((url) => ({ url: url.trim() })).filter((item) => item.url);
  }
  return values.flatMap((item, index) => {
    if (!item.url) return [];
    try {
      parseHttpUrl(item.url, "extra news RSS source URL");
    } catch {
      return [];
    }
    const trustLevel = item.trustLevel && ["OFFICIAL", "BENCHMARK", "GITHUB", "MEDIA", "COMMUNITY"].includes(item.trustLevel)
      ? item.trustLevel
      : "MEDIA";
    return [{
      sourceName: item.name?.trim() || `Extra RSS Source ${index + 1}`,
      url: item.url,
      category: item.category?.trim() || "外部 RSS 新闻",
      trustLevel,
      parser: "RSS" as const,
      maxItemsPerFetch: Math.max(1, Math.min(Number(item.maxItemsPerFetch) || 12, 30))
    }];
  });
}

const TRUSTED_SOURCES: SourceDefinition[] = NEWS_BROADCAST_SOURCES
  .filter((source) => source.enabled)
  .map((source) => ({
    sourceName: source.name,
    url: source.url,
    category: source.category,
    trustLevel: source.trustLevel,
    parser: source.parser,
    maxItemsPerFetch: source.maxItemsPerFetch
  }))
  .concat(parseExtraBroadcastSources());

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function shanghaiDateTimeParts(date = new Date()) {
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

export function shanghaiDateKey(date = new Date()) {
  const { year, month, day } = shanghaiParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateKeyToUtcNoon(dateGroup: string) {
  return new Date(`${dateGroup}T04:00:00.000Z`);
}

function addDays(dateGroup: string, days: number) {
  const date = dateKeyToUtcNoon(dateGroup);
  date.setUTCDate(date.getUTCDate() + days);
  return shanghaiDateKey(date);
}

function shanghaiScheduledInstant(dateGroup: string) {
  return new Date(`${dateGroup}T${String(DAILY_REFRESH_HOUR).padStart(2, "0")}:${String(DAILY_REFRESH_MINUTE).padStart(2, "0")}:00+08:00`).toISOString();
}

function hasPassedDailyRefresh(date = new Date()) {
  const parts = shanghaiDateTimeParts(date);
  return parts.hour > DAILY_REFRESH_HOUR || (parts.hour === DAILY_REFRESH_HOUR && parts.minute >= DAILY_REFRESH_MINUTE);
}

function nextScheduledRunAt(date = new Date()) {
  const today = shanghaiDateKey(date);
  const targetDate = hasPassedDailyRefresh(date) ? addDays(today, 1) : today;
  return shanghaiScheduledInstant(targetDate);
}

function statsDateGroup(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : shanghaiDateKey(date);
}

export function recentShanghaiDateKeys(count = RETENTION_DAYS, base = new Date()) {
  const today = shanghaiDateKey(base);
  return Array.from({ length: count }, (_, index) => addDays(today, -index));
}

function dedupeKey(input: { sourceUrl: string; title: string; dateGroup: string }) {
  const normalizedUrl = input.sourceUrl.trim().toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
  const normalizedTitle = input.title.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(`${input.dateGroup}:${normalizedUrl}:${normalizedTitle}`, "utf8").digest("hex");
}

function isAiRelated(text: string) {
  return /(\bAI\b|artificial intelligence|machine learning|LLM|large language model|model|multimodal|agent|workflow|API|OpenAI|Anthropic|Claude|Gemini|DeepMind|Qwen|DeepSeek|Runway|Luma|Sora|Veo|video generation|image generation|text generation|生成式|人工智能|模型|多模态|智能体|工作流|图像生成|视频生成|文本生成|大模型)/i.test(text);
}

function normalizeWhitespace(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(value: string) {
  return normalizeWhitespace(value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">"));
}

function extractTitle(html: string) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = og || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  return normalizeWhitespace(title).slice(0, 220);
}

function absoluteUrl(href: string, baseUrl: string) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function sameHostname(url: string, baseUrl: string) {
  try {
    return new URL(url).hostname === new URL(baseUrl).hostname;
  } catch {
    return false;
  }
}

function extractArticleLinks(html: string, baseUrl: string, maxItems: number): ArticleLink[] {
  const links: ArticleLink[] = [];
  const linkPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html))) {
    const url = absoluteUrl(match[1], baseUrl).replace(/#.*$/, "");
    const label = normalizeWhitespace(match[2]);
    if (!url || !sameHostname(url, baseUrl)) continue;
    if (!isAiRelated(`${label} ${url}`)) continue;
    if (url === baseUrl || url === baseUrl.replace(/\/$/, "")) continue;
    links.push({ url, label });
  }
  const unique = new Map<string, { url: string; label: string }>();
  for (const link of links) {
    if (!unique.has(link.url)) unique.set(link.url, link);
  }
  return Array.from(unique.values()).slice(0, maxItems);
}

function extractTag(block: string, tagName: string) {
  return block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"))?.[1] || "";
}

function extractAtomLink(block: string) {
  const alternate = block.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i)?.[1];
  const href = alternate || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
  return href || "";
}

function parseFeedDate(value: string) {
  const date = new Date(decodeXmlEntities(value));
  return Number.isNaN(date.getTime()) ? null : shanghaiDateKey(date);
}

function extractFeedLinks(xml: string, baseUrl: string, maxItems: number): ArticleLink[] {
  const links: ArticleLink[] = [];
  const itemPattern = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml))) {
    const block = match[0];
    const label = decodeXmlEntities(extractTag(block, "title"));
    const rawUrl = match[1].toLowerCase() === "entry" ? extractAtomLink(block) : decodeXmlEntities(extractTag(block, "link"));
    const url = absoluteUrl(rawUrl, baseUrl).replace(/#.*$/, "");
    const published = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated") || extractTag(block, "dc:date");
    const excerpt = decodeXmlEntities(extractTag(block, "description") || extractTag(block, "summary") || extractTag(block, "content:encoded") || extractTag(block, "content"));
    if (!url || !label || !isAiRelated(`${label} ${excerpt} ${url}`)) continue;
    links.push({ url, label, dateGroup: parseFeedDate(published), excerpt });
  }
  const unique = new Map<string, ArticleLink>();
  for (const link of links) {
    if (!unique.has(link.url)) unique.set(link.url, link);
  }
  return Array.from(unique.values()).slice(0, maxItems);
}

function extractJsonLdLinks(html: string, baseUrl: string, maxItems: number): ArticleLink[] {
  const links: ArticleLink[] = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const typeValue = Array.isArray(node["@type"]) ? node["@type"].join(" ") : String(node["@type"] || "");
    const title = String(node.headline || node.name || "").trim();
    const rawUrl = String(node.url || node.mainEntityOfPage?.["@id"] || node.mainEntityOfPage || "").trim();
    const excerpt = String(node.description || "").trim();
    if (/Article|BlogPosting|NewsArticle/i.test(typeValue) && title && rawUrl) {
      const url = absoluteUrl(rawUrl, baseUrl).replace(/#.*$/, "");
      const dateGroup = parseFeedDate(String(node.datePublished || node.dateModified || ""));
      if (url && isAiRelated(`${title} ${excerpt} ${url}`)) links.push({ url, label: title, dateGroup, excerpt: normalizeWhitespace(excerpt) });
    }
    Object.values(node).forEach(visit);
  };

  while ((match = scriptPattern.exec(html))) {
    try {
      visit(JSON.parse(match[1].trim()));
    } catch {
      // Ignore malformed structured data from third-party pages.
    }
  }
  const unique = new Map<string, ArticleLink>();
  for (const link of links) {
    if (!unique.has(link.url)) unique.set(link.url, link);
  }
  return Array.from(unique.values()).slice(0, maxItems);
}

function collectArticleLinks(indexBody: string, source: SourceDefinition): ArticleLink[] {
  const feedLinks = /<(rss|feed)\b/i.test(indexBody) ? extractFeedLinks(indexBody, source.url, source.maxItemsPerFetch) : [];
  const jsonLdLinks = extractJsonLdLinks(indexBody, source.url, source.maxItemsPerFetch);
  const htmlLinks = extractArticleLinks(indexBody, source.url, source.maxItemsPerFetch);
  const unique = new Map<string, ArticleLink>();
  for (const link of [...feedLinks, ...jsonLdLinks, ...htmlLinks]) {
    if (!unique.has(link.url)) unique.set(link.url, link);
  }
  return Array.from(unique.values()).slice(0, source.maxItemsPerFetch);
}

function extractPublishedDate(html: string) {
  const candidates = [
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1],
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1],
    html.match(/"dateModified"\s*:\s*"([^"]+)"/i)?.[1],
    html.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
  ].filter(Boolean) as string[];
  for (const value of candidates) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return shanghaiDateKey(date);
  }
  return null;
}

function extractBodyText(html: string) {
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0];
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0];
  const body = article || main || html.match(/<body[\s\S]*?<\/body>/i)?.[0] || html;
  return normalizeWhitespace(body);
}

function summarizeBody(body: string, title: string) {
  const sentences = body
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30 && !sentence.includes("cookie") && !sentence.includes("Subscribe"));
  const relevant = sentences.filter((sentence) => isAiRelated(`${title} ${sentence}`));
  const picked = (relevant.length > 0 ? relevant : sentences).slice(0, 2).join(" ");
  return picked.slice(0, 320).trim();
}

function hasChineseText(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

async function fetchSourceHtml(url: string) {
  await assertSafeOutboundUrl(url, "trusted news source URL");
  const response = await fetch(url, {
    headers: {
      "User-Agent": "JiyingNewsBroadcast/1.0 (+https://localhost)",
      Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }
  return { body: await response.text(), statusCode: response.status };
}

function validHttpUrl(url: string) {
  try {
    parseHttpUrl(url, "news URL");
    return true;
  } catch {
    return false;
  }
}

function validateCandidate(candidate: Candidate) {
  if (!candidate.title || !candidate.summary || !candidate.sourceName || !candidate.sourceUrl || !candidate.category) return null;
  if (!validHttpUrl(candidate.sourceUrl)) return null;
  if (candidate.summary.length < MIN_SUMMARY_LENGTH) return null;
  if (!hasChineseText(`${candidate.title} ${candidate.summary}`)) return null;
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(candidate.summary))) return null;
  if (!isAiRelated(`${candidate.title} ${candidate.summary} ${candidate.category}`)) return null;
  return {
    ...candidate,
    category: classifyCandidate(candidate),
    title: candidate.title.slice(0, 220),
    summary: candidate.summary.slice(0, 360),
    sourceName: candidate.sourceName.slice(0, 120),
  };
}

function classifyCandidate(candidate: Pick<Candidate, "title" | "summary" | "sourceName" | "category">): AiNewsCategory {
  const text = `${candidate.title} ${candidate.summary} ${candidate.sourceName} ${candidate.category}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  if (BIG_TECH_PATTERN.test(text)) return "大厂AI动态";
  if (/model|模型/i.test(text)) return "大语言模型";
  return "AI插件和网站";
}

function credibilityStatusForSource(source: SourceDefinition): BroadcastCredibilityStatus {
  return source.trustLevel === "OFFICIAL" || source.trustLevel === "GITHUB" || source.trustLevel === "BENCHMARK"
    ? "VERIFIED"
    : "PENDING_REVIEW";
}

function buildCandidateFromFeedFallback(source: SourceDefinition, link: ArticleLink, targetDates: string[]) {
  if (!link.dateGroup || !targetDates.includes(link.dateGroup) || !link.excerpt || !link.label) return null;
  if (!isAiRelated(`${link.label} ${link.excerpt} ${link.url}`)) return null;
  return {
    dateGroup: link.dateGroup,
    title: link.label,
    body: link.excerpt,
    evidenceSummary: link.excerpt,
    credibilityStatus: credibilityStatusForSource(source)
  };
}

function candidateRank(candidate: Candidate) {
  const credibilityScore = candidate.credibilityStatus === "VERIFIED" ? 0 : 1;
  const categoryScore = AI_NEWS_CATEGORIES.indexOf(classifyCandidate(candidate));
  return `${credibilityScore}:${String(categoryScore < 0 ? 99 : categoryScore).padStart(2, "0")}:${candidate.sourceName}:${candidate.title}`;
}

function selectBalancedDayCandidates(dayCandidates: Candidate[]) {
  const unique = new Map<string, Candidate>();
  for (const item of dayCandidates) {
    const key = dedupeKey(item);
    if (!unique.has(key)) unique.set(key, { ...item, category: classifyCandidate(item) });
  }
  const candidates = Array.from(unique.values()).sort((a, b) => candidateRank(a).localeCompare(candidateRank(b)));
  const selected: Candidate[] = [];
  const selectedKeys = new Set<string>();
  const categoryCounts = new Map<string, number>();

  const pick = (predicate: (item: Candidate, categoryCount: number) => boolean, limit: number) => {
    for (const item of candidates) {
      if (selected.length >= limit) return;
      const key = dedupeKey(item);
      if (selectedKeys.has(key)) continue;
      const categoryCount = categoryCounts.get(item.category) || 0;
      if (!predicate(item, categoryCount)) continue;
      selected.push(item);
      selectedKeys.add(key);
      categoryCounts.set(item.category, categoryCount + 1);
    }
  };

  pick((_item, count) => count < CATEGORY_TARGET_PER_DAY, MAX_NEWS_PER_DAY);
  pick((_item, count) => count < CATEGORY_SOFT_LIMIT_PER_DAY, MAX_NEWS_PER_DAY);
  if (selected.length < MIN_TARGET_NEWS_PER_DAY) {
    pick((_item, count) => count < CATEGORY_HARD_LIMIT_PER_DAY, MIN_TARGET_NEWS_PER_DAY);
  }
  if (selected.length < MIN_TARGET_NEWS_PER_DAY) {
    pick((_item, count) => count < CATEGORY_HARD_LIMIT_PER_DAY, MAX_NEWS_PER_DAY);
  }

  return selected.slice(0, MAX_NEWS_PER_DAY);
}

function selectBalancedCandidates(candidates: Candidate[]) {
  const byDay = new Map<string, Candidate[]>();
  for (const item of candidates) {
    const list = byDay.get(item.dateGroup) || [];
    list.push(item);
    byDay.set(item.dateGroup, list);
  }
  return Array.from(byDay.keys())
    .sort((a, b) => b.localeCompare(a))
    .flatMap((dateGroup) => selectBalancedDayCandidates(byDay.get(dateGroup) || []));
}

async function collectTrustedSourceCandidates(targetDates: string[], options: { maxItemsPerSource?: number } = {}) {
  const candidates: Candidate[] = [];
  let filteredCount = 0;
  let pendingReviewCount = 0;
  const translationStats = createTranslationStats();
  const sourceStatuses: BroadcastSourceStatus[] = [];

  await Promise.all(TRUSTED_SOURCES.map(async (source) => {
    const activeSource = options.maxItemsPerSource
      ? { ...source, maxItemsPerFetch: Math.max(source.maxItemsPerFetch, options.maxItemsPerSource) }
      : source;
    const sourceStatus: BroadcastSourceStatus = {
      sourceName: activeSource.sourceName,
      sourceUrl: activeSource.url,
      category: activeSource.category,
      trustLevel: activeSource.trustLevel,
      parser: activeSource.parser,
      ok: false,
      linkCount: 0,
      candidateCount: 0,
      filteredCount: 0,
      pendingReviewCount: 0,
      fetchedAt: new Date().toISOString()
    };
    try {
      const indexResponse = await fetchSourceHtml(activeSource.url);
      sourceStatus.statusCode = indexResponse.statusCode;
      const indexHtml = indexResponse.body;
      const links = collectArticleLinks(indexHtml, activeSource);
      sourceStatus.linkCount = links.length;
      if (links.length === 0) {
        filteredCount += 1;
        sourceStatus.filteredCount += 1;
        sourceStatus.message = "来源可访问，但没有解析到可用新闻链接。";
        return;
      }
      for (const link of links) {
        let feedFallbackUsed = false;
        try {
          let candidateEvidence: ReturnType<typeof buildCandidateFromFeedFallback> = null;
          try {
            const articleResponse = await fetchSourceHtml(link.url);
            const articleHtml = articleResponse.body;
            const dateGroup = extractPublishedDate(articleHtml) || link.dateGroup || null;
            if (dateGroup && targetDates.includes(dateGroup)) {
              const title = extractTitle(articleHtml) || link.label;
              const body = extractBodyText(articleHtml);
              const evidenceSummary = summarizeBody(body, title) || link.excerpt || "";
              const combined = `${title} ${evidenceSummary} ${body.slice(0, 1000)}`;
              if (title && evidenceSummary && isAiRelated(combined)) {
                candidateEvidence = {
                  dateGroup,
                  title,
                  body,
                  evidenceSummary,
                  credibilityStatus: credibilityStatusForSource(activeSource)
                };
              }
            }
          } catch (error: any) {
            candidateEvidence = buildCandidateFromFeedFallback(activeSource, link, targetDates);
            feedFallbackUsed = Boolean(candidateEvidence);
            if (!candidateEvidence) throw error;
          }

          if (!candidateEvidence) {
            filteredCount += 1;
            sourceStatus.filteredCount += 1;
            continue;
          }
          const translated = await translateNewsEvidence({
            title: candidateEvidence.title,
            body: `${candidateEvidence.evidenceSummary}\n\n${candidateEvidence.body}`,
            sourceName: activeSource.sourceName,
            sourceUrl: link.url,
            category: activeSource.category
          });
          mergeTranslationStats(translationStats, translated.stats);
          if (!translated.result) {
            pendingReviewCount += 1;
            sourceStatus.pendingReviewCount += 1;
            continue;
          }
          const item = validateCandidate({
            dateGroup: candidateEvidence.dateGroup,
            category: activeSource.category,
            title: translated.result.titleZh,
            summary: translated.result.summaryZh,
            sourceName: activeSource.sourceName,
            sourceUrl: link.url,
            credibilityStatus: feedFallbackUsed ? "PENDING_REVIEW" : candidateEvidence.credibilityStatus
          });
          if (item) {
            candidates.push(item);
            sourceStatus.candidateCount += 1;
          } else {
            filteredCount += 1;
            sourceStatus.filteredCount += 1;
          }
        } catch (error: any) {
          pendingReviewCount += 1;
          sourceStatus.pendingReviewCount += 1;
          sourceStatus.message = sourceStatus.message || (error?.message || String(error));
          console.warn("[NewsBroadcast] Article fetch failed", { source: activeSource.sourceName, url: link.url, message: error?.message || String(error) });
        }
      }
      sourceStatus.ok = sourceStatus.linkCount > 0;
      if (!sourceStatus.message) {
        sourceStatus.message = sourceStatus.candidateCount > 0
          ? `本轮入库 ${sourceStatus.candidateCount} 条。`
          : "来源可访问且可解析，本轮没有符合日期、AI 相关性或中文摘要校验的条目。";
      }
    } catch (error: any) {
      pendingReviewCount += 1;
      sourceStatus.pendingReviewCount += 1;
      sourceStatus.statusCode = error?.statusCode;
      sourceStatus.message = error?.message || String(error);
      console.warn("[NewsBroadcast] Trusted source failed", { source: activeSource.sourceName, message: error?.message || String(error) });
    } finally {
      sourceStatuses.push(sourceStatus);
    }
  }));

  return { candidates, filteredCount, pendingReviewCount, sourceCount: TRUSTED_SOURCES.length, translationStats, sourceStatuses };
}
async function storeStats(stats: BroadcastRefreshStats) {
  await prisma.newsItem.upsert({
    where: { dedupeKey: BROADCAST_META_KEY },
    create: {
      dedupeKey: BROADCAST_META_KEY,
      dateGroup: null,
      title: "AI News Broadcast Refresh Status",
      summary: stats.message || stats.status,
      category: "meta",
      source: "system",
      url: null,
      credibilityStatus: "VERIFIED",
      publishedAt: null,
      fetchedAt: stats.updatedAt ? new Date(stats.updatedAt) : null,
      metadata: stats
    },
    update: {
      summary: stats.message || stats.status,
      fetchedAt: stats.updatedAt ? new Date(stats.updatedAt) : null,
      metadata: stats
    }
  });
}

function defaultSchedulerStats(base?: Partial<BroadcastSchedulerStats>): BroadcastSchedulerStats {
  return {
    schedulerEnabled: true,
    dailyRunTime: `${String(DAILY_REFRESH_HOUR).padStart(2, "0")}:${String(DAILY_REFRESH_MINUTE).padStart(2, "0")} Asia/Shanghai`,
    nextScheduledRunAt: nextScheduledRunAt(),
    lastScheduledRunAt: null,
    lastScheduledReason: null,
    lastScheduledStatus: "idle",
    runningRunId: null,
    startedAt: null,
    expiresAt: null,
    lastCompletedRunId: null,
    lastSuccessfulDateGroup: null,
    ...base
  };
}

function mergeSchedulerStats(stats?: BroadcastSchedulerStats | null, patch: Partial<BroadcastSchedulerStats> = {}) {
  return defaultSchedulerStats({ ...(stats || {}), ...patch, nextScheduledRunAt: nextScheduledRunAt() });
}

function hasFreshRunningLock(stats: BroadcastRefreshStats, now = new Date()) {
  if (stats.scheduler?.lastScheduledStatus !== "running" || !stats.scheduler.expiresAt) return false;
  return new Date(stats.scheduler.expiresAt).getTime() > now.getTime();
}

function wasSuccessfullyRefreshedForDate(stats: BroadcastRefreshStats, dateGroup = shanghaiDateKey()) {
  if (stats.scheduler?.lastSuccessfulDateGroup === dateGroup) return true;
  if (stats.scheduler?.lastSuccessfulDateGroup) return false;
  if ((stats.status === "ok" || stats.status === "empty") && statsDateGroup(stats.updatedAt) === dateGroup) return true;
  return statsDateGroup(stats.lastSuccessfulUpdateAt) === dateGroup;
}

async function readStats(days = recentShanghaiDateKeys()): Promise<BroadcastRefreshStats> {
  const meta = await prisma.newsItem.findUnique({ where: { dedupeKey: BROADCAST_META_KEY } });
  const currentCacheDateRange = { from: days[days.length - 1], to: days[0] };
  const fallback: BroadcastRefreshStats = {
    updatedAt: null,
    status: "empty",
    sourceCount: TRUSTED_SOURCES.length,
    fetchedCount: 0,
    filteredCount: 0,
    pendingReviewCount: 0,
      cacheDateRange: currentCacheDateRange,
      lastSuccessfulUpdateAt: null,
    sourceStatuses: [],
    scheduler: defaultSchedulerStats()
  };
  if (!meta?.metadata || typeof meta.metadata !== "object") return fallback;
  const metadata = meta.metadata as any;
  return {
    ...fallback,
    ...metadata,
    sourceCount: TRUSTED_SOURCES.length,
    cacheDateRange: currentCacheDateRange,
    scheduler: mergeSchedulerStats(metadata.scheduler)
  };
}

export async function cleanupBroadcastRetention(days = recentShanghaiDateKeys()) {
  await prisma.newsItem.deleteMany({
    where: {
      dedupeKey: { not: BROADCAST_META_KEY },
      OR: [
        { dateGroup: null },
        { dateGroup: { notIn: days } }
      ]
    }
  });
  const retained = await prisma.newsItem.findMany({
    where: { dedupeKey: { not: BROADCAST_META_KEY }, dateGroup: { in: days } },
    select: { id: true, title: true, summary: true, source: true, url: true, category: true, dateGroup: true }
  });
  const invalidIds = retained
    .filter((item) => !validateCandidate({
      dateGroup: item.dateGroup || "",
      category: item.category || "",
      title: item.title || "",
      summary: item.summary || "",
      sourceName: item.source || "",
      sourceUrl: item.url || "",
      credibilityStatus: "VERIFIED"
    }))
    .map((item) => item.id);
  if (invalidIds.length > 0) await prisma.newsItem.deleteMany({ where: { id: { in: invalidIds } } });
  const overLimit = await prisma.newsItem.findMany({
    where: { dedupeKey: { not: BROADCAST_META_KEY }, dateGroup: { in: days } },
    orderBy: [{ dateGroup: "desc" }, { updatedAt: "desc" }]
  });
  const seenByDay = new Map<string, number>();
  const deleteIds: string[] = [];
  for (const item of overLimit) {
    const key = item.dateGroup || "";
    const count = seenByDay.get(key) || 0;
    if (count >= MAX_NEWS_PER_DAY) deleteIds.push(item.id);
    seenByDay.set(key, count + 1);
  }
  if (deleteIds.length > 0) await prisma.newsItem.deleteMany({ where: { id: { in: deleteIds } } });
}

async function writeBroadcastItems(candidates: Candidate[]) {
  const now = new Date();
  const valid = selectBalancedCandidates(candidates.map(validateCandidate).filter(Boolean) as Candidate[]);
  const unique = new Map<string, Candidate>();
  for (const item of valid) {
    const key = dedupeKey(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  const limited = Array.from(unique.values()).slice(0, RETENTION_DAYS * MAX_NEWS_PER_DAY);
  if (limited.length === 0) return { written: 0, dedupeKeys: [] as string[] };
  const dedupeKeys = limited.map((item) => dedupeKey(item));

  await prisma.$transaction(limited.map((item) => {
    const key = dedupeKey(item);
    const publishedAt = dateKeyToUtcNoon(item.dateGroup);
    return prisma.newsItem.upsert({
      where: { dedupeKey: key },
      create: {
        dedupeKey: key,
        dateGroup: item.dateGroup,
        title: item.title,
        summary: item.summary,
        category: item.category,
        url: item.sourceUrl,
        source: item.sourceName,
        credibilityStatus: item.credibilityStatus,
        publishedAt,
        fetchedAt: now,
        metadata: { credibilityStatus: item.credibilityStatus }
      },
      update: {
        dateGroup: item.dateGroup,
        title: item.title,
        summary: item.summary,
        category: item.category,
        url: item.sourceUrl,
        source: item.sourceName,
        credibilityStatus: item.credibilityStatus,
        publishedAt,
        fetchedAt: now,
        metadata: { credibilityStatus: item.credibilityStatus }
      }
    });
  }));
  return { written: limited.length, dedupeKeys };
}

export async function refreshBroadcastNews(options: { initialize?: boolean; dateGroup?: string } = {}) {
  const days = recentShanghaiDateKeys();
  const targetDates = options.dateGroup ? [options.dateGroup] : (options.initialize ? days : [days[0]]);
  const cacheDateRange = { from: days[days.length - 1], to: days[0] };
  const previousStats = await readStats(days);

  try {
    const collected = await collectTrustedSourceCandidates(targetDates, options.initialize ? { maxItemsPerSource: INITIALIZE_MAX_ITEMS_PER_SOURCE } : {});
    const writeResult = await writeBroadcastItems(collected.candidates);
    const written = writeResult.written;
    if (written > 0) {
      for (const dateGroup of targetDates) {
        await prisma.newsItem.deleteMany({
          where: {
            dedupeKey: { not: BROADCAST_META_KEY, notIn: writeResult.dedupeKeys },
            dateGroup
          }
        });
      }
    }
    await cleanupBroadcastRetention(days);

    const status: BroadcastRefreshStats["status"] = written > 0 ? "ok" : "empty";
    const updatedAt = new Date().toISOString();
    const stats: BroadcastRefreshStats = {
      updatedAt,
      status,
      message: status === "ok" ? undefined : "暂无新的可信新闻，已保留原有可信数据。",
      sourceCount: collected.sourceCount,
      fetchedCount: written,
      filteredCount: collected.filteredCount,
      pendingReviewCount: collected.pendingReviewCount,
      translation: collected.translationStats,
      cacheDateRange,
      lastSuccessfulUpdateAt: updatedAt,
      sourceStatuses: collected.sourceStatuses,
      scheduler: previousStats.scheduler
    };
    await storeStats(stats);
    return stats;
  } catch (error: any) {
    const stats: BroadcastRefreshStats = {
      updatedAt: new Date().toISOString(),
      status: "failed",
      message: "今日更新失败，当前使用上次可信数据",
      sourceCount: TRUSTED_SOURCES.length,
      fetchedCount: 0,
      filteredCount: 0,
      pendingReviewCount: 0,
      translation: previousStats.translation,
      cacheDateRange,
      lastSuccessfulUpdateAt: previousStats.lastSuccessfulUpdateAt,
      sourceStatuses: previousStats.sourceStatuses || [],
      scheduler: previousStats.scheduler
    };
    await storeStats(stats);
    console.error("[NewsBroadcast] Refresh failed", error?.message || error);
    return stats;
  }
}

export async function runScheduledNewsRefresh(options: {
  reason: BroadcastSchedulerReason;
  initialize?: boolean;
  dateGroup?: string;
}): Promise<BroadcastRefreshStats> {
  const days = recentShanghaiDateKeys();
  const today = days[0];
  const existing = await readStats(days);
  const now = new Date();

  if (hasFreshRunningLock(existing, now)) {
    return {
      ...existing,
      scheduler: mergeSchedulerStats(existing.scheduler, {
        lastScheduledMessage: `已有新闻刷新任务正在运行，runId=${existing.scheduler?.runningRunId || "unknown"}。`
      })
    };
  }

  if ((options.reason === "cron" || options.reason === "startup-catchup") && !options.dateGroup && wasSuccessfullyRefreshedForDate(existing, today)) {
    const skippedStats: BroadcastRefreshStats = {
      ...existing,
      scheduler: mergeSchedulerStats(existing.scheduler, {
        lastScheduledRunAt: now.toISOString(),
        lastScheduledReason: options.reason,
        lastScheduledStatus: "skipped",
        lastScheduledMessage: `${today} 已有成功刷新记录，跳过重复执行。`,
        runningRunId: null,
        startedAt: null,
        expiresAt: null
      })
    };
    await storeStats(skippedStats);
    return skippedStats;
  }

  const runId = crypto.randomUUID();
  const startedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SCHEDULER_LOCK_TTL_MS).toISOString();
  const runningStats: BroadcastRefreshStats = {
    ...existing,
    scheduler: mergeSchedulerStats(existing.scheduler, {
      lastScheduledRunAt: startedAt,
      lastScheduledReason: options.reason,
      lastScheduledStatus: "running",
      lastScheduledMessage: "新闻刷新任务正在执行。",
      runningRunId: runId,
      startedAt,
      expiresAt
    })
  };
  await storeStats(runningStats);

  try {
    const result = await refreshBroadcastNews({ initialize: options.initialize, dateGroup: options.dateGroup });
    const completedAt = new Date().toISOString();
    const completedStats: BroadcastRefreshStats = {
      ...result,
      scheduler: mergeSchedulerStats(result.scheduler, {
        lastScheduledRunAt: completedAt,
        lastScheduledReason: options.reason,
        lastScheduledStatus: result.status,
        lastScheduledMessage: result.message || (result.status === "ok" ? "新闻刷新完成。" : "新闻刷新完成，暂无新的可信新闻。"),
        runningRunId: null,
        startedAt: null,
        expiresAt: null,
        lastCompletedRunId: runId,
        lastSuccessfulDateGroup: result.status === "failed" ? existing.scheduler?.lastSuccessfulDateGroup || null : (options.dateGroup || today)
      })
    };
    await storeStats(completedStats);
    return completedStats;
  } catch (error: any) {
    const failedAt = new Date().toISOString();
    const latest = await readStats(days);
    const failedStats: BroadcastRefreshStats = {
      ...latest,
      updatedAt: latest.updatedAt || failedAt,
      status: "failed",
      message: "今日更新失败，当前使用上次可信数据",
      scheduler: mergeSchedulerStats(latest.scheduler, {
        lastScheduledRunAt: failedAt,
        lastScheduledReason: options.reason,
        lastScheduledStatus: "failed",
        lastScheduledMessage: error?.message || "新闻刷新失败。",
        runningRunId: null,
        startedAt: null,
        expiresAt: null,
        lastCompletedRunId: runId
      })
    };
    await storeStats(failedStats);
    throw error;
  }
}

export async function ensureBroadcastCache() {
  const days = recentShanghaiDateKeys();
  await cleanupBroadcastRetention(days);
  const existing = await prisma.newsItem.groupBy({
    by: ["dateGroup"],
    where: { dedupeKey: { not: BROADCAST_META_KEY }, dateGroup: { in: days } },
    _count: { id: true }
  });
  if (existing.length === 0) {
    const stats = await readStats(days);
    if (stats.updatedAt && Date.now() - new Date(stats.updatedAt).getTime() < STARTUP_EMPTY_RETRY_INTERVAL_MS) return;
    await runScheduledNewsRefresh({ reason: "startup-catchup", initialize: true });
    return;
  }
  const stats = await readStats(days);
  if (hasPassedDailyRefresh() && !wasSuccessfullyRefreshedForDate(stats, days[0])) {
    await runScheduledNewsRefresh({ reason: "startup-catchup" });
  }
}

function serializeBroadcastItem(item: any): BroadcastNewsItem {
  return {
    id: item.id,
    dateGroup: item.dateGroup,
    category: item.category || "AI 新闻",
    title: item.title,
    summary: item.summary || "",
    sourceName: item.source || "Unknown",
    sourceUrl: item.url || "",
    credibilityStatus: (item.credibilityStatus || "VERIFIED") as BroadcastCredibilityStatus,
    fetchedAt: item.fetchedAt?.toISOString?.() || item.updatedAt?.toISOString?.() || new Date().toISOString(),
    updatedAt: item.updatedAt?.toISOString?.()
  };
}

export async function readBroadcastNews(): Promise<BroadcastResponse> {
  const days = recentShanghaiDateKeys();
  await cleanupBroadcastRetention(days);
  const items = await prisma.newsItem.findMany({
    where: { dedupeKey: { not: BROADCAST_META_KEY }, dateGroup: { in: days } },
    orderBy: [{ dateGroup: "desc" }, { updatedAt: "desc" }]
  });
  const serialized = items
    .map(serializeBroadcastItem)
    .filter((item) => validateCandidate({
      dateGroup: item.dateGroup,
      category: item.category,
      title: item.title,
      summary: item.summary,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      credibilityStatus: item.credibilityStatus
    }));
  const groups = days.map((dateGroup) => ({
    dateGroup,
    items: serialized.filter((item) => item.dateGroup === dateGroup).slice(0, MAX_NEWS_PER_DAY)
  }));
  const stats = await readStats(days);
  return {
    days,
    groups,
    items: groups.flatMap((group) => group.items),
    maxPerDay: MAX_NEWS_PER_DAY,
    retentionDays: RETENTION_DAYS,
    stats,
    updateFailed: stats.status === "failed",
    statusMessage: stats.status === "failed" ? "今日更新失败，当前使用上次可信数据" : stats.message
  };
}

export async function readBroadcastItemsFlat() {
  const broadcast = await readBroadcastNews();
  return broadcast.items.map((item) => ({
    id: item.id,
    publishedAt: `${item.dateGroup}T00:00:00.000+08:00`,
    category: item.category,
    title: item.title,
    summary: item.summary,
    source: item.sourceName,
    url: item.sourceUrl,
    credibilityStatus: item.credibilityStatus
  }));
}

export function broadcastWebSearchStatus() {
  return {
    tavilyConfigured: Boolean(process.env.TAVILY_API_KEY),
    braveConfigured: Boolean(process.env.BRAVE_SEARCH_API_KEY)
  };
}
