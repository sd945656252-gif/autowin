import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { EventEmitter } from "events";
import { promisify } from "util";
import ffmpeg from "fluent-ffmpeg";
import type { ShowcaseWork, ShowcaseWorkStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { assertSafeOutboundUrl } from "../../security/outbound-url";
import { safeAxiosGet } from "../../security/safe-outbound";
import { getUploadFilePath, getUploadsDir } from "../../shared/storage-paths";

const execFileAsync = promisify(execFile);
const showcaseEvents = new EventEmitter();
showcaseEvents.setMaxListeners(100);

export type ShowcaseRegistryChangeEvent = {
  sequence: number;
  reason: "upload" | "metadata" | "remove" | "init";
  key?: string;
  changedAt: string;
};

let showcaseEventSequence = 0;
let latestShowcaseEvent: ShowcaseRegistryChangeEvent = {
  sequence: showcaseEventSequence,
  reason: "init",
  changedAt: new Date().toISOString()
};

export function getLatestShowcaseEvent() {
  return latestShowcaseEvent;
}

export function onShowcaseRegistryChanged(listener: (event: ShowcaseRegistryChangeEvent) => void) {
  showcaseEvents.on("changed", listener);
  return () => showcaseEvents.off("changed", listener);
}

export function publishShowcaseRegistryChanged(reason: ShowcaseRegistryChangeEvent["reason"], key?: string) {
  showcaseEventSequence += 1;
  latestShowcaseEvent = {
    sequence: showcaseEventSequence,
    reason,
    key,
    changedAt: new Date().toISOString()
  };
  showcaseEvents.emit("changed", latestShowcaseEvent);
}

export type ShowcaseTranscodeStatus = "ORIGINAL_UPLOADED" | "TRANSCODED" | "TRANSCODE_FAILED";

export type ShowcaseTranscodeResult = {
  path: string;
  mimeType: string;
  status: ShowcaseTranscodeStatus;
  enabled: boolean;
  ffmpegAvailable: boolean;
  reason: string;
  error?: string;
};

let ffmpegAvailabilityCache: Promise<{ ffmpeg: boolean; ffprobe: boolean; available: boolean; error?: string }> | null = null;

export function isShowcaseTranscodeEnabled() {
  return process.env.SHOWCASE_TRANSCODE_ENABLED === "true";
}

async function commandAvailable(command: string) {
  try {
    await execFileAsync(command, ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function checkShowcaseFfmpegAvailability() {
  if (!ffmpegAvailabilityCache) {
    ffmpegAvailabilityCache = (async () => {
      const [hasFfmpeg, hasFfprobe] = await Promise.all([
        commandAvailable("ffmpeg"),
        commandAvailable("ffprobe")
      ]);
      const available = hasFfmpeg && hasFfprobe;
      return {
        ffmpeg: hasFfmpeg,
        ffprobe: hasFfprobe,
        available,
        ...(available ? {} : { error: "ffmpeg and ffprobe must both be available for showcase transcoding." })
      };
    })();
  }
  return ffmpegAvailabilityCache;
}

export async function logShowcaseTranscodeReadiness() {
  if (!isShowcaseTranscodeEnabled()) {
    console.log("[VideoProcess] Showcase transcoding is disabled. Uploads will keep original files.");
    return;
  }
  const availability = await checkShowcaseFfmpegAvailability();
  if (!availability.available) {
    console.error("[VideoProcess] SHOWCASE_TRANSCODE_ENABLED=true but ffmpeg/ffprobe is unavailable. Uploads will fall back to original files.", availability);
    return;
  }
  console.log("[VideoProcess] Showcase transcoding is enabled and ffmpeg/ffprobe is available.");
}

export interface VideoRegistry {
  videos: Record<string, string | null>;
  metadata: Record<string, { title: string; category: string }>;
  works?: Array<{
    id: string;
    key: string;
    title: string;
    category: string;
    playbackUrl: string | null;
    coverUrl: string | null;
    sortOrder: number;
    status: ShowcaseWorkStatus;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export const PRESET_VIDEOS: Record<string, string | null> = {
  mv: null,
  sword: null,
  santi: null,
  "extra-1": null,
  "extra-2": null,
  "extra-3": null,
  "extra-4": null,
  "extra-5": null,
  "extra-6": null
};

export const PRESET_METADATA: Record<string, { title: string; category: string }> = {
  mv: { title: "Life MV", category: "Music Video" },
  sword: { title: "Snow Sword", category: "Game Concept" },
  santi: { title: "Three Body", category: "Sci-Fi Short" },
  "extra-1": { title: "Future Realm", category: "Sci-Fi Concept" },
  "extra-2": { title: "Cyber Era", category: "Urban Punk" },
  "extra-3": { title: "Martial Rise", category: "Action Capture" },
  "extra-4": { title: "Ancient Ruins", category: "Realistic Heritage" },
  "extra-5": { title: "Machine Revolution", category: "Heavy Industry" },
  "extra-6": { title: "Micro Light Planet", category: "Volumetric Light" }
};

export function sortOrderForShowcaseKey(key: string) {
  if (key === "mv") return 10;
  if (key === "sword") return 20;
  if (key === "santi") return 30;
  if (key.startsWith("extra-")) {
    const index = Number.parseInt(key.split("-")[1] || "0", 10) || 0;
    return 100 + index;
  }
  return 1000;
}

export function showcasePlaybackUrl(key: string, version?: Date | string | number | null) {
  const queryVersion = version instanceof Date ? version.getTime() : version;
  const suffix = queryVersion ? `?v=${encodeURIComponent(String(queryVersion))}` : "";
  return `/api/videos/${encodeURIComponent(key)}/stream${suffix}`;
}

export function storageKeyFromLegacyVideoUrl(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("/uploads/")) return decodeURIComponent(value.slice("/uploads/".length).split("?")[0]);
  const uploadsMarker = "/uploads/";
  const index = value.indexOf(uploadsMarker);
  if (index >= 0) return decodeURIComponent(value.slice(index + uploadsMarker.length).split("?")[0]);
  return null;
}

type ShowcaseVideoReference = Pick<ShowcaseWork, "storageKey" | "fileKey" | "videoUrl">;

export function storageKeyFromShowcaseWork(item: ShowcaseVideoReference) {
  return item.storageKey || item.fileKey || storageKeyFromLegacyVideoUrl(item.videoUrl);
}

function resolveShowcaseUploadPath(storageKey: string) {
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(uploadsDir, storageKey);
  const relative = path.relative(uploadsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

export function showcaseVideoFileExists(item: ShowcaseVideoReference) {
  const storageKey = storageKeyFromShowcaseWork(item);
  if (!storageKey) return false;
  const filePath = resolveShowcaseUploadPath(storageKey);
  return Boolean(filePath && fs.existsSync(filePath));
}

function registryVideoUrlIfAvailable(value?: string | null) {
  if (!value) return null;
  const storageKey = storageKeyFromLegacyVideoUrl(value);
  if (!storageKey) return value;
  const filePath = resolveShowcaseUploadPath(storageKey);
  return filePath && fs.existsSync(filePath) ? value : null;
}

function getRegistryPath() {
  return getUploadFilePath("registry.json");
}

export function readRegistry(): VideoRegistry {
  try {
    const uploadsDir = getUploadsDir();
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const registryPath = getRegistryPath();
    if (fs.existsSync(registryPath)) {
      const parsed = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      const parsedVideos = Object.fromEntries(
        Object.entries(parsed.videos || {}).map(([key, value]) => [key, registryVideoUrlIfAvailable(String(value || ""))])
      );
      return {
        videos: { ...PRESET_VIDEOS, ...parsedVideos },
        metadata: { ...PRESET_METADATA, ...parsed.metadata }
      };
    }
  } catch (error) {
    console.error("Registry read error:", error);
  }
  return { videos: { ...PRESET_VIDEOS }, metadata: { ...PRESET_METADATA } };
}

export async function readRegistryFromDatabase(): Promise<VideoRegistry> {
  const registry = readRegistry();
  try {
    const works = await prisma.showcaseWork.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    for (const item of works) {
      const hasStoredVideo = showcaseVideoFileExists(item);
      registry.videos[item.key] = hasStoredVideo ? showcasePlaybackUrl(item.key, item.updatedAt) : null;
      registry.metadata[item.key] = {
        title: item.title,
        category: item.category
      };
    }
    registry.works = works.map((item) => ({
      id: item.id,
      key: item.key,
      title: item.title,
      category: item.category,
      playbackUrl: registry.videos[item.key] || null,
      coverUrl: item.coverUrl,
      sortOrder: item.sortOrder,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));
  } catch (error) {
    console.warn("[VideoRegistry] ShowcaseWork read failed, using legacy registry fallback:", error);
    try {
      const items = await prisma.videoRegistryItem.findMany();
      for (const item of items) {
        registry.videos[item.key] = registryVideoUrlIfAvailable(item.url);
        registry.metadata[item.key] = {
          title: item.title,
          category: item.category
        };
      }
    } catch (legacyError) {
      console.warn("[VideoRegistry] PostgreSQL legacy registry read failed, using local file fallback:", legacyError);
    }
  }
  return registry;
}

export async function upsertVideoRegistryItem(
  key: string,
  url: string | null,
  metadata?: { title?: string; category?: string; coverUrl?: string | null; sortOrder?: number; status?: ShowcaseWorkStatus; createdById?: string | null; fileKey?: string | null; storageKey?: string | null; extraMetadata?: Record<string, any> }
) {
  const fallbackMeta = PRESET_METADATA[key] || { title: "Untitled Motion Asset", category: "JiYing Concept" };
  const nextMeta = {
    title: metadata?.title ?? fallbackMeta.title,
    category: metadata?.category ?? fallbackMeta.category
  };

  await prisma.showcaseWork.upsert({
    where: { key },
    create: {
      key,
      title: nextMeta.title,
      category: nextMeta.category,
      videoUrl: url,
      coverUrl: metadata?.coverUrl ?? null,
      fileKey: metadata?.fileKey ?? null,
      storageKey: metadata?.storageKey ?? null,
      sortOrder: metadata?.sortOrder ?? sortOrderForShowcaseKey(key),
      status: metadata?.status ?? (url ? "PUBLISHED" : "DRAFT"),
      createdById: metadata?.createdById ?? null,
      metadata: metadata?.extraMetadata || {}
    },
    update: {
      title: nextMeta.title,
      category: nextMeta.category,
      videoUrl: url,
      ...(metadata?.coverUrl !== undefined ? { coverUrl: metadata.coverUrl } : {}),
      ...(metadata?.fileKey !== undefined ? { fileKey: metadata.fileKey } : {}),
      ...(metadata?.storageKey !== undefined ? { storageKey: metadata.storageKey } : {}),
      ...(metadata?.sortOrder !== undefined ? { sortOrder: metadata.sortOrder } : {}),
      ...(metadata?.status !== undefined ? { status: metadata.status } : {}),
      ...(metadata?.createdById !== undefined ? { createdById: metadata.createdById } : {}),
      ...(metadata?.extraMetadata !== undefined ? { metadata: metadata.extraMetadata } : {})
    }
  });

  await prisma.videoRegistryItem.upsert({
    where: { key },
    create: {
      key,
      url,
      title: nextMeta.title,
      category: nextMeta.category
    },
    update: {
      url,
      title: nextMeta.title,
      category: nextMeta.category
    }
  });
}

export function getPresetVideoUrl(key: string) {
  return PRESET_VIDEOS[key] || PRESET_VIDEOS.mv;
}

export async function processVideoAsset(inputPath: string, inputMimeType = "video/mp4"): Promise<ShowcaseTranscodeResult> {
  if (!isShowcaseTranscodeEnabled()) {
    return {
      path: inputPath,
      mimeType: inputMimeType,
      status: "ORIGINAL_UPLOADED",
      enabled: false,
      ffmpegAvailable: false,
      reason: "transcode_disabled"
    };
  }

  const availability = await checkShowcaseFfmpegAvailability();
  if (!availability.available) {
    console.error("[VideoProcess] Transcode requested but ffmpeg/ffprobe is unavailable. Keeping original upload.", availability);
    return {
      path: inputPath,
      mimeType: inputMimeType,
      status: "TRANSCODE_FAILED",
      enabled: true,
      ffmpegAvailable: false,
      reason: "ffmpeg_unavailable",
      error: availability.error
    };
  }

  const stats = fs.statSync(inputPath);
  const sizeInMb = stats.size / (1024 * 1024);
  const maxSizeMb = 150;
  const ext = path.extname(inputPath).toLowerCase();

  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, async (err, metadata) => {
      if (err) {
        const message = err.message || String(err);
        console.warn("[VideoProcess] ffprobe failed. Keeping original upload:", message);
        return resolve({
          path: inputPath,
          mimeType: inputMimeType,
          status: "TRANSCODE_FAILED",
          enabled: true,
          ffmpegAvailable: true,
          reason: "ffprobe_failed",
          error: message
        });
      }

      const videoStream = metadata.streams.find(s => s.codec_type === "video");
      const isH264 = videoStream?.codec_name === "h264";
      const isMP4OrWebM = [".mp4", ".webm"].includes(ext);
      const isOversized = sizeInMb > maxSizeMb;
      const needsProcessing = isOversized || !isH264 || !isMP4OrWebM;

      if (!needsProcessing) {
        console.log(`[VideoProcess] Asset (${sizeInMb.toFixed(2)}MB, ${videoStream?.codec_name}) is already web-optimized. Skipping.`);
        return resolve({
          path: inputPath,
          mimeType: inputMimeType,
          status: "ORIGINAL_UPLOADED",
          enabled: true,
          ffmpegAvailable: true,
          reason: "already_web_optimized"
        });
      }

      console.log(`[VideoProcess] Starting pipeline: size=${sizeInMb.toFixed(2)}MB, codec=${videoStream?.codec_name}, ext=${ext}.`);
      try {
        const result = await runTranscode(inputPath, isOversized);
        resolve({
          path: result,
          mimeType: "video/mp4",
          status: "TRANSCODED",
          enabled: true,
          ffmpegAvailable: true,
          reason: "transcoded"
        });
      } catch (error: any) {
        const message = error?.message || String(error);
        console.warn("[VideoProcess] Transcode failed. Keeping original upload:", message);
        resolve({
          path: inputPath,
          mimeType: inputMimeType,
          status: "TRANSCODE_FAILED",
          enabled: true,
          ffmpegAvailable: true,
          reason: "transcode_failed",
          error: message
        });
      }
    });
  });
}

async function runTranscode(inputPath: string, highCompression: boolean): Promise<string> {
  const ext = path.extname(inputPath);
  const outputPath = inputPath.slice(0, -ext.length) + "-processed.mp4";
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        highCompression ? "-crf 28" : "-crf 23",
        "-preset fast",
        "-profile:v high",
        "-level 4.0",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-b:a 128k",
        "-movflags +faststart",
        "-vf scale=trunc(iw/2)*2:trunc(ih/2)*2"
      ])
      .on("start", () => console.log("[VideoProcess] Ffmpeg transcode started."))
      .on("end", () => {
        console.log("[VideoProcess] Transcode complete.");
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        } catch (error) {
          console.warn("[VideoProcess] Cleanup failed:", error);
        }
        resolve(outputPath);
      })
      .on("error", (err) => {
        console.error(`[VideoProcess] Pipeline failed: ${err.message}`);
        reject(err);
      })
      .save(outputPath);
  });
}

