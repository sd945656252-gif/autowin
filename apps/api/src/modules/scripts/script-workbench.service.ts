import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import {
  AuditAction,
  MediaAssetType,
  MediaVisibility,
  ScriptProcessingJobStatus,
  ScriptProcessingJobType,
  ScriptProjectSourceType,
  ScriptProjectStatus,
  ScriptProjectVersionType,
  UserRole
} from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../shared/http";
import { getUploadsDir } from "../../shared/storage-paths";
import type { RequestUser } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import { canReadMediaAsset, protectedMediaUrl, recordLocalMediaAsset, resolveLocalUploadPath } from "../media/media.service";
import { generateScriptBreakdownRows } from "./script-ai.service";
import { buildStoryboardImagePrompt, buildStoryboardVideoPrompt, SCRIPT_BREAKDOWN_FIELDS, updateScriptRowSchema, type ScriptBreakdownRowInput } from "./script-breakdown.shared";
import { parseScriptFile } from "./script-file-parser";

export function canAccessScriptProject(user: RequestUser, project: { ownerId: string }) {
  if (user.isGuest) return false;
  if (user.role === UserRole.ADMIN) return true;
  return project.ownerId === user.id;
}

export async function assertScriptProjectAccess(projectId: string, user: RequestUser) {
  const project = await prisma.scriptProject.findUnique({ where: { id: projectId } });
  if (!project || !canAccessScriptProject(user, project)) throw new HttpError(404, "剧本项目不存在或无权访问。", "SCRIPT_PROJECT_NOT_FOUND");
  return project;
}

export function serializeScriptProject(project: any) {
  return {
    ...project,
    createdAt: project.createdAt?.toISOString?.() || project.createdAt,
    updatedAt: project.updatedAt?.toISOString?.() || project.updatedAt,
    rows: project.rows?.map(serializeScriptRow) || undefined,
    versions: project.versions?.map((version: any) => ({
      id: version.id,
      projectId: version.projectId,
      version: version.version,
      type: version.type,
      summary: version.summary,
      rowCount: version.rowCount,
      createdById: version.createdById,
      createdAt: version.createdAt?.toISOString?.() || version.createdAt
    }))
  };
}

export function serializeScriptRow(row: any) {
  return {
    ...row,
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt
  };
}

export function serializeScriptJob(job: any) {
  return {
    ...job,
    createdAt: job.createdAt?.toISOString?.() || job.createdAt,
    updatedAt: job.updatedAt?.toISOString?.() || job.updatedAt,
    startedAt: job.startedAt?.toISOString?.() || job.startedAt,
    finishedAt: job.finishedAt?.toISOString?.() || job.finishedAt
  };
}

function safeTitle(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "未命名项目";
}

function makeExcelFileName(projectTitle: string) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `剧本分镜表-${safeTitle(projectTitle)}-${stamp}.xlsx`;
}

function productionProjectIdOf(project: { metadata?: any }) {
  const metadata = project.metadata && typeof project.metadata === "object" ? project.metadata : {};
  const id = typeof metadata.productionProjectId === "string" ? metadata.productionProjectId.trim() : "";
  return id || null;
}

function summarizeScriptRows(rows: Array<Record<string, any>>) {
  return rows.map((row) => [
    `# ${row.orderIndex}. ${row.shot || row.sourceText || "未命名镜头"}`,
    `景别：${row.shotSize || "-"}`,
    `运镜：${row.cameraMovement || "-"}`,
    `角色：${row.characters || "-"}`,
    `场景：${row.scene || "-"}`,
    `动作：${row.action || "-"}`,
    `对白/旁白：${row.dialogueOrVoiceover || "-"}`,
    `分镜图提示词：${row.storyboardImagePrompt || "-"}`,
    `分镜视频提示词：${row.storyboardVideoPrompt || "-"}`
  ].join("\n")).join("\n\n");
}

