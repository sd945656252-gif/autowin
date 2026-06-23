import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.PRODUCTION_STALE_REVIEW_SMOKE_BASE_URL || "http://localhost:3000";
const adminEmail = process.env.PRODUCTION_STALE_REVIEW_SMOKE_ADMIN_EMAIL || process.env.PRIMARY_ADMIN_EMAILS?.split(",")[0]?.trim() || "";
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
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
      email: `smoke-stale-owner-${suffix}@example.test`,
      username: `smoke-stale-owner-${suffix}`.slice(0, 40),
      displayName: "Smoke Stale Owner",
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
      userAgent: `production-stale-review-smoke-${label}`
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

  const filename = `production-stale-review-shot-${suffix}.mp4`;
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
      title: "Production stale review smoke shot",
      url: `/uploads/smoke/${filename}`,
      storageKey: `smoke/${filename}`,
      originalName: filename,
      fileHash: crypto.createHash("sha256").update(mp4).digest("hex"),
      mimeType: "video/mp4",
      sizeBytes: mp4.length,
      visibility: "OWNER_ONLY",
      metadata: { smoke: true, purpose: "production-stale-review-smoke" }
    }
  });
  created.mediaAssetIds.push(media.id);

  const project = await prisma.productionProject.create({
    data: {
      name: `Production Stale Review Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "production-stale-review-smoke" }
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
      metadata: { smoke: true, purpose: "production-stale-review-smoke" }
    })
  });
  expectStatus(createAsset, [201], "Create personal production asset");
  const asset = createAsset.body?.asset;
  assert(asset?.id, "Expected personal asset id.");
  created.assetIds.push(asset.id);
  return asset;
}

async function cleanup() {
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

  const submitV1 = await request(`/api/production-assets/${encodeURIComponent(personalAsset.id)}/submit-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ note: "Stale review smoke v1.", frozenPayload: { smoke: true, versionLabel: "v1" } })
  });
  expectStatus(submitV1, [201], "Submit v1 review");
  const staleSnapshot = submitV1.body?.snapshot;
  assert(staleSnapshot?.id, "Expected v1 stale snapshot id.");
  created.snapshotIds.push(staleSnapshot.id);

  const replacementSnapshot = await prisma.productionAssetSnapshot.create({
    data: {
      assetId: personalAsset.id,
      version: staleSnapshot.version + 1,
      reviewStatus: "IN_REVIEW",
      createdById: owner.id,
      mediaAssetId: fixture.media.id,
      originalName: fixture.filename,
      displayName: "Smoke Stale Owner 智能出片 03镜头设计 current replacement",
      frozenPayload: { smoke: true, versionLabel: "replacement-current" },
      frozenStorageObjectKey: fixture.media.storageKey,
      mimeType: "video/mp4",
      sizeBytes: fixture.sizeBytes,
      reviewNote: "Replacement current snapshot."
    }
  });
  created.snapshotIds.push(replacementSnapshot.id);
  await prisma.productionAsset.update({
    where: { id: personalAsset.id },
    data: {
      reviewStatus: "IN_REVIEW",
      version: replacementSnapshot.version,
      currentSnapshotId: replacementSnapshot.id
    }
  });

  const staleApprove = await request(`/api/internal-assets/${encodeURIComponent(staleSnapshot.id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "This stale snapshot must not approve." })
  });
  expectStatus(staleApprove, [409], "Approve stale snapshot");
  assert(staleApprove.body?.code === "STALE_REVIEW_SNAPSHOT", `Unexpected stale approve code: ${JSON.stringify(staleApprove.body)}`);

  const staleReject = await request(`/api/internal-assets/${encodeURIComponent(staleSnapshot.id)}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "This stale snapshot must not reject." })
  });
  expectStatus(staleReject, [409], "Reject stale snapshot");
  assert(staleReject.body?.code === "STALE_REVIEW_SNAPSHOT", `Unexpected stale reject code: ${JSON.stringify(staleReject.body)}`);

  const currentApprove = await request(`/api/internal-assets/${encodeURIComponent(replacementSnapshot.id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "Current snapshot may approve." })
  });
  expectStatus(currentApprove, [200], "Approve current replacement snapshot");
  const teamAsset = currentApprove.body?.teamAsset;
  assert(teamAsset?.id && teamAsset?.sourceId === replacementSnapshot.id, "Expected current replacement snapshot to publish a team asset.");
  created.assetIds.push(teamAsset.id);

  const staleAfter = await prisma.productionAssetSnapshot.findUnique({ where: { id: staleSnapshot.id }, select: { reviewStatus: true, reviewedAt: true } });
  assert(staleAfter?.reviewStatus === "IN_REVIEW" && !staleAfter.reviewedAt, `Stale snapshot should remain unreviewed: ${JSON.stringify(staleAfter)}`);

  console.log(JSON.stringify({
    success: true,
    admin: admin.email || admin.username || admin.id,
    owner: owner.email,
    projectId: fixture.project.id,
    personalAssetId: personalAsset.id,
    staleSnapshotId: staleSnapshot.id,
    currentSnapshotId: replacementSnapshot.id,
    teamAssetId: teamAsset.id,
    checked: {
      staleApprove: staleApprove.status,
      staleApproveCode: staleApprove.body?.code,
      staleReject: staleReject.status,
      staleRejectCode: staleReject.body?.code,
      currentApprove: currentApprove.status,
      staleSnapshotStatusAfter: staleAfter.reviewStatus
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