export async function cachePresetVideosLocally() {
  const uploadsDir = getUploadsDir();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  for (const [key, url] of Object.entries(PRESET_VIDEOS)) {
    if (!url) continue;
    const cacheFilename = `preset-${key}.mp4`;
    const local = path.join(uploadsDir, cacheFilename);

    if (fs.existsSync(local)) {
      PRESET_VIDEOS[key] = `/uploads/${cacheFilename}`;
      continue;
    }

    assertSafeOutboundUrl(url, "preset video URL").then(() => safeAxiosGet(url, {
      label: "preset video URL",
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 150 * 1024 * 1024,
      maxBodyLength: 150 * 1024 * 1024,
      validateStatus: null
    })).then(async (response) => {
      if (response.status < 200 || response.status >= 300) return;
      const contentType = String(response.headers["content-type"] || "").toLowerCase();
      if (!contentType.startsWith("video/")) return;
      fs.writeFileSync(local, Buffer.from(response.data));
      PRESET_VIDEOS[key] = `/uploads/${cacheFilename}`;
      await upsertVideoRegistryItem(key, `/uploads/${cacheFilename}`, PRESET_METADATA[key]);
    }).catch((error) => {
      console.warn(`[VideoRegistry] Preset video cache skipped for ${key}:`, error?.message || error);
    });
  }
}