function scriptModelLabel(value: any) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    return String(value.alias || value.modelName || value.configId || "script-workbench");
  }
  return "script-workbench";
}

async function recordScriptHistory(input: {
  ownerId: string;
  project: { id: string; title: string; currentVersion?: number | null; metadata?: any };
  inputText: string;
  output: string;
  source: string;
  model?: string | null;
  rowCount?: number;
  outputType?: string;
  metadata?: Record<string, any>;
}) {
  const output = String(input.output || "").trim();
  if (!output) return;
  await prisma.promptHistoryItem.create({
    data: {
      ownerId: input.ownerId,
      featureMode: "script",
      input: String(input.inputText || input.project.title || "剧本工作台").slice(0, 80_000),
      output: output.slice(0, 80_000),
      model: String(input.model || "script-workbench").slice(0, 120),
      mode: "script-workbench",
      promptCount: Number.isFinite(Number(input.rowCount)) ? Number(input.rowCount) : undefined,
      metadata: {
        projectId: productionProjectIdOf(input.project),
        projectTitle: input.project.title,
        scriptProjectId: input.project.id,
        scriptProjectVersion: input.project.currentVersion || null,
        outputType: input.outputType || "script",
        source: input.source,
        ...(input.metadata || {})
      }
    }
  });

  const oldItems = await prisma.promptHistoryItem.findMany({
    where: { ownerId: input.ownerId },
    orderBy: { createdAt: "desc" },
    skip: 100,
    select: { id: true }
  });
  if (oldItems.length > 0) {
    await prisma.promptHistoryItem.deleteMany({ where: { id: { in: oldItems.map((item) => item.id) } } });
  }
}

async function createProjectVersion(input: {
  projectId: string;
  type: ScriptProjectVersionType;
  summary: string;
  createdById?: string | null;
}) {
  const [project, rows, latest] = await Promise.all([
    prisma.scriptProject.findUnique({ where: { id: input.projectId } }),
    prisma.scriptBreakdownRow.findMany({ where: { projectId: input.projectId }, orderBy: { orderIndex: "asc" } }),
    prisma.scriptProjectVersion.findFirst({ where: { projectId: input.projectId }, orderBy: { version: "desc" } })
  ]);
  if (!project) throw new HttpError(404, "剧本项目不存在。", "SCRIPT_PROJECT_NOT_FOUND");
  const version = (latest?.version || 0) + 1;
  const snapshotJson = {
    project: { id: project.id, title: project.title, status: project.status, currentVersion: project.currentVersion },
    rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }))
  };
  await prisma.$transaction([
    prisma.scriptProjectVersion.create({
      data: {
        projectId: input.projectId,
        version,
        type: input.type,
        summary: input.summary,
        rowCount: rows.length,
        snapshotJson,
        createdById: input.createdById || null
      }
    }),
    prisma.scriptProject.update({ where: { id: input.projectId }, data: { currentVersion: version } })
  ]);
}

async function updateJob(jobId: string, data: Partial<{ status: ScriptProcessingJobStatus; progress: number; message: string | null; errorMessage: string | null; resultJson: any; startedAt: Date; finishedAt: Date }>) {
  return prisma.scriptProcessingJob.update({ where: { id: jobId }, data });
}

async function saveBreakdownRows(projectId: string, rows: ScriptBreakdownRowInput[]) {
  await prisma.$transaction(async (tx) => {
    await tx.scriptBreakdownRow.deleteMany({ where: { projectId } });
    for (const row of rows) {
      await tx.scriptBreakdownRow.create({
        data: {
          projectId,
          orderIndex: row.orderIndex,
          shotSize: row.shotSize,
          shot: row.shot,
          cameraMovement: row.cameraMovement,
          characters: row.characters,
          scene: row.scene,
          action: row.action,
          props: row.props,
          composition: row.composition,
          emotion: row.emotion,
          lighting: row.lighting,
          soundEffect: row.soundEffect,
          dialogueOrVoiceover: row.dialogueOrVoiceover,
          vfx: row.vfx,
          duration: row.duration,
          motionSpeed: row.motionSpeed,
          dynamic: row.dynamic,
          storyboardImagePrompt: row.storyboardImagePrompt,
          storyboardVideoPrompt: row.storyboardVideoPrompt,
          sourceText: row.sourceText,
          confidence: row.confidence,
          version: 1
        }
      });
    }
    await tx.scriptProject.update({ where: { id: projectId }, data: { status: ScriptProjectStatus.READY, errorMessage: null } });
  });
}

