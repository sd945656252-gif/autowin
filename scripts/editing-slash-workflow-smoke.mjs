import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.EDITING_SLASH_SMOKE_BASE_URL || "http://localhost:3000";
const userEmail = process.env.EDITING_SLASH_SMOKE_USER_EMAIL || process.env.PRIMARY_ADMIN_EMAILS?.split(",")[0]?.trim() || "";
const createFixtureWhenMissing = process.env.EDITING_SLASH_SMOKE_CREATE_FIXTURE !== "0";
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  editingProjectIds: [],
  reviewEventIds: [],
  snapshotIds: [],
  assetIds: [],
  projectMemberIds: [],
  projectIds: [],
  mediaAssetIds: [],
  filePaths: []
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
  return { status: response.status, body, headers: response.headers };
}

async function findSmokeUser() {
  if (userEmail) {
    const user = await prisma.user.findUnique({ where: { email: userEmail.toLowerCase() } });
    if (user?.status === "ACTIVE") return user;
  }
  const admin = await prisma.user.findFirst({ where: { status: "ACTIVE", role: { in: ["ADMIN", "DEVELOPER"] } }, orderBy: { createdAt: "asc" } });
  if (admin) return admin;
  return prisma.user.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      userAgent: "editing-slash-workflow-smoke"
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function findApprovedShotVideoAsset(user) {
  const membershipProjectIds = user.role === "ADMIN" || user.role === "DEVELOPER"
    ? null
    : (await prisma.productionProjectMember.findMany({ where: { userId: user.id }, select: { projectId: true } })).map((item) => item.projectId);

  return prisma.productionAsset.findFirst({
    where: {
      stage: "SHOT_04",
      scope: "TEAM",
      reviewStatus: "APPROVED",
      deletedAt: null,
      mediaAssetId: { not: null },
      mimeType: { startsWith: "video/" },
      ...(membershipProjectIds ? { projectId: { in: membershipProjectIds } } : {})
    },
    include: {
      project: true,
      mediaAsset: true
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function createTemporaryShotFixture(user) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const fixtureDir = path.join(uploadsDir, "smoke");
  fs.mkdirSync(fixtureDir, { recursive: true });

  const filename = `editing-slash-shot-${suffix}.mp4`;
  const filePath = path.join(fixtureDir, filename);
  const mp4 = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74
  ]);
  fs.writeFileSync(filePath, mp4);
  created.filePaths.push(filePath);

  const media = await prisma.mediaAsset.create({
    data: {
      ownerId: user.id,
      createdById: user.id,
      type: "VIDEO",
      title: "Editing slash workflow smoke shot",
      url: `/uploads/smoke/${filename}`,
      storageKey: `smoke/${filename}`,
      originalName: filename,
      fileHash: crypto.createHash("sha256").update(mp4).digest("hex"),
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      visibility: "OWNER_ONLY",
      metadata: { smoke: true, purpose: "editing-slash-workflow" }
    }
  });
  created.mediaAssetIds.push(media.id);

  const project = await prisma.productionProject.create({
    data: {
      name: `Editing Slash Smoke ${suffix}`,
      createdById: user.id,
      metadata: { smoke: true, purpose: "editing-slash-workflow" }
    }
  });
  created.projectIds.push(project.id);

  const member = await prisma.productionProjectMember.create({
    data: {
      projectId: project.id,
      userId: user.id,
      role: "OWNER"
    }
  });
  created.projectMemberIds.push(member.id);

  const reviewedAt = new Date();
  const asset = await prisma.productionAsset.create({
    data: {
      projectId: project.id,
      stage: "SHOT_04",
      scope: "TEAM",
      reviewStatus: "APPROVED",
      creatorId: user.id,
      submitterId: user.id,
      reviewerId: user.id,
      mediaAssetId: media.id,
      originalName: filename,
      displayName: "Editing slash workflow smoke shot",
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      sourceType: "smoke_fixture",
      metadata: { smoke: true, purpose: "editing-slash-workflow" }
    }
  });
  created.assetIds.push(asset.id);

  const snapshot = await prisma.productionAssetSnapshot.create({
    data: {
      assetId: asset.id,
      version: 1,
      reviewStatus: "APPROVED",
      createdById: user.id,
      reviewedById: user.id,
      mediaAssetId: media.id,
      originalName: filename,
      displayName: "Editing slash workflow smoke shot",
      frozenPayload: { mediaAssetId: media.id, smoke: true },
      frozenStorageObjectKey: media.storageKey,
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      reviewNote: "Temporary smoke fixture.",
      reviewedAt
    }
  });
  created.snapshotIds.push(snapshot.id);

  await prisma.productionAsset.update({
    where: { id: asset.id },
    data: { currentSnapshotId: snapshot.id }
  });

  const event = await prisma.productionAssetReviewEvent.create({
    data: {
      assetId: asset.id,
      snapshotId: snapshot.id,
      actorId: user.id,
      action: "APPROVE",
      note: "Temporary editing slash smoke fixture.",
      metadata: { smoke: true }
    }
  });
  created.reviewEventIds.push(event.id);

  return prisma.productionAsset.findUnique({
    where: { id: asset.id },
    include: { project: true, mediaAsset: true }
  });
}

function productionRef(assetId, snapshotId) {
  return `production:${assetId}:${snapshotId || ""}`;
}

function buildTimeline(resolved) {
  const ref = resolved.reference;
  const assetRef = productionRef(ref.assetId, ref.snapshotId);
  return {
    version: 1,
    durationMs: 5000,
    settings: { fps: 30, width: 1920, height: 1080, aspectRatio: "16:9" },
    tracks: [
      {
        id: "v1",
        type: "VIDEO",
        name: "V1 主视频",
        clips: [
          {
            id: "editing-slash-smoke-clip",
            assetId: assetRef,
            kind: "VIDEO",
            name: ref.title || "团队镜头",
            startMs: 0,
            durationMs: 5000,
            sourceInMs: 0,
            sourceOutMs: 5000,
            volume: 1,
            muted: false,
            fadeInMs: 0,
            fadeOutMs: 0
          }
        ]
      },
      { id: "a1", type: "AUDIO", name: "A1 音频", clips: [] },
      { id: "t1", type: "TEXT", name: "T1 字幕", clips: [] }
    ],
    metadata: {
      importedAssets: [
        {
          id: assetRef,
          title: ref.title || "团队镜头",
          type: "VIDEO",
          kind: "VIDEO",
          mimeType: ref.mimeType || "video/mp4",
          sizeBytes: ref.sizeBytes ?? null,
          url: ref.streamUrl,
          createdAt: new Date().toISOString()
        }
      ]
    }
  };
}

async function cleanup() {
  if (created.editingProjectIds.length > 0) await prisma.editingProject.deleteMany({ where: { id: { in: created.editingProjectIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.reviewEventIds.length > 0) await prisma.productionAssetReviewEvent.deleteMany({ where: { id: { in: created.reviewEventIds } } });
  if (created.snapshotIds.length > 0) await prisma.productionAssetSnapshot.deleteMany({ where: { id: { in: created.snapshotIds } } });
  if (created.assetIds.length > 0) await prisma.productionAsset.deleteMany({ where: { id: { in: created.assetIds } } });
  if (created.projectMemberIds.length > 0) await prisma.productionProjectMember.deleteMany({ where: { id: { in: created.projectMemberIds } } });
  if (created.projectIds.length > 0) await prisma.productionProject.deleteMany({ where: { id: { in: created.projectIds } } });
  if (created.mediaAssetIds.length > 0) await prisma.mediaAsset.deleteMany({ where: { id: { in: created.mediaAssetIds } } });
  for (const filePath of created.filePaths) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }
  await prisma.$disconnect();
}

async function main() {
  const user = await findSmokeUser();
  assert(user, "No ACTIVE user found. Log in once or create a user before running this smoke.");

  let shotAsset = await findApprovedShotVideoAsset(user);
  if (!shotAsset && createFixtureWhenMissing) {
    shotAsset = await createTemporaryShotFixture(user);
  }
  assert(
    shotAsset,
    "No APPROVED TEAM SHOT_04 video asset found for the selected user. Save and approve one SHOT_04 video asset first, or keep EDITING_SLASH_SMOKE_CREATE_FIXTURE enabled."
  );
  assert(shotAsset.projectId, "Selected SHOT_04 asset is missing projectId.");
  assert(shotAsset.mediaAssetId, "Selected SHOT_04 asset is missing mediaAssetId.");

  const cookie = await createSession(user.id);

  const slash = await request(`/api/team-projects/${encodeURIComponent(shotAsset.projectId)}/slash-assets/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      fromStage: "EDIT_05",
      assetId: shotAsset.id,
      snapshotId: shotAsset.currentSnapshotId || undefined
    })
  });
  assert(slash.status === 200, `Expected slash resolve 200, got ${slash.status}: ${JSON.stringify(slash.body)}`);
  assert(slash.body?.resolved?.reference?.mediaAssetId === shotAsset.mediaAssetId, "Slash resolve did not return the expected mediaAssetId.");
  assert(typeof slash.body?.resolved?.reference?.streamUrl === "string", "Slash resolve did not return streamUrl.");

  const createProject = await request("/api/editing-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: "Editing Slash Workflow Smoke" })
  });
  assert(createProject.status === 201, `Expected editing project 201, got ${createProject.status}: ${JSON.stringify(createProject.body)}`);
  const editingProjectId = createProject.body?.project?.id;
  assert(typeof editingProjectId === "string", "Expected editing project id.");
  created.editingProjectIds.push(editingProjectId);

  const timeline = buildTimeline(slash.body.resolved);
  const saveTimeline = await request(`/api/editing-projects/${encodeURIComponent(editingProjectId)}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ timeline })
  });
  assert(saveTimeline.status === 200, `Expected timeline save 200, got ${saveTimeline.status}: ${JSON.stringify(saveTimeline.body)}`);

  const readBack = await request(`/api/editing-projects/${encodeURIComponent(editingProjectId)}`, {
    headers: { Cookie: cookie }
  });
  assert(readBack.status === 200, `Expected editing project read 200, got ${readBack.status}: ${JSON.stringify(readBack.body)}`);

  const savedTimeline = readBack.body?.project?.timelineJson;
  const savedClip = savedTimeline?.tracks?.[0]?.clips?.[0];
  const savedImportedAsset = savedTimeline?.metadata?.importedAssets?.[0];
  const expectedAssetRef = productionRef(shotAsset.id, shotAsset.currentSnapshotId);
  assert(savedClip?.assetId === expectedAssetRef, "Saved timeline clip did not keep the production asset reference.");
  assert(savedImportedAsset?.id === expectedAssetRef, "Saved timeline metadata did not keep the imported production asset.");

  console.log(JSON.stringify({
    success: true,
    user: user.email || user.username || user.id,
    projectId: shotAsset.projectId,
    shotAssetId: shotAsset.id,
    mediaAssetId: shotAsset.mediaAssetId,
    editingProjectId,
    clipAssetId: savedClip.assetId,
    durationMs: savedTimeline.durationMs
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
