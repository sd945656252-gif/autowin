import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.EDITING_ARCHIVED_REFERENCE_SMOKE_BASE_URL || "http://localhost:3000";
const adminEmail = process.env.EDITING_ARCHIVED_REFERENCE_SMOKE_ADMIN_EMAIL || process.env.PRIMARY_ADMIN_EMAILS?.split(",")[0]?.trim() || "";
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  editingProjectIds: [],
  reviewEventIds: [],
  grantIds: [],
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
  return { status: response.status, body, headers: response.headers };
}

function expectStatus(response, allowed, label) {
  assert(allowed.includes(response.status), `${label} expected ${allowed.join("/")} but got ${response.status}: ${JSON.stringify(response.body)}`);
}

async function findAdmin() {
  if (adminEmail) {
    const user = await prisma.user.findUnique({ where: { email: adminEmail.toLowerCase() } });
    if (user?.status === "ACTIVE" && user.role === "ADMIN") return user;
  }
  return prisma.user.findFirst({ where: { status: "ACTIVE", role: "ADMIN" }, orderBy: { createdAt: "asc" } });
}

async function createOwner() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `smoke-editing-archived-owner-${suffix}@example.test`,
      username: `smoke-editing-archived-owner-${suffix}`.slice(0, 40),
      displayName: "Smoke Editing Archived Owner",
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
      userAgent: `editing-archived-reference-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function createProjectAndMedia(owner) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const fixtureDir = path.join(uploadsDir, "smoke");
  fs.mkdirSync(fixtureDir, { recursive: true });

  const filename = `editing-archived-reference-${suffix}.mp4`;
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
      title: "Editing archived reference smoke shot",
      url: `/uploads/smoke/${filename}`,
      storageKey: `smoke/${filename}`,
      originalName: filename,
      fileHash: crypto.createHash("sha256").update(mp4).digest("hex"),
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      visibility: "OWNER_ONLY",
      metadata: { smoke: true, purpose: "editing-archived-reference-smoke" }
    }
  });
  created.mediaAssetIds.push(media.id);

  const project = await prisma.productionProject.create({
    data: {
      name: `Editing Archived Reference Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "editing-archived-reference-smoke" }
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

  return { project, media, filename, sizeBytes: mp4.length };
}

async function addReviewer(projectId, userId, grantedById) {
  const member = await prisma.productionProjectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId, role: "MEMBER" },
    update: { role: "MEMBER" }
  });
  created.projectMemberIds.push(member.id);

  const grant = await prisma.productionProjectRoleGrant.create({
    data: {
      projectId,
      userId,
      role: "PROJECT_DEVELOPER",
      grantedById
    }
  });
  created.grantIds.push(grant.id);
}

function productionRef(assetId, snapshotId) {
  return `production:${assetId}:${snapshotId || ""}`;
}

