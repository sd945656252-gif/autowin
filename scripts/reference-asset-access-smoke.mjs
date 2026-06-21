import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.REFERENCE_ASSET_SMOKE_BASE_URL || "http://localhost:3000";
const adminEmail = process.env.REFERENCE_ASSET_SMOKE_ADMIN_EMAIL || process.env.PRIMARY_ADMIN_EMAILS?.split(",")[0]?.trim() || "";
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  grantIds: [],
  visibilityIds: [],
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

async function createUser(label) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `smoke-reference-${label}-${suffix}@example.test`,
      username: `smoke-reference-${label}-${suffix}`.slice(0, 40),
      displayName: `Smoke Reference ${label}`,
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
      userAgent: `reference-asset-access-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function createProject(owner, member) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.productionProject.create({
    data: {
      name: `Reference Asset Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "reference-asset-access-smoke" }
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
  return project;
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

function fixturePng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
}

async function uploadReference(adminCookie, input) {
  const form = new FormData();
  form.append("projectId", input.projectId);
  form.append("stage", "ART_03");
  form.append("title", input.title);
  form.append("visibleUserIds", JSON.stringify(input.visibleUserIds));
  form.append("file", new Blob([fixturePng()], { type: "image/png" }), `${input.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
  return request("/api/internal-assets/reference", {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: form
  });
}

async function rememberReferenceAsset(assetId) {
  const asset = await prisma.productionAsset.findUnique({ where: { id: assetId }, include: { mediaAsset: true, referenceVisibilities: true } });
  assert(asset, `Reference asset not found after upload: ${assetId}`);
  created.assetIds.push(asset.id);
  if (asset.mediaAssetId) created.mediaAssetIds.push(asset.mediaAssetId);
  created.visibilityIds.push(...asset.referenceVisibilities.map((item) => item.id));
  if (asset.mediaAsset?.storageKey) created.uploadStorageKeys.push(asset.mediaAsset.storageKey);
  return asset;
}

async function cleanup() {
  if (created.visibilityIds.length > 0) await prisma.productionAssetReferenceVisibility.deleteMany({ where: { id: { in: created.visibilityIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.grantIds.length > 0) await prisma.productionProjectRoleGrant.deleteMany({ where: { id: { in: created.grantIds } } });
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
  const project = await createProject(owner, member);
  await addReviewer(project.id, admin.id, owner.id);

  const invalidUpload = await uploadReference(adminCookie, {
    projectId: project.id,
    title: "Reference smoke invalid distribution",
    visibleUserIds: [member.id, intruder.id]
  });
  expectStatus(invalidUpload, [403], "Upload reference with non-member visibility");
  assert(invalidUpload.body?.code === "REFERENCE_VISIBILITY_PROJECT_MEMBERS_ONLY", `Unexpected invalid upload code: ${JSON.stringify(invalidUpload.body)}`);

  const validUpload = await uploadReference(adminCookie, {
    projectId: project.id,
    title: "Reference smoke valid distribution",
    visibleUserIds: [member.id]
  });
  expectStatus(validUpload, [201], "Upload reference for project member");
  const referenceAsset = await rememberReferenceAsset(validUpload.body?.asset?.id);
  assert(referenceAsset.reviewStatus === "REFERENCE", `Expected REFERENCE asset: ${JSON.stringify(referenceAsset)}`);

  const referenceUrl = `/api/production-assets/${encodeURIComponent(referenceAsset.id)}/stream`;
  const mediaUrl = `/api/media/assets/${encodeURIComponent(referenceAsset.mediaAssetId)}/stream`;

  const memberReference = await request(referenceUrl, { headers: { Cookie: memberCookie } });
  expectStatus(memberReference, [200], "Visible member reference stream");

  const ownerReference = await request(referenceUrl, { headers: { Cookie: ownerCookie } });
  expectStatus(ownerReference, [404], "Project owner without explicit reference visibility");

  const intruderReference = await request(referenceUrl, { headers: { Cookie: intruderCookie } });
  expectStatus(intruderReference, [404], "Intruder reference stream");

  const memberMedia = await request(mediaUrl, { headers: { Cookie: memberCookie } });
  expectStatus(memberMedia, [404], "Visible member direct media stream");

  const intruderMedia = await request(mediaUrl, { headers: { Cookie: intruderCookie } });
  expectStatus(intruderMedia, [404], "Intruder direct media stream");

  const adminReference = await request(referenceUrl, { headers: { Cookie: adminCookie } });
  expectStatus(adminReference, [404], "Admin without explicit reference visibility");

  await prisma.productionAsset.update({
    where: { id: referenceAsset.id },
    data: { reviewStatus: "ARCHIVED", archivedAt: new Date() }
  });

  const memberReferenceAfterArchive = await request(referenceUrl, { headers: { Cookie: memberCookie } });
  expectStatus(memberReferenceAfterArchive, [404], "Visible member reference stream after archive");

  console.log(JSON.stringify({
    success: true,
    admin: admin.email || admin.username || admin.id,
    owner: owner.email,
    member: member.email,
    intruder: intruder.email,
    projectId: project.id,
    referenceAssetId: referenceAsset.id,
    mediaAssetId: referenceAsset.mediaAssetId,
    checked: {
      invalidUpload: invalidUpload.status,
      invalidUploadCode: invalidUpload.body?.code,
      validUpload: validUpload.status,
      memberReference: memberReference.status,
      ownerReference: ownerReference.status,
      intruderReference: intruderReference.status,
      memberMedia: memberMedia.status,
      intruderMedia: intruderMedia.status,
      adminReferenceWithoutVisibility: adminReference.status,
      memberReferenceAfterArchive: memberReferenceAfterArchive.status
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