function scriptRequestUser(ownerId: string): RequestUser {
  return { id: ownerId, role: UserRole.USER, isGuest: false };
}

async function processFileBreakdown(job: any) {
  const project = await prisma.scriptProject.findUnique({ where: { id: job.projectId || "" }, include: { sourceFile: true } });
  if (!project?.sourceFile?.storageKey) throw new HttpError(404, "上传文件记录不存在。", "SCRIPT_SOURCE_FILE_NOT_FOUND");
  const filePath = resolveLocalUploadPath(project.sourceFile.storageKey);
  if (!fs.existsSync(filePath)) throw new HttpError(404, "上传文件不存在或已被清理。", "SCRIPT_SOURCE_FILE_MISSING");

  await updateJob(job.id, { status: ScriptProcessingJobStatus.PARSING, progress: 15, message: "正在解析剧本文本", startedAt: new Date() });
  const text = await parseScriptFile(filePath, project.sourceFile.originalName || project.sourceFile.storageKey);
  await createProjectVersion({ projectId: project.id, type: ScriptProjectVersionType.SOURCE, summary: "原始上传文本已解析", createdById: project.ownerId });

  await updateJob(job.id, { status: ScriptProcessingJobStatus.GENERATING, progress: 35, message: "正在按模型中心文字生成模型顺序拆解" });
  const breakdown = await generateScriptBreakdownRows({ text, mode: "file", ownerId: project.ownerId });
  const rows = breakdown.rows;

  await updateJob(job.id, { status: ScriptProcessingJobStatus.SAVING, progress: 80, message: "正在保存分镜表" });
  await saveBreakdownRows(project.id, rows);
  await createProjectVersion({ projectId: project.id, type: ScriptProjectVersionType.AI_GENERATED, summary: "AI 初始生成分镜表", createdById: project.ownerId });

  await updateJob(job.id, { status: ScriptProcessingJobStatus.SUCCEEDED, progress: 100, message: "拆解完成", resultJson: { rowCount: rows.length, textModel: breakdown.model }, finishedAt: new Date() });
  await recordScriptHistory({
    ownerId: project.ownerId,
    project,
    inputText: project.sourceFile.originalName || project.title || "上传剧本",
    output: summarizeScriptRows(rows),
    source: "script_file_breakdown",
    model: scriptModelLabel(breakdown.model),
    rowCount: rows.length,
    metadata: {
      sourceJobId: job.id,
      sourceJobType: job.type,
      sourceFileId: project.sourceFileId || null
    }
  });
  await writeAuditLog({ actor: scriptRequestUser(project.ownerId), action: AuditAction.EXECUTE, entityType: "ScriptProject", entityId: project.id, metadata: { operation: "file_breakdown", status: "SUCCEEDED", rowCount: rows.length, textModel: breakdown.model, failedModelAttempts: breakdown.attempts.length } });
}

