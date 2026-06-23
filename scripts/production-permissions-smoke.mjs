import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.PRODUCTION_PERMISSIONS_SMOKE_BASE_URL || "http://localhost:3000";
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
  userIds: [],
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
  return { status: response.status, body };
}

async function createUser(label) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `smoke-${label}-${suffix}@example.test`,
      username: `smoke-${label}-${suffix}`.slice(0, 40),
      displayName: `Smoke ${label}`,
      role: "USER",
      status: "ACTIVE",
      emailVerified: true
    }
  });
  created.userIds.push(user.id);
  return user;
}

async function createSession(userId, label) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      userAgent: `production-permissions-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function createShotFixture(owner) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const fixtureDir = path.join(uploadsDir, "smoke");
  fs.mkdirSync(fixtureDir, { recursive: true });

  const filename = `production-permissions-shot-${suffix}.mp4`;
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
      ownerId: owner.id,
      createdById: owner.id,
      type: "VIDEO",
      title: "Production permissions smoke shot",
      url: `/uploads/smoke/${filename}`,
      storageKey: `smoke/${filename}`,
      originalName: filename,
      fileHash: crypto.createHash("sha256").update(mp4).digest("hex"),
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      visibility: "OWNER_ONLY",
      metadata: { smoke: true, purpose: "production-permissions-smoke" }
    }
  });
  created.mediaAssetIds.push(media.id);

  const project = await prisma.productionProject.create({
    data: {
      name: `Production Permissions Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "production-permissions-smoke" }
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

  const asset = await prisma.productionAsset.create({
    data: {
      projectId: project.id,
      stage: "SHOT_04",
      scope: "TEAM",
      reviewStatus: "APPROVED",
      creatorId: owner.id,
      submitterId: owner.id,
      reviewerId: owner.id,
      mediaAssetId: media.id,
      originalName: filename,
      displayName: "Production permissions smoke shot",
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      sourceType: "smoke_fixture",
      metadata: { smoke: true, purpose: "production-permissions-smoke" }
    }
  });
  created.assetIds.push(asset.id);

  const snapshot = await prisma.productionAssetSnapshot.create({
    data: {
      assetId: asset.id,
      version: 1,
      reviewStatus: "APPROVED",
      createdById: owner.id,
      reviewedById: owner.id,
      mediaAssetId: media.id,
      originalName: filename,
      displayName: "Production permissions smoke shot",
      frozenPayload: { mediaAssetId: media.id, smoke: true },
      frozenStorageObjectKey: media.storageKey,
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      reviewNote: "Temporary permissions smoke fixture.",
      reviewedAt: new Date()
    }
  });
  created.snapshotIds.push(snapshot.id);

  await prisma.productionAsset.update({ where: { id: asset.id }, data: { currentSnapshotId: snapshot.id } });

  const event = await prisma.productionAssetReviewEvent.create({
    data: {
      assetId: asset.id,
      snapshotId: snapshot.id,
      actorId: owner.id,
      action: "APPROVE",
      note: "Temporary production permissions smoke fixture.",
      metadata: { smoke: true }
    }
  });
  created.reviewEventIds.push(event.id);

  return { project, asset: { ...asset, currentSnapshotId: snapshot.id }, media, snapshot };
}

function buildForgedTimeline(assetId, snapshotId) {
  const productionRef = `production:${assetId}:${snapshotId}`;
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
            id: "forged-production-permissions-clip",
            assetId: productionRef,
            kind: "VIDEO",
            name: "Forged team shot",
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
          id: productionRef,
          title: "Forged team shot",
          type: "VIDEO",
          kind: "VIDEO",
          mimeType: "video/mp4",
          sizeBytes: 32,
          url: `/api/production-assets/${assetId}/stream?snapshotId=${encodeURIComponent(snapshotId)}`,
          createdAt: new Date().toISOString()
        }
      ]
    }
  };
}

function expectStatus(response, allowed, label) {
  assert(allowed.includes(response.status), `${label} expected ${allowed.join("/")} but got ${response.status}: ${JSON.stringify(response.body)}`);
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
  if (created.userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  for (const filePath of created.filePaths) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }
  await prisma.$disconnect();
}

async function main() {
  const [owner, intruder] = await Promise.all([createUser("owner"), createUser("intruder")]);
  const [ownerCookie, intruderCookie] = await Promise.all([
    createSession(owner.id, "owner"),
    createSession(intruder.id, "intruder")
  ]);
  const fixture = await createShotFixture(owner);

  const ownerResolve = await request(`/api/team-projects/${encodeURIComponent(fixture.project.id)}/slash-assets/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({
      fromStage: "EDIT_05",
      assetId: fixture.asset.id,
      snapshotId: fixture.asset.currentSnapshotId
    })
  });
  expectStatus(ownerResolve, [200], "Owner slash resolve");

  const intruderList = await request(`/api/team-projects/${encodeURIComponent(fixture.project.id)}/slash-assets?fromStage=EDIT_05`, {
    headers: { Cookie: intruderCookie }
  });
  expectStatus(intruderList, [404], "Intruder slash list");

  const intruderResolve = await request(`/api/team-projects/${encodeURIComponent(fixture.project.id)}/slash-assets/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: intruderCookie },
    body: JSON.stringify({
      fromStage: "EDIT_05",
      assetId: fixture.asset.id,
      snapshotId: fixture.asset.currentSnapshotId
    })
  });
  expectStatus(intruderResolve, [404], "Intruder slash resolve");

  const createEditing = await request("/api/editing-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: intruderCookie },
    body: JSON.stringify({ title: "Production Permissions Smoke Editing" })
  });
  expectStatus(createEditing, [201], "Intruder editing project create");
  const editingProjectId = createEditing.body?.project?.id;
  assert(typeof editingProjectId === "string", "Expected intruder editing project id.");
  created.editingProjectIds.push(editingProjectId);

  const forgedSave = await request(`/api/editing-projects/${encodeURIComponent(editingProjectId)}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: intruderCookie },
    body: JSON.stringify({ timeline: buildForgedTimeline(fixture.asset.id, fixture.asset.currentSnapshotId) })
  });
  expectStatus(forgedSave, [404], "Intruder forged editing timeline save");
  assert(forgedSave.body?.code === "EDITING_PRODUCTION_ASSET_NOT_ACCESSIBLE", `Unexpected forged save error code: ${JSON.stringify(forgedSave.body)}`);

  console.log(JSON.stringify({
    success: true,
    owner: owner.email,
    intruder: intruder.email,
    projectId: fixture.project.id,
    assetId: fixture.asset.id,
    checked: {
      ownerSlashResolve: ownerResolve.status,
      intruderSlashList: intruderList.status,
      intruderSlashResolve: intruderResolve.status,
      intruderForgedTimelineSave: forgedSave.status,
      forgedTimelineErrorCode: forgedSave.body?.code
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
