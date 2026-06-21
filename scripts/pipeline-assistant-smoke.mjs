import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { resolveSmokeBaseUrl } from "./smoke-base-url.mjs";

dotenv.config();

const baseUrl = await resolveSmokeBaseUrl(["PIPELINE_ASSISTANT_SMOKE_BASE_URL"]);
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  actionIds: [],
  attachmentIds: [],
  messageIds: [],
  assistantSessionIds: [],
  mediaAssetIds: [],
  snapshotIds: [],
  projectMemberIds: [],
  projectIds: [],
  scriptJobIds: [],
  scriptProjectIds: [],
  userIds: []
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function uploadAttachment(pathname, cookie, filename, bytes, type = "text/plain") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  return request(pathname, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form
  });
}

function expectStatus(response, allowed, label) {
  assert(allowed.includes(response.status), `${label} expected ${allowed.join("/")} but got ${response.status}: ${JSON.stringify(response.body)}`);
}

async function createUser(label) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `pipeline-assistant-${label}-${suffix}@example.test`,
      username: `pipeline-assistant-${label}-${suffix}`.slice(0, 40),
      displayName: `Pipeline Assistant ${label}`,
      role: "USER",
      status: "ACTIVE",
      emailVerified: true
    }
  });
  created.userIds.push(user.id);
  return user;
}

async function createCookie(userId, label) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      userAgent: `pipeline-assistant-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function createProject(owner) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.productionProject.create({
    data: {
      name: `Pipeline Assistant Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "pipeline-assistant-smoke" }
    }
  });
  created.projectIds.push(project.id);
  const member = await prisma.productionProjectMember.create({
    data: {
      projectId: project.id,
      userId: owner.id,
      role: "OWNER"
    }
  });
  created.projectMemberIds.push(member.id);
  return project;
}

async function createAssistantSession(project, user, stage = "ART_03") {
  const session = await prisma.pipelineAssistantSession.create({
    data: {
      projectId: project.id,
      userId: user.id,
      stage,
      title: `Smoke ${stage}`
    }
  });
  created.assistantSessionIds.push(session.id);
  return session;
}

async function createTrackedAssistantSession(project, user, stage) {
  return createAssistantSession(project, user, stage);
}