async function processIdeaBreakdown(job: any) {
  const project = await prisma.scriptProject.findUnique({ where: { id: job.projectId || "" } });
  if (!project?.originalIdea) throw new HttpError(404, "创意内容不存在。", "SCRIPT_IDEA_NOT_FOUND");
  await updateJob(job.id, { status: ScriptProcessingJobStatus.GENERATING, progress: 25, message: "正在按模型中心文字生成模型顺序扩写并拆解", startedAt: new Date() });
  const breakdown = await generateScriptBreakdownRows({ text: project.originalIdea, mode: "idea", ownerId: project.ownerId });
  const rows = breakdown.rows;
  await updateJob(job.id, { status: ScriptProcessingJobStatus.SAVING, progress: 82, message: "正在保存分镜表" });
  await saveBreakdownRows(project.id, rows);
  await createProjectVersion({ projectId: project.id, type: ScriptProjectVersionType.SOURCE, summary: "原始创意已保存", createdById: project.ownerId });
  await createProjectVersion({ projectId: project.id, type: ScriptProjectVersionType.AI_GENERATED, summary: "AI 扩写并生成分镜表", createdById: project.ownerId });
  await updateJob(job.id, { status: ScriptProcessingJobStatus.SUCCEEDED, progress: 100, message: "扩写拆解完成", resultJson: { rowCount: rows.length, textModel: breakdown.model }, finishedAt: new Date() });
  await recordScriptHistory({
    ownerId: project.ownerId,
    project,
    inputText: project.originalIdea,
    output: summarizeScriptRows(rows),
    source: "script_idea_breakdown",
    model: scriptModelLabel(breakdown.model),
    rowCount: rows.length,
    metadata: {
      sourceJobId: job.id,
      sourceJobType: job.type
    }
  });
  await writeAuditLog({ actor: scriptRequestUser(project.ownerId), action: AuditAction.EXECUTE, entityType: "ScriptProject", entityId: project.id, metadata: { operation: "idea_breakdown", status: "SUCCEEDED", rowCount: rows.length, textModel: breakdown.model, failedModelAttempts: breakdown.attempts.length } });
}

async function processRegenerate(job: any) {
  const input = job.inputJson || {};
  const project = await prisma.scriptProject.findUnique({ where: { id: job.projectId || "" } });
  if (!project) throw new HttpError(404, "剧本项目不存在。", "SCRIPT_PROJECT_NOT_FOUND");
  const mode = input.mode as "image" | "video" | "both";
  const rowId = typeof input.rowId === "string" ? input.rowId : null;
  await updateJob(job.id, { status: ScriptProcessingJobStatus.GENERATING, progress: 30, message: "正在重新生成提示词", startedAt: new Date() });

  const rows = await prisma.scriptBreakdownRow.findMany({
    where: { projectId: project.id, ...(rowId ? { id: rowId } : {}) },
    orderBy: { orderIndex: "asc" }
  });
  if (rowId && rows.length === 0) throw new HttpError(404, "分镜行不存在。", "SCRIPT_ROW_NOT_FOUND");

  for (const row of rows) {
    await prisma.scriptBreakdownRow.update({
      where: { id: row.id },
      data: {
        ...(mode === "image" || mode === "both" ? { storyboardImagePrompt: buildStoryboardImagePrompt(row) } : {}),
        ...(mode === "video" || mode === "both" ? { storyboardVideoPrompt: buildStoryboardVideoPrompt(row) } : {}),
        version: { increment: 1 }
      }
    });
  }
  await createProjectVersion({ projectId: project.id, type: ScriptProjectVersionType.USER_EDITED, summary: rowId ? "单行提示词重新生成" : "批量提示词重新生成", createdById: project.ownerId });
  await updateJob(job.id, { status: ScriptProcessingJobStatus.SUCCEEDED, progress: 100, message: "提示词已重新生成", resultJson: { rowCount: rows.length, mode }, finishedAt: new Date() });
  const updatedRows = await prisma.scriptBreakdownRow.findMany({
    where: { projectId: project.id, ...(rowId ? { id: rowId } : {}) },
    orderBy: { orderIndex: "asc" }
  });
  await recordScriptHistory({
    ownerId: project.ownerId,
    project,
    inputText: rowId ? `重新生成单行提示词：${project.title}` : `批量重新生成提示词：${project.title}`,
    output: summarizeScriptRows(updatedRows),
    source: rowId ? "script_row_regenerate" : "script_bulk_regenerate",
    model: "script-workbench",
    rowCount: updatedRows.length,
    metadata: {
      sourceJobId: job.id,
      sourceJobType: job.type,
      mode,
      rowId
    }
  });
  await writeAuditLog({ actor: scriptRequestUser(project.ownerId), action: AuditAction.UPDATE, entityType: "ScriptProject", entityId: project.id, metadata: { operation: rowId ? `regenerate_${mode}_prompt` : "bulk_regenerate_prompts", status: "SUCCEEDED", rowCount: rows.length } });
}

