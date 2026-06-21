import { z } from "zod";

export const EDITING_TIMELINE_VERSION = 1;
export const EDITING_MAX_TRACKS = 8;
export const EDITING_MAX_CLIPS = 300;
export const EDITING_MAX_TIMELINE_BYTES = 256 * 1024;
export const EDITING_MAX_TEXT_LENGTH = 500;

export const editingTrackTypeSchema = z.enum(["VIDEO", "AUDIO", "TEXT"]);
export const editingClipKindSchema = z.enum(["VIDEO", "IMAGE", "AUDIO", "TEXT"]);

export const editingClipSchema = z.object({
  id: z.string().trim().min(1).max(80),
  assetId: z.string().trim().min(1).max(120).optional(),
  kind: editingClipKindSchema,
  name: z.string().trim().max(160).optional(),
  text: z.string().trim().max(EDITING_MAX_TEXT_LENGTH).optional(),
  startMs: z.number().int().min(0),
  durationMs: z.number().int().min(1).max(24 * 60 * 60 * 1000),
  sourceInMs: z.number().int().min(0).default(0),
  sourceOutMs: z.number().int().min(0).optional(),
  volume: z.number().min(0).max(1).default(1),
  muted: z.boolean().default(false),
  fadeInMs: z.number().int().min(0).default(0),
  fadeOutMs: z.number().int().min(0).default(0)
}).superRefine((clip, ctx) => {
  if (clip.kind !== "TEXT" && !clip.assetId) {
    ctx.addIssue({ code: "custom", message: "Media clip assetId is required.", path: ["assetId"] });
  }
  if (clip.kind === "TEXT" && !clip.text) {
    ctx.addIssue({ code: "custom", message: "Text clip content is required.", path: ["text"] });
  }
  const sourceOutMs = clip.sourceOutMs ?? clip.sourceInMs + clip.durationMs;
  if (sourceOutMs <= clip.sourceInMs) {
    ctx.addIssue({ code: "custom", message: "sourceOutMs must be greater than sourceInMs.", path: ["sourceOutMs"] });
  }
  if (clip.kind !== "IMAGE" && clip.kind !== "TEXT" && clip.durationMs > sourceOutMs - clip.sourceInMs) {
    ctx.addIssue({ code: "custom", message: "durationMs cannot exceed source range.", path: ["durationMs"] });
  }
  if (clip.fadeInMs > Math.floor(clip.durationMs / 2) || clip.fadeOutMs > Math.floor(clip.durationMs / 2)) {
    ctx.addIssue({ code: "custom", message: "Fade duration cannot exceed half of clip duration.", path: ["fadeInMs"] });
  }
});

export const editingTrackSchema = z.object({
  id: z.string().trim().min(1).max(40),
  type: editingTrackTypeSchema,
  name: z.string().trim().min(1).max(80),
  clips: z.array(editingClipSchema).max(EDITING_MAX_CLIPS)
});

const importedEditingAssetSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  type: z.enum(["VIDEO", "IMAGE", "AUDIO"]),
  kind: z.enum(["VIDEO", "IMAGE", "AUDIO"]),
  mimeType: z.string().trim().max(120).nullable().optional(),
  sizeBytes: z.number().int().min(0).nullable().optional(),
  url: z.string().trim().min(1).max(500),
  createdAt: z.string().trim().max(80)
});

export const editingTimelineSchema = z.object({
  version: z.literal(EDITING_TIMELINE_VERSION),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  settings: z.object({
    fps: z.number().int().min(1).max(120).default(30),
    width: z.number().int().min(320).max(8192).default(1920),
    height: z.number().int().min(240).max(8192).default(1080),
    aspectRatio: z.string().trim().max(20).default("16:9")
  }),
  tracks: z.array(editingTrackSchema).min(1).max(EDITING_MAX_TRACKS),
  metadata: z.object({
    importedAssets: z.array(importedEditingAssetSchema).max(100).optional()
  }).optional()
}).superRefine((timeline, ctx) => {
  const clipCount = timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  if (clipCount > EDITING_MAX_CLIPS) {
    ctx.addIssue({ code: "custom", message: `Timeline clip count cannot exceed ${EDITING_MAX_CLIPS}.`, path: ["tracks"] });
  }
  timeline.tracks.forEach((track, trackIndex) => {
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    sorted.forEach((clip, clipIndex) => {
      if (track.type === "VIDEO" && !(clip.kind === "VIDEO" || clip.kind === "IMAGE")) {
        ctx.addIssue({ code: "custom", message: "V1 only accepts video or image clips.", path: ["tracks", trackIndex, "clips", clipIndex, "kind"] });
      }
      if (track.type === "AUDIO" && clip.kind !== "AUDIO") {
        ctx.addIssue({ code: "custom", message: "A1 only accepts audio clips.", path: ["tracks", trackIndex, "clips", clipIndex, "kind"] });
      }
      if (track.type === "TEXT" && clip.kind !== "TEXT") {
        ctx.addIssue({ code: "custom", message: "Text track only accepts text clips.", path: ["tracks", trackIndex, "clips", clipIndex, "kind"] });
      }
      const previous = sorted[clipIndex - 1];
      if (previous && previous.startMs + previous.durationMs > clip.startMs) {
        ctx.addIssue({ code: "custom", message: "Clips cannot overlap on the same track.", path: ["tracks", trackIndex, "clips"] });
      }
    });
  });
});

export type EditingTimeline = z.infer<typeof editingTimelineSchema>;

export function defaultEditingTimeline(): EditingTimeline {
  return {
    version: EDITING_TIMELINE_VERSION,
    durationMs: 0,
    settings: { fps: 30, width: 1920, height: 1080, aspectRatio: "16:9" },
    tracks: [
      { id: "v1", type: "VIDEO", name: "V1 主视频", clips: [] },
      { id: "a1", type: "AUDIO", name: "A1 音频", clips: [] },
      { id: "t1", type: "TEXT", name: "T1 字幕", clips: [] }
    ]
  };
}

export function parseEditingTimeline(value: unknown): EditingTimeline {
  const size = Buffer.byteLength(JSON.stringify(value || {}), "utf8");
  if (size > EDITING_MAX_TIMELINE_BYTES) throw new Error("Timeline payload is too large.");
  return editingTimelineSchema.parse(value);
}
