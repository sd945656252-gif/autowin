import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.PRODUCTION_VERSION_SMOKE_BASE_URL || "http://localhost:3000";
const adminEmail = process.env.PRODUCTION_VERSION_SMOKE_ADMIN_EMAIL || process.env.PRIMARY_ADMIN_EMAILS?.split(",")[0]?.trim() || "";
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
  return { status: response.status, body };
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
      email: `smoke-version-owner-${suffix}@example.test`,
      username: `smoke-version-owner-${suffix}`.slice(0, 40),
      displayName: "Smoke Version Owner",
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
      userAgent: `production-version-lifecycle-smoke-${label}`
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

  const filename = `production-version-shot-${suffix}.mp4`;
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
      title: "Production version lifecycle smoke shot",
      url: `/uploads/smoke/${filename}`,
      storageKey: `smoke/${filename}`,
      originalName: filename,
      fileHash: crypto.createHash("sha256").update(mp4).digest("hex"),
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      visibility: "OWNER_ONLY",
      metadata: { smoke: true, purpose: "production-version-lifecycle-smoke" }
    }
  });
  created.mediaAssetIds.push(media.id);

  const project = await prisma.productionProject.create({
    data: {
      name: `Production Version Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "production-version-lifecycle-smoke" }
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

async function createPersonalAsset(ownerCookie, fixture) {
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
      metadata: { smoke: true, purpose: "production-version-lifecycle-smoke" }
    })
  });
  expectStatus(createAsset, [201], "Create personal production asset");
  const personalAsset = createAsset.body?.asset;
  assert(personalAsset?.id, "Expected personal asset id.");
  created.assetIds.push(personalAsset.id);
  return personalAsset;
}

async function submitAndApproveVersion(input) {
  const submit = await request(`/api/production-assets/${encodeURIComponent(input.personalAssetId)}/submit-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: input.ownerCookie },
    body: JSON.stringify({
      note: `Version smoke submit ${input.versionLabel}.`,
      frozenPayload: { smoke: true, versionLabel: input.versionLabel }
    })
  });
  expectStatus(submit, [201], `Submit ${input.versionLabel}`);
  const snapshot = submit.body?.snapshot;
  assert(snapshot?.id, `Expected ${input.versionLabel} snapshot id.`);
  created.snapshotIds.push(snapshot.id);

  const approve = await request(`/api/internal-assets/${encodeURIComponent(snapshot.id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: input.adminCookie },
    body: JSON.stringify({ note: `Version smoke approve ${input.versionLabel}.` })
  });
  expectStatus(approve, [200], `Approve ${input.versionLabel}`);
  const teamAsset = approve.body?.teamAsset;
  assert(teamAsset?.id && teamAsset?.currentSnapshotId, `Expected ${input.versionLabel} team asset.`);
  created.assetIds.push(teamAsset.id);
  return { snapshot, teamAsset };
}

function timelineFor(teamAsset, label) {
  const ref = `production:${teamAsset.id}:${teamAsset.currentSnapshotId || ""}`;
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
            id: `version-${label}-clip`,
            assetId: ref,
            kind: "VIDEO",
            name: `Version ${label} team shot`,
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
          title: `Version ${label} team shot`,
          type: "VIDEO",
          kind: "VIDEO",
          mimeType: teamAsset.mimeType || "video/mp4",
          sizeBytes: teamAsset.sizeBytes ?? null,
          url: `/api/production-assets/${teamAsset.id}/stream?snapshotId=${encodeURIComponent(teamAsset.currentSnapshotId || "")}`,
          createdAt: new Date().toISOString()
        }
      ]
    }
  };
}

async function createEditingProject(ownerCookie, label) {
  const createEditing = await request("/api/editing-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ title: `Production Version Lifecycle Smoke ${label}` })
  });
  expectStatus(createEditing, [201], `Create editing project ${label}`);
  const id = createEditing.body?.project?.id;
  assert(typeof id === "string", `Expected editing project id ${label}.`);
  created.editingProjectIds.push(id);
  return id;
}

async function saveTimeline(ownerCookie, editingProjectId, teamAsset, label) {
  return request(`/api/editing-projects/${encodeURIComponent(editingProjectId)}/timeline`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ timeline: timelineFor(teamAsset, label) })
  });
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
  const personalAsset = await createPersonalAsset(ownerCookie, fixture);

  const v1 = await submitAndApproveVersion({ personalAssetId: personalAsset.id, ownerCookie, adminCookie, versionLabel: "v1" });
  const v1Resolve = await request(`/api/team-projects/${encodeURIComponent(fixture.project.id)}/slash-assets/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ fromStage: "EDIT_05", assetId: v1.teamAsset.id, snapshotId: v1.teamAsset.currentSnapshotId })
  });
  expectStatus(v1Resolve, [200], "Resolve v1 before v2 approval");

  const v2 = await submitAndApproveVersion({ personalAssetId: personalAsset.id, ownerCookie, adminCookie, versionLabel: "v2" });

  const v1After = await prisma.productionAsset.findUnique({ where: { id: v1.teamAsset.id }, select: { reviewStatus: true, archivedAt: true } });
  assert(v1After?.reviewStatus === "ARCHIVED" && v1After.archivedAt, `Expected v1 team asset archived after v2 approval: ${JSON.stringify(v1After)}`);

  const teamList = await request(`/api/production-assets/team?projectId=${encodeURIComponent(fixture.project.id)}&stage=SHOT_04`, {
    headers: { Cookie: ownerCookie }
  });
  expectStatus(teamList, [200], "Team asset list after v2 approval");
  const listedIds = (teamList.body?.assets || []).map((asset) => asset.id);
  assert(!listedIds.includes(v1.teamAsset.id), "Superseded v1 team asset is still listed.");
  assert(listedIds.includes(v2.teamAsset.id), "Latest v2 team asset is not listed.");

  const v1ResolveAfter = await request(`/api/team-projects/${encodeURIComponent(fixture.project.id)}/slash-assets/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ fromStage: "EDIT_05", assetId: v1.teamAsset.id, snapshotId: v1.teamAsset.currentSnapshotId })
  });
  expectStatus(v1ResolveAfter, [404], "Resolve superseded v1 team asset");

  const v2Resolve = await request(`/api/team-projects/${encodeURIComponent(fixture.project.id)}/slash-assets/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ fromStage: "EDIT_05", assetId: v2.teamAsset.id, snapshotId: v2.teamAsset.currentSnapshotId })
  });
  expectStatus(v2Resolve, [200], "Resolve latest v2 team asset");

  const v1EditingProjectId = await createEditingProject(ownerCookie, "v1");
  const v1Save = await saveTimeline(ownerCookie, v1EditingProjectId, v1.teamAsset, "v1");
  expectStatus(v1Save, [404], "Save timeline with superseded v1 team asset");
  assert(v1Save.body?.code === "EDITING_PRODUCTION_ASSET_NOT_ACCESSIBLE", `Unexpected v1 save error: ${JSON.stringify(v1Save.body)}`);

  const v2EditingProjectId = await createEditingProject(ownerCookie, "v2");
  const v2Save = await saveTimeline(ownerCookie, v2EditingProjectId, v2.teamAsset, "v2");
  expectStatus(v2Save, [200], "Save timeline with latest v2 team asset");

  console.log(JSON.stringify({
    success: true,
    admin: admin.email || admin.username || admin.id,
    owner: owner.email,
    projectId: fixture.project.id,
    personalAssetId: personalAsset.id,
    v1: {
      snapshotId: v1.snapshot.id,
      teamAssetId: v1.teamAsset.id,
      afterV2Status: v1After.reviewStatus
    },
    v2: {
      snapshotId: v2.snapshot.id,
      teamAssetId: v2.teamAsset.id
    },
    checked: {
      v1ResolveBeforeV2: v1Resolve.status,
      v1ResolveAfterV2: v1ResolveAfter.status,
      v2Resolve: v2Resolve.status,
      v1TimelineSave: v1Save.status,
      v2TimelineSave: v2Save.status
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