export async function processScriptJob(jobId: string, _dependencies: { getAI?: () => unknown }) {
  const job = await prisma.scriptProcessingJob.findUnique({ where: { id: jobId } });
  if (!job) throw new HttpError(404, "剧本任务不存在。", "SCRIPT_JOB_NOT_FOUND");

  try {
    if (job.type === ScriptProcessingJobType.FILE_BREAKDOWN) await processFileBreakdown(job);
    else if (job.type === ScriptProcessingJobType.IDEA_BREAKDOWN) await processIdeaBreakdown(job);
    else if (
      job.type === ScriptProcessingJobType.REGENERATE_IMAGE_PROMPT ||
      job.type === ScriptProcessingJobType.REGENERATE_VIDEO_PROMPT ||
      job.type === ScriptProcessingJobType.BULK_REGENERATE_PROMPTS
    ) await processRegenerate(job);
    else if (job.type === ScriptProcessingJobType.EXPORT_EXCEL) {
      const project = await prisma.scriptProject.findUnique({ where: { id: job.projectId || "" } });
      if (!project) throw new HttpError(404, "剧本项目不存在。", "SCRIPT_PROJECT_NOT_FOUND");
      await updateJob(job.id, { status: ScriptProcessingJobStatus.SAVING, progress: 60, message: "正在生成 Excel 文件", startedAt: new Date() });
      const result = await exportScriptProjectExcel({ user: scriptRequestUser(project.ownerId), projectId: project.id });
      await updateJob(job.id, { status: ScriptProcessingJobStatus.SUCCEEDED, progress: 100, message: "Excel 已生成", resultJson: result, finishedAt: new Date() });
      await recordScriptHistory({
        ownerId: project.ownerId,
        project,
        inputText: `导出 Excel：${project.title}`,
        output: `Excel 已生成：${result.filename}\n${result.url || ""}`.trim(),
        source: "script_export_excel",
        model: "script-workbench",
        rowCount: typeof result.rowCount === "number" ? result.rowCount : undefined,
        outputType: "document",
        metadata: {
          sourceJobId: job.id,
          sourceJobType: job.type,
          assetId: result.assetId || null,
          url: result.url || null
        }
      });
    } else throw new HttpError(400, "暂不支持的剧本任务类型。", "SCRIPT_JOB_TYPE_UNSUPPORTED");
  } catch (error: any) {
    const message = error instanceof HttpError ? error.message : error?.message || "剧本处理失败。";
    await prisma.$transaction([
      prisma.scriptProcessingJob.update({ where: { id: job.id }, data: { status: ScriptProcessingJobStatus.FAILED, progress: 100, errorMessage: message, finishedAt: new Date() } }),
      ...(job.projectId ? [prisma.scriptProject.update({ where: { id: job.projectId }, data: { status: ScriptProjectStatus.FAILED, errorMessage: message } })] : [])
    ]);
    await writeAuditLog({ actor: scriptRequestUser(job.ownerId), action: AuditAction.ACCESS, entityType: "ScriptProcessingJob", entityId: job.id, metadata: { operation: job.type, status: "FAILED", errorCode: error?.code || null } });
    throw error;
  }
}