function buildTimeline(teamAsset, streamUrl) {
  const ref = productionRef(teamAsset.id, teamAsset.currentSnapshotId);
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
            id: "editing-archived-reference-clip",
            assetId: ref,
            kind: "VIDEO",
            name: teamAsset.displayName || "团队镜头",
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
          id: ref,
          title: teamAsset.displayName || "团队镜头",
          type: "VIDEO",
          kind: "VIDEO",
          mimeType: teamAsset.mimeType || "video/mp4",
          sizeBytes: teamAsset.sizeBytes ?? null,
          url: streamUrl,
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
  if (created.grantIds.length > 0) await prisma.productionProjectRoleGrant.deleteMany({ where: { id: { in: created.grantIds } } });
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
  const admin = await findAdmin();
  assert(admin, "No ACTIVE ADMIN user found. Set PRIMARY_ADMIN_EMAILS or create an admin before running this smoke.");
  const owner = await createOwner();
  const [adminCookie, ownerCookie] = await Promise.all([
    createSession(admin.id, "admin"),
    createSession(owner.id, "owner")
  ]);
  const fixture = await createProjectAndMedia(owner);
  await addReviewer(fixture.project.id, admin.id, owner.id);

  const createAsset = await request("/api/production-assets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({
      projectId: fixture.project.id,
      stage: "SHOT_04",
      originalName: fixture.filename,
      mediaAssetId: fixture.media.id,
      mimeType: "video/mp4",
      sizeBytes: fixture.sizeBytes,
      sourceType: "smoke_fixture",
      metadata: { smoke: true, purpose: "editing-archived-reference-smoke" }
    })
  });
  expectStatus(createAsset, [201], "Create personal production asset");
  const personalAsset = createAsset.body?.asset;
  assert(personalAsset?.id, "Expected personal asset id.");
  created.assetIds.push(personalAsset.id);

  const submitReview = await request(`/api/production-assets/${encodeURIComponent(personalAsset.id)}/submit-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ note: "Editing archived reference smoke submit." })
  });
  expectStatus(submitReview, [201], "Submit asset review");
  const snapshot = submitReview.body?.snapshot;
  assert(snapshot?.id, "Expected review snapshot id.");
  created.snapshotIds.push(snapshot.id);

  const approve = await request(`/api/internal-assets/${encodeURIComponent(snapshot.id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "Editing archived reference smoke approve." })
  });
  expectStatus(approve, [200], "Approve internal asset snapshot");
  const teamAsset = approve.body?.teamAsset;
  assert(teamAsset?.id && teamAsset?.currentSnapshotId, "Expected approved team asset.");
  created.assetIds.push(teamAsset.id);

  const resolve = await request(`/api/team-projects/${encodeURIComponent(fixture.project.id)}/slash-assets/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({
      fromStage: "EDIT_05",
      assetId: teamAsset.id,
      snapshotId: teamAsset.currentSnapshotId
    })
  });
  expectStatus(resolve, [200], "Resolve approved team asset before archive");
  const streamUrl = resolve.body?.resolved?.reference?.streamUrl;
  assert(typeof streamUrl === "string", "Expected resolved streamUrl.");

  const createEditing = await request("/api/editing-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ title: "Editing Archived Reference Smoke" })
  });
  expectStatus(createEditing, [201], "Create editing project");
  const editingProjectId = createEditing.body?.project?.id;
  assert(typeof editingProjectId === "string", "Expected editing project id.");
  created.editingProjectIds.push(editingProjectId);

  const timeline = buildTimeline(teamAsset, streamUrl);
  const expectedClipAssetId = productionRef(teamAsset.id, teamAsset.currentSnapshotId);
  const firstSave = await request(`/api/editing-projects/${encodeURIComponent(editingProjectId)}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ timeline })
  });
  expectStatus(firstSave, [200], "Save timeline before archive");

  const archive = await request(`/api/internal-assets/${encodeURIComponent(teamAsset.id)}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "Editing archived reference smoke archive." })
  });
  expectStatus(archive, [200], "Archive team asset after timeline save");

  const secondSave = await request(`/api/editing-projects/${encodeURIComponent(editingProjectId)}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ timeline })
  });
  expectStatus(secondSave, [404], "Save timeline after team asset archive");
  assert(secondSave.body?.code === "EDITING_PRODUCTION_ASSET_NOT_ACCESSIBLE", `Unexpected stale timeline error code: ${JSON.stringify(secondSave.body)}`);
  assert(secondSave.body?.details?.assetId === expectedClipAssetId, `Expected stale details.assetId ${expectedClipAssetId}, got ${JSON.stringify(secondSave.body?.details)}`);

  console.log(JSON.stringify({
    success: true,
    admin: admin.email || admin.username || admin.id,
    owner: owner.email,
    projectId: fixture.project.id,
    personalAssetId: personalAsset.id,
    snapshotId: snapshot.id,
    teamAssetId: teamAsset.id,
    editingProjectId,
    staleClipAssetId: secondSave.body.details.assetId,
    checked: {
      firstTimelineSave: firstSave.status,
      archive: archive.status,
      secondTimelineSave: secondSave.status,
      staleErrorCode: secondSave.body.code
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
