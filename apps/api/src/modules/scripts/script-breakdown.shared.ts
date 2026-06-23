import { z } from "zod";

export const SCRIPT_BREAKDOWN_FIELDS = [
  { key: "orderIndex", title: "序号" },
  { key: "shotSize", title: "景别" },
  { key: "shot", title: "镜头" },
  { key: "cameraMovement", title: "运镜" },
  { key: "characters", title: "角色" },
  { key: "scene", title: "场景" },
  { key: "action", title: "动作" },
  { key: "props", title: "道具" },
  { key: "composition", title: "构图" },
  { key: "emotion", title: "情绪" },
  { key: "lighting", title: "光影" },
  { key: "soundEffect", title: "音效" },
  { key: "dialogueOrVoiceover", title: "对白/旁白" },
  { key: "vfx", title: "特效" },
  { key: "duration", title: "时长" },
  { key: "motionSpeed", title: "运动速度" },
  { key: "dynamic", title: "动态" },
  { key: "storyboardImagePrompt", title: "分镜图" },
  { key: "storyboardVideoPrompt", title: "分镜视频" }
] as const;

const cellSchema = z.string().max(4000).default("");

export const scriptBreakdownRowInputSchema = z.object({
  orderIndex: z.coerce.number().int().min(1).max(10000),
  shotSize: cellSchema,
  shot: cellSchema,
  cameraMovement: cellSchema,
  characters: cellSchema,
  scene: cellSchema,
  action: cellSchema,
  props: cellSchema,
  composition: cellSchema,
  emotion: cellSchema,
  lighting: cellSchema,
  soundEffect: cellSchema,
  dialogueOrVoiceover: cellSchema,
  vfx: cellSchema,
  duration: cellSchema,
  motionSpeed: cellSchema,
  dynamic: cellSchema,
  storyboardImagePrompt: cellSchema,
  storyboardVideoPrompt: cellSchema,
  sourceText: z.string().max(12000).default(""),
  confidence: z.coerce.number().min(0).max(1).default(0.7)
});

export const scriptBreakdownRowsSchema = z.array(scriptBreakdownRowInputSchema).min(1).max(300);

export const updateScriptRowSchema = scriptBreakdownRowInputSchema.omit({ orderIndex: true }).partial().extend({
  updatedAt: z.string().min(1),
  version: z.coerce.number().int().min(1)
});

export type ScriptBreakdownRowInput = z.infer<typeof scriptBreakdownRowInputSchema>;

export function buildStoryboardImagePrompt(row: Partial<ScriptBreakdownRowInput>) {
  const parts = [
    row.shotSize && `景别：${row.shotSize}`,
    row.shot && `镜头：${row.shot}`,
    row.characters && `角色：${row.characters}`,
    row.scene && `场景：${row.scene}`,
    row.action && `动作状态：${row.action}`,
    row.props && `道具：${row.props}`,
    row.composition && `构图：${row.composition}`,
    row.emotion && `情绪：${row.emotion}`,
    row.lighting && `光影：${row.lighting}`,
    row.vfx && `特效：${row.vfx}`
  ].filter(Boolean);
  return `生成单张关键视觉图。${parts.join("，")}。强调画面主体、角色状态、场景美术、构图层次、光影质感与情绪氛围，不描述时间流动和复杂镜头运动。`;
}

export function buildStoryboardVideoPrompt(row: Partial<ScriptBreakdownRowInput>) {
  const parts = [
    row.shotSize && `景别：${row.shotSize}`,
    row.shot && `镜头：${row.shot}`,
    row.cameraMovement && `运镜：${row.cameraMovement}`,
    row.characters && `角色：${row.characters}`,
    row.scene && `场景：${row.scene}`,
    row.action && `动作：${row.action}`,
    row.props && `道具：${row.props}`,
    row.composition && `构图：${row.composition}`,
    row.emotion && `情绪：${row.emotion}`,
    row.lighting && `光影：${row.lighting}`,
    row.soundEffect && `音效：${row.soundEffect}`,
    row.dialogueOrVoiceover && `对白/旁白：${row.dialogueOrVoiceover}`,
    row.vfx && `特效：${row.vfx}`,
    row.duration && `时长：${row.duration}`,
    row.motionSpeed && `运动速度：${row.motionSpeed}`,
    row.dynamic && `动态：${row.dynamic}`
  ].filter(Boolean);
  return `生成一段动态镜头。${parts.join("，")}。强调镜头运动、角色动作、环境变化、声音节奏、时长、运动速度和动态过程，适合生视频节点使用。`;
}

export function normalizeScriptRows(rows: ScriptBreakdownRowInput[]) {
  return rows
    .map((row, index) => {
      const normalized = scriptBreakdownRowInputSchema.parse({ ...row, orderIndex: row.orderIndex || index + 1 });
      return {
        ...normalized,
        storyboardImagePrompt: normalized.storyboardImagePrompt || buildStoryboardImagePrompt(normalized),
        storyboardVideoPrompt: normalized.storyboardVideoPrompt || buildStoryboardVideoPrompt(normalized)
      };
    })
    .sort((a, b) => a.orderIndex - b.orderIndex);
}