export async function createScriptFileProject(input: { user: RequestUser; fileAssetId: string; title: string; productionProjectId?: string | null }) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: input.fileAssetId } });
  if (!asset || !canReadMediaAsset(input.user, asset)) throw new HttpError(404, "上传文件不存在或无权访问。", "SCRIPT_FILE_NOT_FOUND");
  const project = await prisma.scriptProject.create({
    data: {
      ownerId: input.user.id,
      title: safeTitle(input.title || asset.originalName || "上传剧本"),
      sourceType: ScriptProjectSourceType.FILE,
      sourceFileId: asset.id,
      status: ScriptProjectStatus.PROCESSING,
      metadata: input.productionProjectId ? { productionProjectId: input.productionProjectId } : undefined
    }
  });
  return project;
}

export async function createIdeaProject(input: { user: RequestUser; idea: string; title?: string; productionProjectId?: string | null }) {
  const idea = input.idea.trim();
  if (idea.length < 2) throw new HttpError(400, "请输入有效创意内容。", "SCRIPT_IDEA_TOO_SHORT");
  if (idea.length > 20_000) throw new HttpError(413, "创意文本过长，请控制在 20000 字以内。", "SCRIPT_IDEA_TOO_LONG");
  return prisma.scriptProject.create({
    data: {
      ownerId: input.user.id,
      title: safeTitle(input.title || idea.slice(0, 24)),
      sourceType: ScriptProjectSourceType.IDEA,
      originalIdea: idea,
      status: ScriptProjectStatus.PROCESSING,
      metadata: input.productionProjectId ? { productionProjectId: input.productionProjectId } : undefined
    }
  });
}

export async function createScriptJob(input: { ownerId: string; projectId?: string | null; type: ScriptProcessingJobType; inputJson?: any }) {
  return prisma.scriptProcessingJob.create({
    data: {
      ownerId: input.ownerId,
      projectId: input.projectId || null,
      type: input.type,
      inputJson: input.inputJson || undefined,
      status: ScriptProcessingJobStatus.QUEUED,
      progress: 0,
      message: "任务已排队"
    }
  });
}

export async function updateScriptRow(input: { user: RequestUser; projectId: string; rowId: string; body: any }) {
  const project = await assertScriptProjectAccess(input.projectId, input.user);
  const existing = await prisma.scriptBreakdownRow.findFirst({ where: { id: input.rowId, projectId: project.id } });
  if (!existing) throw new HttpError(404, "分镜行不存在。", "SCRIPT_ROW_NOT_FOUND");
  const parsed = updateScriptRowSchema.parse(input.body);
  if (new Date(parsed.updatedAt).getTime() !== existing.updatedAt.getTime() || parsed.version !== existing.version) {
    throw new HttpError(409, "该分镜行已被其他操作更新，请刷新后再保存。", "SCRIPT_ROW_CONFLICT", serializeScriptRow(existing));
  }
  const { updatedAt, version, ...data } = parsed;
  const updated = await prisma.scriptBreakdownRow.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
  await createProjectVersion({ projectId: project.id, type: ScriptProjectVersionType.USER_EDITED, summary: `用户编辑第 ${existing.orderIndex} 行`, createdById: input.user.id });
  await writeAuditLog({ actor: input.user, action: AuditAction.UPDATE, entityType: "ScriptBreakdownRow", entityId: existing.id, metadata: { projectId: project.id, operation: "edit_row", orderIndex: existing.orderIndex } });
  return updated;
}

