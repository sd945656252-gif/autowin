import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.MEDIA_STREAM_SMOKE_BASE_URL || "http://localhost:3000";
const adminEmail = process.env.MEDIA_STREAM_SMOKE_ADMIN_EMAIL || process.env.PRIMARY_ADMIN_EMAILS?.split(",")[0]?.trim() || "";
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
  uploadStorageKeys: []
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

async function createUser(label) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `smoke-media-${label}-${suffix}@example.test`,
      username: `smoke-media-${label}-${suffix}`.slice(0, 40),
      displayName: `Smoke Media ${label}`,
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
      userAgent: `media-stream-access-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

function fixtureMp4() {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74
  ]);
}

async function createUploadedMedia(ownerCookie) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const filename = `media-stream-access-${suffix}.mp4`;
  const mp4 = fixtureMp4();
  const form = new FormData();
  form.append("file", new Blob([mp4], { type: "video/mp4" }), filename);
  const upload = await request("/api/media/upload", {
    method: "POST",
    headers: { Cookie: ownerCookie },
    body: form
  });
  expectStatus(upload, [200], "Upload media fixture");
  const mediaAssetId = upload.body?.assetId;
  assert(typeof mediaAssetId === "string", `Expected uploaded media asset id: ${JSON.stringify(upload.body)}`);

  const media = await prisma.mediaAsset.update({
    where: { id: mediaAssetId },
    data: {
      title: "Media stream access smoke",
      originalName: filename,
      fileHash: crypto.createHash("sha256").update(mp4).digest("hex"),
      metadata: { smoke: true, purpose: "media-stream-access-smoke", originalName: filename, storage: "local" }
    }
  });
  created.mediaAssetIds.push(media.id);
  if (media.storageKey) created.uploadStorageKeys.push(media.storageKey);
  return { media, filename, sizeBytes: mp4.length };
}

async function createProjectAndMedia(owner, member, ownerCookie) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const upload = await createUploadedMedia(ownerCookie);
  const project = await prisma.productionProject.create({
    data: {
      name: `Media Stream Access Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "media-stream-access-smoke" }
    }
  });
  created.projectIds.push(project.id);

  const memberships = await prisma.productionProjectMember.createManyAndReturn({
    data: [
      { projectId: project.id, userId: owner.id, role: "OWNER" },
      { projectId: project.id, userId: member.id, role: "MEMBER" }
    ]
  });
  created.projectMemberIds.push(...memberships.map((item) => item.id));

  return { project, ...upload };
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
      metadata: { smoke: true, purpose: "media-stream-access-smoke" }
    })
  });
  expectStatus(createAsset, [201], "Create personal production asset");
  const personalAsset = createAsset.body?.asset;
  assert(personalAsset?.id, "Expected personal asset id.");
  created.assetIds.push(personalAsset.id);
  return personalAsset;
}

async function publishTeamAsset(input) {
  const submit = await request(`/api/production-assets/${encodeURIComponent(input.personalAsset.id)}/submit-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: input.ownerCookie },
    body: JSON.stringify({ note: "Media stream access submit.", frozenPayload: { smoke: true } })
  });
  expectStatus(submit, [201], "Submit production asset review");
  const snapshot = submit.body?.snapshot;
  assert(snapshot?.id, "Expected review snapshot id.");
  created.snapshotIds.push(snapshot.id);

  const approve = await request(`/api/internal-assets/${encodeURIComponent(snapshot.id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: input.adminCookie },
    body: JSON.stringify({ note: "Media stream access approve." })
  });
  expectStatus(approve, [200], "Approve production asset");
  const teamAsset = approve.body?.teamAsset;
  assert(teamAsset?.id && teamAsset?.currentSnapshotId, "Expected approved team asset.");
  created.assetIds.push(teamAsset.id);
  return teamAsset;
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
  for (const storageKey of created.uploadStorageKeys) {
    if (!storageKey || storageKey.includes("..") || storageKey.includes("/") || storageKey.includes("\\")) continue;
    spawnSync("podman", ["exec", "jiying_jiying-web_1", "rm", "-f", `/app/uploads/${storageKey}`], { stdio: "ignore" });
  }
  await prisma.$disconnect();
}

async function main() {
  const admin = await findAdmin();
  assert(admin, "No ACTIVE ADMIN user found. Set PRIMARY_ADMIN_EMAILS or create an admin before running this smoke.");
  const [owner, member, intruder] = await Promise.all([
    createUser("owner"),
    createUser("member"),
    createUser("intruder")
  ]);
  const [adminCookie, ownerCookie, memberCookie, intruderCookie] = await Promise.all([
    createSession(admin.id, "admin"),
    createSession(owner.id, "owner"),
    createSession(member.id, "member"),
    createSession(intruder.id, "intruder")
  ]);
  const fixture = await createProjectAndMedia(owner, member, ownerCookie);
  await addReviewer(fixture.project.id, admin.id, owner.id);
  const personalAsset = await createPersonalAsset(ownerCookie, fixture);
  const teamAsset = await publishTeamAsset({ personalAsset, ownerCookie, adminCookie });

  const mediaUrl = `/api/media/assets/${encodeURIComponent(fixture.media.id)}/stream`;
  const productionUrl = `/api/production-assets/${encodeURIComponent(teamAsset.id)}/stream?snapshotId=${encodeURIComponent(teamAsset.currentSnapshotId)}`;

  const ownerMedia = await request(mediaUrl, { headers: { Cookie: ownerCookie } });
  expectStatus(ownerMedia, [200], "Owner direct media stream");

  const memberMedia = await request(mediaUrl, { headers: { Cookie: memberCookie } });
  expectStatus(memberMedia, [404], "Project member direct media stream");

  const intruderMedia = await request(mediaUrl, { headers: { Cookie: intruderCookie } });
  expectStatus(intruderMedia, [404], "Intruder direct media stream");

  const memberProduction = await request(productionUrl, { headers: { Cookie: memberCookie } });
  expectStatus(memberProduction, [200], "Project member production stream before archive");

  const intruderProduction = await request(productionUrl, { headers: { Cookie: intruderCookie } });
  expectStatus(intruderProduction, [404], "Intruder production stream before archive");

  const archive = await request(`/api/internal-assets/${encodeURIComponent(teamAsset.id)}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "Media stream access archive." })
  });
  expectStatus(archive, [200], "Archive team asset");

  const memberProductionAfterArchive = await request(productionUrl, { headers: { Cookie: memberCookie } });
  expectStatus(memberProductionAfterArchive, [404], "Project member production stream after archive");

  const memberMediaAfterArchive = await request(mediaUrl, { headers: { Cookie: memberCookie } });
  expectStatus(memberMediaAfterArchive, [404], "Project member direct media stream after archive");

  console.log(JSON.stringify({
    success: true,
    admin: admin.email || admin.username || admin.id,
    owner: owner.email,
    member: member.email,
    intruder: intruder.email,
    projectId: fixture.project.id,
    mediaAssetId: fixture.media.id,
    teamAssetId: teamAsset.id,
    checked: {
      ownerMedia: ownerMedia.status,
      memberMedia: memberMedia.status,
      intruderMedia: intruderMedia.status,
      memberProduction: memberProduction.status,
      intruderProduction: intruderProduction.status,
      archive: archive.status,
      memberProductionAfterArchive: memberProductionAfterArchive.status,
      memberMediaAfterArchive: memberMediaAfterArchive.status
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