async function createAction(input) {
  const snapshot = await prisma.pipelineWorkspaceSnapshot.create({
    data: {
      projectId: input.project.id,
      userId: input.user.id,
      stage: input.stage,
      summary: "Smoke snapshot",
      snapshotJson: { smoke: true, stage: input.stage }
    }
  });
  created.snapshotIds.push(snapshot.id);
  const action = await prisma.pipelineAssistantAction.create({
    data: {
      sessionId: input.session.id,
      projectId: input.project.id,
      userId: input.user.id,
      stage: input.stage,
      type: input.type,
      payload: input.payload || { text: "Smoke assistant action" },
      previewText: input.previewText || "Smoke assistant action",
      workspaceSnapshotId: snapshot.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  created.actionIds.push(action.id);
  return { action, snapshot };
}

async function cleanup() {
  if (created.attachmentIds.length > 0) {
    const attachments = await prisma.pipelineAssistantAttachment.findMany({
      where: { id: { in: created.attachmentIds } },
      select: { mediaAssetId: true }
    });
    for (const attachment of attachments) {
      if (attachment.mediaAssetId) created.mediaAssetIds.push(attachment.mediaAssetId);
    }
    await prisma.pipelineAssistantAttachment.deleteMany({ where: { id: { in: created.attachmentIds } } });
  }
  if (created.scriptJobIds.length > 0) await prisma.scriptProcessingJob.deleteMany({ where: { id: { in: created.scriptJobIds } } });
  if (created.scriptProjectIds.length > 0) await prisma.scriptProject.deleteMany({ where: { id: { in: created.scriptProjectIds } } });
  if (created.actionIds.length > 0) await prisma.pipelineAssistantAction.deleteMany({ where: { id: { in: created.actionIds } } });
  if (created.messageIds.length > 0) await prisma.pipelineAssistantMessage.deleteMany({ where: { id: { in: created.messageIds } } });
  if (created.snapshotIds.length > 0) await prisma.pipelineWorkspaceSnapshot.deleteMany({ where: { id: { in: created.snapshotIds } } });
  if (created.assistantSessionIds.length > 0) await prisma.pipelineAssistantSession.deleteMany({ where: { id: { in: created.assistantSessionIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.projectMemberIds.length > 0) await prisma.productionProjectMember.deleteMany({ where: { id: { in: created.projectMemberIds } } });
  if (created.projectIds.length > 0) await prisma.productionProject.deleteMany({ where: { id: { in: created.projectIds } } });
  if (created.mediaAssetIds.length > 0) {
    const mediaAssets = await prisma.mediaAsset.findMany({
      where: { id: { in: Array.from(new Set(created.mediaAssetIds)) } },
      select: { id: true, storageKey: true }
    });
    await prisma.mediaAsset.deleteMany({ where: { id: { in: mediaAssets.map((asset) => asset.id) } } });
    const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
    for (const media of mediaAssets) {
      if (!media.storageKey) continue;
      const filePath = path.resolve(uploadsDir, media.storageKey);
      const relative = path.relative(uploadsDir, filePath);
      if (!relative.startsWith("..") && !path.isAbsolute(relative) && fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  }
  if (created.userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.$disconnect();
}

async function main() {
  const owner = await createUser("owner");
  const intruder = await createUser("intruder");
  const ownerCookie = await createCookie(owner.id, "owner");
  const intruderCookie = await createCookie(intruder.id, "intruder");
  const project = await createProject(owner);
  const session = await createAssistantSession(project, owner);

  const anonymousContext = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/context`);
  expectStatus(anonymousContext, [401], "Anonymous context");

  const intruderContext = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/context`, {
    headers: { Cookie: intruderCookie }
  });
  expectStatus(intruderContext, [404], "Intruder context");

  const ownerContext = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/context`, {
    headers: { Cookie: ownerCookie }
  });
  expectStatus(ownerContext, [200], "Owner context");
  assert(ownerContext.body?.context?.stage === "ART_03", "Owner context should be scoped to ART_03.");
  assert(ownerContext.body?.context?.tools?.includes("ART_NODE_CREATE"), "Owner context should expose art tools.");

  const smokeMessage = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/messages`, {
    method: "POST",
    headers: {
      Cookie: ownerCookie,
      "Content-Type": "application/json",
      "x-pipeline-assistant-smoke": "1"
    },
    body: JSON.stringify({ text: "请创建一个夜雨茶馆掌柜的美术角色节点" })
  });
  expectStatus(smokeMessage, [201], "Smoke deterministic assistant message");
  assert(smokeMessage.body?.message?.actions?.[0]?.stage === "ART_03", "Smoke message should create a same-stage action.");
  assert(smokeMessage.body?.message?.actions?.[0]?.status === "PENDING", "Smoke message action should be pending.");
  created.messageIds.push(smokeMessage.body.message.id);
  created.actionIds.push(smokeMessage.body.message.actions[0].id);

  const { action: stageMismatchAction } = await createAction({
    project,
    user: owner,
    session,
    stage: "ART_03",
    type: "ART_NODE_CREATE"
  });
  const stageMismatch = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/SHOT_04/assistant/actions/${encodeURIComponent(stageMismatchAction.id)}/confirm`, {
    method: "POST",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(stageMismatch, [400], "Stage mismatch confirm");
  assert(stageMismatch.body?.code === "PIPELINE_ASSISTANT_STAGE_MISMATCH", "Expected stage mismatch code.");

  const { action: confirmAction } = await createAction({
    project,
    user: owner,
    session,
    stage: "ART_03",
    type: "ART_NODE_CREATE",
    payload: {
      name: "烟雨茶馆掌柜",
      nodeType: "角色",
      prompt: "青年掌柜，深青色长衫，雨夜茶馆窗光，电影感",
      aspectRatio: "3:4",
      resolution: "2K"
    }
  });
  const confirm = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/actions/${encodeURIComponent(confirmAction.id)}/confirm`, {
    method: "POST",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(confirm, [200], "Confirm action");
  assert(confirm.body?.action?.status === "CONFIRMED", "Confirmed action should be CONFIRMED.");
  const confirmAudit = await prisma.auditLog.findFirst({
    where: {
      actorId: owner.id,
      action: "EXECUTE",
      entityType: "PipelineAssistantAction",
      entityId: confirmAction.id
    },
    orderBy: { createdAt: "desc" }
  });
  assert(confirmAudit?.metadata?.status === "CONFIRMED", "Confirmed action should write an EXECUTE audit log.");

  const repeatConfirm = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/actions/${encodeURIComponent(confirmAction.id)}/confirm`, {
    method: "POST",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(repeatConfirm, [409], "Repeat confirm");
  assert(repeatConfirm.body?.code === "PIPELINE_ASSISTANT_ACTION_ALREADY_HANDLED", "Expected already handled code.");

  const { action: rejectAction } = await createAction({
    project,
    user: owner,
    session,
    stage: "ART_03",
    type: "ART_NODE_CREATE"
  });
  const reject = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/actions/${encodeURIComponent(rejectAction.id)}/reject`, {
    method: "POST",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(reject, [200], "Reject action");
  assert(reject.body?.action?.status === "REJECTED", "Rejected action should be REJECTED.");

  const { action: conflictAction } = await createAction({
    project,
    user: owner,
    session,
    stage: "ART_03",
    type: "ART_NODE_CREATE"
  });
  const newerSnapshot = await prisma.pipelineWorkspaceSnapshot.create({
    data: {
      projectId: project.id,
      userId: owner.id,
      stage: "ART_03",
      summary: "Smoke newer snapshot",
      snapshotJson: { smoke: true, newer: true }
    }
  });
  created.snapshotIds.push(newerSnapshot.id);
  const conflict = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/actions/${encodeURIComponent(conflictAction.id)}/confirm`, {
    method: "POST",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(conflict, [409], "Workspace conflict");
  assert(conflict.body?.code === "PIPELINE_ASSISTANT_WORKSPACE_CONFLICT", "Expected workspace conflict code.");

  const uploadText = await uploadAttachment(
    `/api/pipeline/${encodeURIComponent(project.id)}/stages/SCRIPT_01/assistant/attachments`,
    ownerCookie,
    "pipeline-assistant-smoke-script.txt",
    "第一场：夜晚，城市天台。\n角色A：我们还有一次机会。\n角色B：那就从这里开始。"
  );
  expectStatus(uploadText, [201], "Script attachment upload");
  assert(uploadText.body?.attachment?.parseStatus === "PARSED", "Attachment should be parsed.");
  assert(uploadText.body?.action?.type === "SCRIPT_IMPORT_PARSE", "Script attachment should create SCRIPT_IMPORT_PARSE action.");
  assert(uploadText.body?.message?.actions?.[0]?.id === uploadText.body?.action?.id, "Attachment message should include created action.");
  created.attachmentIds.push(uploadText.body.attachment.id);
  created.actionIds.push(uploadText.body.action.id);
  created.messageIds.push(uploadText.body.message.id);

  const scriptMessages = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/SCRIPT_01/assistant/messages`, {
    headers: { Cookie: ownerCookie }
  });
  expectStatus(scriptMessages, [200], "Script assistant messages after upload");
  const hydratedUploadAction = scriptMessages.body?.messages
    ?.flatMap((message) => message.actions || [])
    ?.find((action) => action.id === uploadText.body.action.id);
  assert(hydratedUploadAction?.type === "SCRIPT_IMPORT_PARSE", "Uploaded attachment action should hydrate from message history.");

  const badUpload = await uploadAttachment(
    `/api/pipeline/${encodeURIComponent(project.id)}/stages/SCRIPT_01/assistant/attachments`,
    ownerCookie,
    "pipeline-assistant-smoke-bad.txt",
    new Uint8Array([0x00, 0x01, 0x02, 0x03]),
    "text/plain"
  );
  expectStatus(badUpload, [400], "Bad attachment upload");
  assert(badUpload.body?.code === "PIPELINE_ASSISTANT_ATTACHMENT_MAGIC_MISMATCH", `Expected attachment magic mismatch code: ${JSON.stringify(badUpload.body)}`);

  const artSession = await createTrackedAssistantSession(project, owner, "ART_03");
  const { action: artAction } = await createAction({
    project,
    user: owner,
    session: artSession,
    stage: "ART_03",
    type: "ART_NODE_CREATE",
    payload: {
      name: "烟雨茶馆角色",
      nodeType: "角色",
      prompt: "一位穿深青色长衫的青年掌柜，写实电影感，柔和侧光",
      aspectRatio: "3:4",
      resolution: "2K",
      negativePrompt: "low quality"
    }
  });
  const artConfirm = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/ART_03/assistant/actions/${encodeURIComponent(artAction.id)}/confirm`, {
    method: "POST",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(artConfirm, [200], "ART node action confirm");
  assert(artConfirm.body?.action?.executionResult?.patch?.node?.type === "角色", "ART action should return an art node patch.");
  assert(artConfirm.body?.action?.executionResult?.patch?.node?.aspect_ratio === "3:4", "ART action should preserve aspect ratio.");

  const shotSession = await createTrackedAssistantSession(project, owner, "SHOT_04");
  const { action: shotAction } = await createAction({
    project,
    user: owner,
    session: shotSession,
    stage: "SHOT_04",
    type: "SHOT_GENERATE_START",
    payload: {
      name: "1-1",
      prompt: "夜雨中，镜头从茶馆招牌缓慢推进到窗边人物",
      shotSize: "中景",
      cameraMovement: "缓慢推进",
      durationSeconds: 6,
      composition: "招牌前景，人物在右三分线"
    }
  });
  const shotConfirm = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/SHOT_04/assistant/actions/${encodeURIComponent(shotAction.id)}/confirm`, {
    method: "POST",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(shotConfirm, [200], "SHOT node action confirm");
  assert(shotConfirm.body?.action?.executionResult?.patch?.node?.type === "视频生成", "SHOT generate action should return a video generator node patch.");
  assert(shotConfirm.body?.action?.executionResult?.patch?.startGeneration === true, "SHOT_GENERATE_START should request generation start.");
  assert(shotConfirm.body?.action?.executionResult?.patch?.node?.shotSize === "中景", "SHOT action should preserve shot size.");

  const editSession = await createTrackedAssistantSession(project, owner, "EDIT_05");
  const { action: editAction } = await createAction({
    project,
    user: owner,
    session: editSession,
    stage: "EDIT_05",
    type: "EDIT_ROUGH_CUT_CREATE",
    payload: {
      text: "茶馆开场粗剪：雨声铺底，招牌推进，切到人物对白。",
      clips: [
        { kind: "TEXT", name: "开场节奏", text: "雨声铺底，招牌推进", trackId: "t1", startMs: 0, durationMs: 3000 },
        { kind: "TEXT", name: "对白节奏", text: "切到人物对白，留 12 帧停顿", trackId: "t1", startMs: 3000, durationMs: 4000 }
      ],
      markers: [{ atMs: 3000, label: "对白切入" }],
      transitions: [{ atMs: 2800, type: "dissolve" }]
    }
  });
  const editConfirm = await request(`/api/pipeline/${encodeURIComponent(project.id)}/stages/EDIT_05/assistant/actions/${encodeURIComponent(editAction.id)}/confirm`, {
    method: "POST",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(editConfirm, [200], "EDIT rough cut action confirm");
  assert(editConfirm.body?.action?.executionResult?.patch?.mode === "rough-cut", "EDIT action should return rough-cut patch.");
  assert(editConfirm.body?.action?.executionResult?.patch?.clips?.length === 2, "EDIT action should preserve rough cut clips.");
  assert(editConfirm.body?.action?.executionResult?.patch?.markers?.length === 1, "EDIT action should preserve markers.");

  console.log(JSON.stringify({
    success: true,
    projectId: project.id,
    checked: {
      anonymousContext: anonymousContext.status,
      intruderContext: intruderContext.status,
      ownerContext: ownerContext.status,
      smokeMessageAction: smokeMessage.body?.message?.actions?.[0]?.type,
      stageMismatch: stageMismatch.body?.code,
      confirm: confirm.body?.action?.status,
      confirmAudit: confirmAudit?.metadata?.status,
      repeatConfirm: repeatConfirm.body?.code,
      reject: reject.body?.action?.status,
      conflict: conflict.body?.code,
      attachmentUpload: uploadText.body?.action?.type,
      attachmentHistoryHydration: hydratedUploadAction?.type,
      badAttachmentUpload: badUpload.body?.code,
      artPatchType: artConfirm.body?.action?.executionResult?.patch?.node?.type,
      shotPatchType: shotConfirm.body?.action?.executionResult?.patch?.node?.type,
      shotStartGeneration: shotConfirm.body?.action?.executionResult?.patch?.startGeneration,
      editClipCount: editConfirm.body?.action?.executionResult?.patch?.clips?.length
    }
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((error) => {
      console.error("Cleanup failed:", error?.message || error);
      process.exitCode = 1;
    });
  });