function deleteLocalMediaFile(storageKey?: string | null) {
  if (!storageKey) return;
  try {
    const filePath = resolveLocalUploadPath(storageKey);
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch (error) {
    console.warn("[ScriptProjectDelete] Failed to remove local media file:", error);
  }
}

function isScriptProjectExportAsset(asset: { metadata: any }, projectId: string) {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  return metadata.scriptProjectId === projectId && metadata.exportType === "script-breakdown-xlsx";
}

export async function deleteScriptProject(input: { user: RequestUser; projectId: string }) {
  const project = await assertScriptProjectAccess(input.projectId, input.user);
  const mediaAssets = await prisma.mediaAsset.findMany({
    where: {
      ownerId: project.ownerId,
      OR: [
        ...(project.sourceFileId ? [{ id: project.sourceFileId }] : []),
        { metadata: { path: ["scriptProjectId"], equals: project.id } }
      ]
    },
    select: { id: true, storageKey: true, metadata: true }
  });
  const deletableAssetIds = mediaAssets
    .filter((asset) => asset.id === project.sourceFileId || isScriptProjectExportAsset(asset, project.id))
    .map((asset) => asset.id);
  const deletableStorageKeys = mediaAssets
    .filter((asset) => deletableAssetIds.includes(asset.id))
    .map((asset) => asset.storageKey)
    .filter(Boolean) as string[];

  await prisma.$transaction([
    prisma.scriptProject.delete({ where: { id: project.id } }),
    ...(deletableAssetIds.length > 0 ? [prisma.mediaAsset.deleteMany({ where: { id: { in: deletableAssetIds } } })] : []),
    prisma.auditLog.create({
      data: {
        actorId: input.user.id,
        action: AuditAction.DELETE,
        entityType: "ScriptProject",
        entityId: project.id,
        beforeJson: {
          title: project.title,
          ownerId: project.ownerId,
          sourceType: project.sourceType,
          status: project.status,
          sourceFileId: project.sourceFileId
        },
        metadata: {
          operation: "delete_script_project",
          removedMediaAssetCount: deletableAssetIds.length
        }
      }
    })
  ]);

  deletableStorageKeys.forEach(deleteLocalMediaFile);
  return { id: project.id, title: project.title, removedMediaAssetCount: deletableAssetIds.length };
}

export async function exportScriptProjectExcel(input: { user: RequestUser; projectId: string }) {
  const project = await assertScriptProjectAccess(input.projectId, input.user);
  const rows = await prisma.scriptBreakdownRow.findMany({ where: { projectId: project.id }, orderBy: { orderIndex: "asc" } });
  if (rows.length === 0) throw new HttpError(400, "当前项目没有可导出的分镜数据。", "SCRIPT_EXPORT_EMPTY");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JIYING";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("剧本分镜表", { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = SCRIPT_BREAKDOWN_FIELDS.map((field) => ({ header: field.title, key: field.key, width: field.key === "storyboardImagePrompt" || field.key === "storyboardVideoPrompt" ? 42 : 18 }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  for (const row of rows) {
    worksheet.addRow(SCRIPT_BREAKDOWN_FIELDS.reduce((record, field) => ({ ...record, [field.key]: (row as any)[field.key] ?? "" }), {} as Record<string, any>));
  }
  worksheet.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  const uploadsDir = getUploadsDir();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = makeExcelFileName(project.title);
  const filePath = path.join(uploadsDir, `${Date.now()}-${filename}`);
  await workbook.xlsx.writeFile(filePath);

  const asset = await recordLocalMediaAsset({
    requestUser: input.user,
    type: MediaAssetType.DOCUMENT,
    url: `/uploads/${path.basename(filePath)}`,
    filePath,
    originalName: filename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    visibility: MediaVisibility.OWNER_ONLY,
    metadata: { scriptProjectId: project.id, exportType: "script-breakdown-xlsx" }
  });

  await createProjectVersion({ projectId: project.id, type: ScriptProjectVersionType.EXPORTED, summary: "导出 Excel 分镜表", createdById: input.user.id });
  await writeAuditLog({ actor: input.user, action: AuditAction.ACCESS, entityType: "ScriptProject", entityId: project.id, metadata: { operation: "export_excel", rowCount: rows.length, assetId: asset?.id || null } });
  return { filename, assetId: asset?.id || null, url: asset ? protectedMediaUrl(asset.id) : `/uploads/${path.basename(filePath)}`, rowCount: rows.length };
}
