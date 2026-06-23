import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.PROJECT_DEVELOPER_SCOPE_SMOKE_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();
const created = { sessionIds: [], grantIds: [], snapshotIds: [], assetIds: [], projectMemberIds: [], projectIds: [], mediaAssetIds: [], userIds: [] };

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
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

function expectStatus(response, allowed, label) {
  assert(allowed.includes(response.status), `${label} expected ${allowed.join("/")} but got ${response.status}: ${JSON.stringify(response.body)}`);
}

async function createUser(label, role = "USER") {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const user = await prisma.user.create({
    data: {
      email: `project-dev-${label}-${suffix}@example.test`,
      username: `project-dev-${label}-${suffix}`.slice(0, 40),
      displayName: `Project Dev ${label}`,
      role,
      status: "ACTIVE",
      emailVerified: true
    }
  });
  created.userIds.push(user.id);
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000), userAgent: `project-developer-scope-smoke-${label}` }
  });
  created.sessionIds.push(session.id);
  return { user, cookie: `jiying_session=${encodeURIComponent(token)}` };
}

async function createProject(owner, label) {
  const project = await prisma.productionProject.create({
    data: { name: `Project Developer Scope ${label}`, createdById: owner.id, metadata: { smoke: true } }
  });
  created.projectIds.push(project.id);
  const ownerMember = await prisma.productionProjectMember.create({
    data: { projectId: project.id, userId: owner.id, role: "OWNER" }
  });
  created.projectMemberIds.push(ownerMember.id);
  return project;
}

async function createPendingSnapshot(project, owner, label) {
  const asset = await prisma.productionAsset.create({
    data: {
      projectId: project.id,
      stage: "SCRIPT_01",
      scope: "PERSONAL",
      reviewStatus: "IN_REVIEW",
      creatorId: owner.id,
      submitterId: owner.id,
      originalName: `${label}.txt`,
      displayName: `${label} pending review`,
      mimeType: "text/plain",
      sourcePayload: { text: `${label} content` },
      metadata: { smoke: true }
    }
  });
  created.assetIds.push(asset.id);
  const snapshot = await prisma.productionAssetSnapshot.create({
    data: {
      assetId: asset.id,
      version: 1,
      reviewStatus: "IN_REVIEW",
      createdById: owner.id,
      originalName: asset.originalName,
      displayName: asset.displayName,
      frozenPayload: { text: `${label} content` },
      mimeType: "text/plain"
    }
  });
  created.snapshotIds.push(snapshot.id);
  await prisma.productionAsset.update({ where: { id: asset.id }, data: { currentSnapshotId: snapshot.id } });
  return snapshot;
}

async function cleanup() {
  if (created.assetIds.length > 0) await prisma.productionAssetReviewEvent.deleteMany({ where: { assetId: { in: created.assetIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.grantIds.length > 0) await prisma.productionProjectRoleGrant.deleteMany({ where: { id: { in: created.grantIds } } });
  if (created.snapshotIds.length > 0) await prisma.productionAssetSnapshot.deleteMany({ where: { id: { in: created.snapshotIds } } });
  if (created.assetIds.length > 0) await prisma.productionAsset.deleteMany({ where: { id: { in: created.assetIds } } });
  if (created.projectMemberIds.length > 0) await prisma.productionProjectMember.deleteMany({ where: { id: { in: created.projectMemberIds } } });
  if (created.projectIds.length > 0) await prisma.productionProject.deleteMany({ where: { id: { in: created.projectIds } } });
  if (created.userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.$disconnect();
}

async function main() {
  const [owner, tempDeveloper] = await Promise.all([createUser("owner"), createUser("temp")]);
  const projectA = await createProject(owner.user, "A");
  const projectB = await createProject(owner.user, "B");
  const [snapshotA, snapshotB] = await Promise.all([
    createPendingSnapshot(projectA, owner.user, "project-a"),
    createPendingSnapshot(projectB, owner.user, "project-b")
  ]);

  const addMember = await request(`/api/team-projects/${encodeURIComponent(projectA.id)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ userId: tempDeveloper.user.id, role: "MEMBER" })
  });
  expectStatus(addMember, [201], "Owner adds team member");
  if (addMember.body?.member?.id) created.projectMemberIds.push(addMember.body.member.id);

  const grant = await request(`/api/team-projects/${encodeURIComponent(projectA.id)}/developers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ userId: tempDeveloper.user.id })
  });
  expectStatus(grant, [201], "Owner grants project developer");
  if (grant.body?.grant?.id) created.grantIds.push(grant.body.grant.id);

  const me = await request("/api/auth/me", { headers: { Cookie: tempDeveloper.cookie } });
  expectStatus(me, [200], "Temp developer me");
  assert(me.body?.user?.role === "USER", "Project developer must remain a normal USER globally.");
  assert(me.body?.user?.capabilities?.developer === false, "Project developer must not get global developer capability.");
  assert((me.body?.user?.projectRoles?.projectDeveloperGrants || []).some((item) => item.projectId === projectA.id), "Project developer grant should be visible in /api/auth/me.");

  const projectAInternal = await request(`/api/internal-assets?reviewStatus=IN_REVIEW&projectId=${encodeURIComponent(projectA.id)}`, { headers: { Cookie: tempDeveloper.cookie } });
  expectStatus(projectAInternal, [200], "Temp developer reads own project internal assets");
  assert((projectAInternal.body?.items || []).some((item) => item.id === snapshotA.id), "Temp developer should see project A pending snapshot.");

  const projectBInternal = await request(`/api/internal-assets?reviewStatus=IN_REVIEW&projectId=${encodeURIComponent(projectB.id)}`, { headers: { Cookie: tempDeveloper.cookie } });
  expectStatus(projectBInternal, [403], "Temp developer cannot read other project internal assets");
  const allInternal = await request("/api/internal-assets?reviewStatus=IN_REVIEW", { headers: { Cookie: tempDeveloper.cookie } });
  expectStatus(allInternal, [200], "Temp developer reads scoped internal assets");
  assert((allInternal.body?.items || []).some((item) => item.id === snapshotA.id), "Scoped internal list should include project A.");
  assert(!(allInternal.body?.items || []).some((item) => item.id === snapshotB.id), "Scoped internal list must not include project B.");

  const developerMedia = await request("/api/developer/media", { headers: { Cookie: tempDeveloper.cookie } });
  expectStatus(developerMedia, [403], "Temp developer cannot access global developer media");
  const developerHealth = await request("/api/developer/system/health", { headers: { Cookie: tempDeveloper.cookie } });
  expectStatus(developerHealth, [403], "Temp developer cannot access system monitoring");

  console.log(JSON.stringify({
    success: true,
    checked: {
      meRole: me.body.user.role,
      globalDeveloperCapability: me.body.user.capabilities.developer,
      projectAInternal: projectAInternal.status,
      projectBInternal: projectBInternal.status,
      scopedCount: allInternal.body.items.length,
      developerMedia: developerMedia.status,
      developerHealth: developerHealth.status
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
