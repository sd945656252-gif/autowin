import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { ModelCapability, ModelCapabilityVerificationStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { assertSafeOutboundUrl } from "../../security/outbound-url";
import { safeFetch } from "../../security/safe-outbound";
import { HttpError } from "../../shared/http";
import type { RequestUser } from "../auth/auth.shared";
import { parseCapabilityParams } from "./model-capabilities.schema";
import { metadataFromCapabilityParams, normalizeCapability, normalizeCapabilityStatus, serializeCapabilityProfile } from "./model-capabilities.service";

const OFFICIAL_CAPABILITY_FILE = path.resolve(process.cwd(), "config/model-capabilities.official.json");
const MAX_DOC_BYTES = 768 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const OPENAI_IMAGE_DOC_URLS = [
  "https://developers.openai.com/api/docs/guides/image-generation",
  "https://developers.openai.com/api/reference/resources/images/methods/generate",
  "https://developers.openai.com/api/reference/resources/images/methods/edit"
];

type OfficialCapabilityEntry = {
  canonicalModelId: string;
  officialModelId?: string | null;
  provider: string;
  capability: ModelCapability;
  aliases: string[];
  verificationStatus: ModelCapabilityVerificationStatus;
  sourceType?: string;
  sourceUrls: string[];
  params: Record<string, any>;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sourceHashFor(entry: OfficialCapabilityEntry, params: Record<string, any>) {
  return crypto.createHash("sha256").update(canonicalJson({
    canonicalModelId: entry.canonicalModelId,
    capability: entry.capability,
    params,
    sourceUrls: entry.sourceUrls,
    verificationStatus: entry.verificationStatus
  })).digest("hex");
}

function asStringArray(value: unknown, field: string, max = 20) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array.`, "INVALID_OFFICIAL_CAPABILITY_JSON");
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, max);
}

function parseOfficialEntry(raw: any): OfficialCapabilityEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "Official capability entry must be an object.", "INVALID_OFFICIAL_CAPABILITY_JSON");
  }
  const canonicalModelId = String(raw.canonicalModelId || "").trim();
  const provider = String(raw.provider || "").trim();
  if (!canonicalModelId || !provider) {
    throw new HttpError(400, "Official capability entry requires canonicalModelId and provider.", "INVALID_OFFICIAL_CAPABILITY_JSON");
  }
  const capability = normalizeCapability(raw.capability);
  const verificationStatus = normalizeCapabilityStatus(raw.verificationStatus || ModelCapabilityVerificationStatus.UNVERIFIED);
  if (verificationStatus !== ModelCapabilityVerificationStatus.VERIFIED && verificationStatus !== ModelCapabilityVerificationStatus.MANUAL_VERIFIED) {
    throw new HttpError(400, "Official JSON sync only accepts verified entries.", "OFFICIAL_CAPABILITY_NOT_VERIFIED", { canonicalModelId });
  }
  const params = parseCapabilityParams(capability, raw.params);
  const sourceUrls = asStringArray(raw.sourceUrls, "sourceUrls", 10);
  if (sourceUrls.length === 0) {
    throw new HttpError(400, "Verified official capability entries require sourceUrls.", "OFFICIAL_SOURCE_URL_REQUIRED", { canonicalModelId });
  }
  return {
    canonicalModelId,
    officialModelId: raw.officialModelId ? String(raw.officialModelId).trim() : canonicalModelId,
    provider,
    capability,
    aliases: asStringArray(raw.aliases || [], "aliases", 30),
    verificationStatus,
    sourceType: raw.sourceType ? String(raw.sourceType).slice(0, 80) : undefined,
    sourceUrls,
    params
  };
}

export async function loadOfficialCapabilityEntries() {
  const raw = await fs.readFile(OFFICIAL_CAPABILITY_FILE, "utf8").catch((error) => {
    throw new HttpError(500, "Official capability JSON file is not readable.", "OFFICIAL_CAPABILITY_FILE_UNREADABLE", { path: OFFICIAL_CAPABILITY_FILE, message: error?.message });
  });
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(500, "Official capability JSON file is invalid JSON.", "OFFICIAL_CAPABILITY_FILE_INVALID_JSON");
  }
  const models = Array.isArray(parsed?.models) ? parsed.models : [];
  return models.map(parseOfficialEntry);
}

export async function probeOfficialJson(canonicalModelId?: string) {
  const entries = await loadOfficialCapabilityEntries();
  const filtered = canonicalModelId ? entries.filter((entry) => entry.canonicalModelId === canonicalModelId) : entries;
  return filtered.map((entry) => ({
    canonicalModelId: entry.canonicalModelId,
    officialModelId: entry.officialModelId,
    provider: entry.provider,
    capability: entry.capability,
    verificationStatus: entry.verificationStatus,
    sourceUrls: entry.sourceUrls,
    sourceHash: sourceHashFor(entry, entry.params)
  }));
}

export async function syncOfficialCapabilityEntry(entry: OfficialCapabilityEntry, actor?: RequestUser) {
  const params = parseCapabilityParams(entry.capability, entry.params);
  const sourceHash = sourceHashFor(entry, params);

  return prisma.$transaction(async (tx) => {
    let profile = await tx.modelCapabilityProfile.findFirst({
      where: {
        provider: entry.provider,
        capability: entry.capability,
        canonicalModelId: entry.canonicalModelId
      },
      include: { revisions: { orderBy: { revision: "desc" }, take: 1 } }
    });

    if (!profile) {
      profile = await tx.modelCapabilityProfile.create({
        data: {
          canonicalModelId: entry.canonicalModelId,
          officialModelId: entry.officialModelId,
          provider: entry.provider,
          capability: entry.capability,
          aliases: entry.aliases,
          sourceUrls: entry.sourceUrls,
          verificationStatus: entry.verificationStatus,
          lastCheckedAt: new Date()
        },
        include: { revisions: { orderBy: { revision: "desc" }, take: 1 } }
      });
    }

    const latest = profile.revisions[0];
    let revision = latest;
    let changed = !latest || latest.sourceHash !== sourceHash;
    if (changed) {
      revision = await tx.modelCapabilityRevision.create({
        data: {
          profileId: profile.id,
          revision: (latest?.revision || 0) + 1,
          params: params as Prisma.InputJsonValue,
          sourceHash,
          changedSummary: `Synced from trusted official capability JSON${entry.sourceType ? ` (${entry.sourceType})` : ""}.`,
          createdById: actor?.isGuest ? null : actor?.id || null
        }
      });
    }

    const updated = await tx.modelCapabilityProfile.update({
      where: { id: profile.id },
      data: {
        officialModelId: entry.officialModelId,
        aliases: entry.aliases,
        sourceUrls: entry.sourceUrls,
        verificationStatus: entry.verificationStatus,
        activeRevisionId: revision?.id || profile.activeRevisionId,
        lastCheckedAt: new Date()
      },
      include: { revisions: { orderBy: { revision: "desc" }, take: 5 } }
    });

    if (revision?.id) {
      const metadata = metadataFromCapabilityParams({
        officialModelId: updated.officialModelId,
        capability: updated.capability,
        params
      });
      await tx.customApiConfig.updateMany({
        where: { canonicalModelId: updated.canonicalModelId, capability: updated.capability },
        data: {
          activeCapabilityRevisionId: revision.id,
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {})
        }
      });
    }

    return { capability: serializeCapabilityProfile({ ...updated, activeRevision: revision || null }), changed, sourceHash };
  });
}

export async function syncOfficialCapabilityJson(input: { canonicalModelId?: string; actor?: RequestUser } = {}) {
  const entries = await loadOfficialCapabilityEntries();
  const filtered = input.canonicalModelId ? entries.filter((entry) => entry.canonicalModelId === input.canonicalModelId) : entries;
  if (input.canonicalModelId && filtered.length === 0) {
    throw new HttpError(404, "Official capability entry not found in static JSON.", "OFFICIAL_CAPABILITY_ENTRY_NOT_FOUND", { canonicalModelId: input.canonicalModelId });
  }
  const results = [];
  for (const entry of filtered) {
    results.push(await syncOfficialCapabilityEntry(entry, input.actor));
  }
  return results;
}

function uniqueMatches(text: string, regex: RegExp, limit = 40) {
  const values = new Set<string>();
  for (const match of text.matchAll(regex)) {
    const value = String(match[1] || match[0] || "").trim();
    if (value) values.add(value);
    if (values.size >= limit) break;
  }
  return Array.from(values);
}

function extractTitle(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return title.replace(/\s+/g, " ").trim().slice(0, 180);
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOpenAiGptImage2OfficialParams(input: { url: URL; text: string; canonicalModelId?: string }) {
  const host = input.url.hostname.toLowerCase();
  const pathname = input.url.pathname.toLowerCase();
  const canonical = String(input.canonicalModelId || "").toLowerCase();
  const lowerText = input.text.toLowerCase();
  const isOpenAiDocs = host === "developers.openai.com" || host === "platform.openai.com";
  const isImageDocs = pathname.includes("image-generation") || pathname.includes("/images/") || lowerText.includes("gpt-image-2");
  const wantsGptImage2 = !canonical || canonical === "openai:gpt-image-2" || canonical.endsWith(":gpt-image-2");
  if (!isOpenAiDocs || !isImageDocs || !wantsGptImage2 || !lowerText.includes("gpt-image-2")) return null;

  return {
    canonicalModelId: "openai:gpt-image-2",
    officialModelId: "gpt-image-2",
    source: "openaiDeveloperDocs MCP verified, runtime URL evidence",
    sourceUrls: OPENAI_IMAGE_DOC_URLS,
    modes: ["text_to_image", "image_to_image", "image_edit"],
    endpoints: {
      text_to_image: "/v1/images/generations",
      image_to_image: "/v1/images/edits",
      image_edit: "/v1/images/edits"
    },
    controls: {
      prompt: true,
      promptMaxChars: 32000,
      negativePrompt: false,
      size: {
        popular: ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840", "auto"],
        constraints: {
          minTotalPixels: 655360,
          maxTotalPixels: 8294400,
          maxEdge: 3840,
          multipleOf: 16,
          maxLongToShortRatio: 3
        }
      },
      quality: ["low", "medium", "high", "auto"],
      outputFormat: ["png", "jpeg", "webp"],
      outputCompression: { enabled: true, min: 0, max: 100, requiresOutputFormat: ["jpeg", "webp"] },
      background: ["auto", "opaque"],
      transparentBackground: false,
      moderation: ["auto", "low"],
      stream: true,
      partialImages: { enabled: true, min: 0, max: 3 },
      inputFidelity: false,
      responseFormat: false,
      style: false,
      seed: false,
      steps: false,
      cfgScale: false,
      strength: false
    },
    limits: {
      maxInputImages: 16,
      maxOutputImages: 10,
      currentExecutionMaxOutputImages: 1
    },
    maskRequirements: {
      sameFormatAndSize: true,
      alphaChannelRequired: true,
      maxBytes: 52428800
    }
  };
}

export async function probeOfficialUrl(input: { url: string; canonicalModelId?: string; capability?: unknown }) {
  const url = String(input.url || "").trim();
  if (!url) throw new HttpError(400, "url is required.", "OFFICIAL_PROBE_URL_REQUIRED");
  const parsed = await assertSafeOutboundUrl(url, "official documentation URL");
  const capability = input.capability ? normalizeCapability(input.capability) : undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await safeFetch(parsed.toString(), {
      label: "official documentation URL",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",
        "user-agent": "JIYING-ModelCapabilityProbe/1.0"
      }
    });
  } catch (error: any) {
    throw new HttpError(502, "Failed to fetch official documentation URL.", "OFFICIAL_PROBE_FETCH_FAILED", { message: error?.message });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new HttpError(502, "Official documentation URL returned an error.", "OFFICIAL_PROBE_FETCH_STATUS", { status: response.status });
  }
  const contentType = response.headers.get("content-type") || "";
  if (!/(text\/html|application\/json|text\/plain|application\/ld\+json)/i.test(contentType)) {
    throw new HttpError(400, "Official documentation URL must return text, HTML, or JSON.", "OFFICIAL_PROBE_UNSUPPORTED_CONTENT_TYPE", { contentType });
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_DOC_BYTES) {
    throw new HttpError(400, "Official documentation URL response is too large.", "OFFICIAL_PROBE_RESPONSE_TOO_LARGE", { maxBytes: MAX_DOC_BYTES });
  }
  const body = (await response.text()).slice(0, MAX_DOC_BYTES);
  const text = stripHtml(body);
  const canonicalNeedle = String(input.canonicalModelId || "").split(":").pop()?.toLowerCase() || "";
  const title = extractTitle(body);
  const modelHints = uniqueMatches(text, /\b((?:gpt|gemini|imagen|veo|seedance|kling|hailuo|runway|pika|wan|luma|sora)[a-z0-9_.:\- ]{0,42}[a-z0-9])\b/gi, 60);
  const sizeHints = uniqueMatches(text, /\b(\d{3,5}\s*x\s*\d{3,5}|auto)\b/gi, 50).map((item) => item.replace(/\s+/g, ""));
  const ratioHints = uniqueMatches(text, /\b(\d{1,2}:\d{1,2})\b/g, 30);
  const qualityHints = uniqueMatches(text, /\b(low|medium|high|standard|hd|auto)\b/gi, 30).map((item) => item.toLowerCase());
  const durationHints = capability === ModelCapability.VIDEO_GENERATOR
    ? uniqueMatches(text, /\b(\d{1,3})\s*(?:s|sec|second|seconds|秒)\b/gi, 30).map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0 && item <= 120)
    : [];
  const matchedCanonicalModel = Boolean(canonicalNeedle && text.toLowerCase().includes(canonicalNeedle));
  const structuredCandidate = extractOpenAiGptImage2OfficialParams({ url: parsed, text, canonicalModelId: input.canonicalModelId });

  return {
    url: parsed.toString(),
    host: parsed.hostname,
    title,
    contentType,
    bytesScanned: Buffer.byteLength(body),
    matchedCanonicalModel,
    candidate: {
      canonicalModelId: input.canonicalModelId || null,
      capability: capability || null,
      modelHints,
      sizeHints: Array.from(new Set(sizeHints)),
      ratioHints,
      qualityHints: Array.from(new Set(qualityHints)),
      durationHints: Array.from(new Set(durationHints))
    },
    structuredCandidate,
    verificationStatus: ModelCapabilityVerificationStatus.UNVERIFIED,
    executable: false,
    note: structuredCandidate
      ? "OpenAI official image documentation matched. Use official JSON sync to persist the MCP-verified capability template before execution."
      : "Custom URL probes are evidence only. Review the source and add a trusted JSON entry before marking a model executable."
  };
}
