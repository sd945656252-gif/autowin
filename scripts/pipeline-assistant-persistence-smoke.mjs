import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { resolveSmokeBaseUrl } from "./smoke-base-url.mjs";

dotenv.config();

const baseUrl = await resolveSmokeBaseUrl(["PIPELINE_ASSISTANT_SMOKE_BASE_URL"]);
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  actionIds: [],
  assistantSessionIds: [],
  snapshotIds: [],
  projectMemberIds: [],
  projectIds: [],
  editingProjectIds: [],
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

function expectStatus(response, allowed, label) {
  assert(allowed.includes(response.status), `${label} expected ${allowed.join("/")} but got ${response.status}: ${JSON.stringify(response.body)}`);
}

async function createUser() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `pipeline-assistant-persist-${suffix}@example.test`,
      username: `pipeline-assistant-persist-${suffix}`.slice(0, 40),
      displayName: "Pipeline Assistant Persistence",
      role: "USER",
      status: "ACTIVE",
      emailVerified: true
    }
  });
  created.userIds.push(user.id);
  return user;
}

async function createCookie(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      userAgent: "pipeline-assistant-persistence-smoke"
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function createProject(owner) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.productionProject.create({
    data: {
      name: `Pipeline Assistant Persistence ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "pipeline-assistant-persistence-smoke" }
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

async function createAssistantSession(project, user, stage) {
  const session = await prisma.pipelineAssistantSession.create({
    data: {
      projectId: project.id,
      userId: user.id,
      stage,
      title: `Persistence ${stage}`
    }
  });
  created.assistantSessionIds.push(session.id);
  return session;
}

async function createAction({ project, user, session, stage, type, payload }) {
  const snapshot = await prisma.pipelineWorkspaceSnapshot.create({
    data: {
      projectId: project.id,
      userId: user.id,
      stage,
      summary: "Persistence smoke snapshot",
      snapshotJson: { smoke: true, stage }
    }
  });
  created.snapshotIds.push(snapshot.id);
  const action = await prisma.pipelineAssistantAction.create({
    data: {
      sessionId: session.id,
      projectId: project.id,
      userId: user.id,
      stage,
      type,
      payload,
      previewText: `Persistence ${type}`,
      workspaceSnapshotId: snapshot.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  created.actionIds.push(action.id);
  return action;
}

function canvasWorkflowName(userId) {
  return `canvas-state:${userId || "guest"}`;
}

async function cleanup() {
  if (created.editingProjectIds.length > 0) await prisma.editingProject.deleteMany({ where: { id: { in: created.editingProjectIds } } });
  if (created.actionIds.length > 0) await prisma.pipelineAssistantAction.deleteMany({ where: { id: { in: created.actionIds } } });
  if (created.snapshotIds.length > 0) await prisma.pipelineWorkspaceSnapshot.deleteMany({ where: { id: { in: created.snapshotIds } } });
  if (created.assistantSessionIds.length > 0) await prisma.pipelineAssistantSession.deleteMany({ where: { id: { in: created.assistantSessionIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.projectMemberIds.length > 0) await prisma.productionProjectMember.deleteMany({ where: { id: { in: created.projectMemberIds } } });
  if (created.projectIds.length > 0) await prisma.productionProject.deleteMany({ where: { id: { in: created.projectIds } } });
  if (created.userIds.length > 0) {
    await prisma.workflow.deleteMany({ where: { ownerId: { in: created.userIds }, name: { in: created.userIds.map(canvasWorkflowName) } } });
    await prisma.promptHistoryItem.deleteMany({ where: { ownerId: { in: created.userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  }
  await prisma.$disconnect();
}

async function main() {
  const owner = await createUser();
  const cookie = await createCookie(owner.id);
  const project = await createProject(owner);

  const promptSession = await createAssistantSession(project, owner, "ART_03");
  const promptAction = await createAction({
    project,
    user: owner,
    session: promptSession,
    stage: "ART_03",
    type: "ART_NODE_CREATE",
    payload: {
      name: "烟雨茶馆掌柜",
      nodeType: "角色",
      prompt: "电影感夜雨茶馆掌柜，深青色长衫，湿润窗光，写实角色设定。",
      aspectRatio: "3:4",
      resolution: "2K"
    }
  });
  const promptConfirm = await request(`/api/pipeline/${project.id}/stages/ART_03/assistant/actions/${promptAction.id}/confirm`, {
    method: "POST",
    headers: { Cookie: cookie }
  });
  expectStatus(promptConfirm, [200], "Prompt optimization art confirm");
  const promptNode = promptConfirm.body?.action?.executionResult?.patch?.node;
  assert(promptNode?.prompt?.includes("电影感夜雨茶馆"), "Prompt optimization confirm should return prompt node patch.");

  const historySave = await request("/api/prompt-history", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      featureMode: "image_prompt",
      input: "茶馆夜雨开场，提示词优化输出",
      output: promptNode.prompt,
      model: "pipeline-assistant-smoke",
      source: "pipeline_assistant",
      sourceActionId: promptAction.id
    })
  });
  expectStatus(historySave, [200], "Prompt optimization history save");
  const historyRead = await request("/api/prompt-history", { headers: { Cookie: cookie } });
  expectStatus(historyRead, [200], "Prompt optimization history read");
  assert(historyRead.body?.items?.some((item) => item.output === promptNode.prompt), "Prompt optimization output should be readable after save.");

  const artSession = await createAssistantSession(project, owner, "ART_03");
  const artAction = await createAction({
    project,
    user: owner,
    session: artSession,
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
  const artConfirm = await request(`/api/pipeline/${project.id}/stages/ART_03/assistant/actions/${artAction.id}/confirm`, {
    method: "POST",
    headers: { Cookie: cookie }
  });
  expectStatus(artConfirm, [200], "Art confirm");

  const shotSession = await createAssistantSession(project, owner, "SHOT_04");
  const shotAction = await createAction({
    project,
    user: owner,
    session: shotSession,
    stage: "SHOT_04",
    type: "SHOT_GENERATE_START",
    payload: {
      name: "1-1",
      prompt: "夜雨茶馆外景，镜头缓慢推进到窗边人物",
      shotSize: "中景",
      cameraMovement: "缓慢推进",
      durationSeconds: 6
    }
  });
  const shotConfirm = await request(`/api/pipeline/${project.id}/stages/SHOT_04/assistant/actions/${shotAction.id}/confirm`, {
    method: "POST",
    headers: { Cookie: cookie }
  });
  expectStatus(shotConfirm, [200], "Shot confirm");

  const artNode = artConfirm.body?.action?.executionResult?.patch?.node;
  const shotNode = shotConfirm.body?.action?.executionResult?.patch?.node;
  const canvasSave = await request("/api/canvas-state", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      state: {
        nodes: [{ id: `art-${artAction.id}`, ...artNode }],
        shotNodes: [{ id: `shot-${shotAction.id}`, ...shotNode, assistant_auto_run_action_id: shotAction.id }],
        shots: [],
        apiConfigs: []
      }
    })
  });
  expectStatus(canvasSave, [200], "Canvas save");
  const canvasRead = await request("/api/canvas-state", { headers: { Cookie: cookie } });
  expectStatus(canvasRead, [200], "Canvas read");
  assert(canvasRead.body?.state?.nodes?.some((node) => node.prompt === artNode.prompt), "Art node should be readable after canvas save.");
  assert(canvasRead.body?.state?.shotNodes?.some((node) => node.prompt === shotNode.prompt && node.type === "视频生成"), "Shot video node should be readable after canvas save.");

  const editSession = await createAssistantSession(project, owner, "EDIT_05");
  const editAction = await createAction({
    project,
    user: owner,
    session: editSession,
    stage: "EDIT_05",
    type: "EDIT_ROUGH_CUT_CREATE",
    payload: {
      text: "雨声铺底，招牌推进，切到人物对白。",
      clips: [
        { kind: "TEXT", name: "开场节奏", text: "雨声铺底，招牌推进", trackId: "t1", startMs: 0, durationMs: 3000 },
        { kind: "TEXT", name: "对白节奏", text: "切到人物对白", trackId: "t1", startMs: 3000, durationMs: 4000 }
      ],
      markers: [{ atMs: 3000, label: "对白切入" }]
    }
  });
  const editConfirm = await request(`/api/pipeline/${project.id}/stages/EDIT_05/assistant/actions/${editAction.id}/confirm`, {
    method: "POST",
    headers: { Cookie: cookie }
  });
  expectStatus(editConfirm, [200], "Edit confirm");
  const editPatch = editConfirm.body?.action?.executionResult?.patch;
  const editProject = await request("/api/editing-projects", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Pipeline Assistant Persistence Edit" })
  });
  expectStatus(editProject, [201], "Editing project create");
  created.editingProjectIds.push(editProject.body.project.id);

  const timeline = {
    version: 1,
    durationMs: 7000,
    settings: { fps: 30, width: 1920, height: 1080, aspectRatio: "16:9" },
    tracks: [
      { id: "v1", type: "VIDEO", name: "V1 主视频", clips: [] },
      { id: "a1", type: "AUDIO", name: "A1 音频", clips: [] },
      { id: "t1", type: "TEXT", name: "T1 字幕", clips: editPatch.clips.map((clip, index) => ({ id: `clip-${index}`, ...clip })) }
    ],
    metadata: { markers: editPatch.markers || [] }
  };
  const timelineSave = await request(`/api/editing-projects/${editProject.body.project.id}/timeline`, {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ timeline })
  });
  expectStatus(timelineSave, [200], "Editing timeline save");
  const timelineRead = await request(`/api/editing-projects/${editProject.body.project.id}`, { headers: { Cookie: cookie } });
  expectStatus(timelineRead, [200], "Editing timeline read");
  assert(timelineRead.body?.project?.timelineJson?.tracks?.[2]?.clips?.length === 2, "Edit rough cut clips should be readable after timeline save.");

  console.log(JSON.stringify({
    success: true,
    projectId: project.id,
    checked: {
      promptOptimizationHistory: historyRead.body?.items?.[0]?.output,
      canvasArtNodes: canvasRead.body?.state?.nodes?.length,
      canvasShotNodes: canvasRead.body?.state?.shotNodes?.length,
      editClipCount: timelineRead.body?.project?.timelineJson?.tracks?.[2]?.clips?.length
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
