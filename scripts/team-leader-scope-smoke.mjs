import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.TEAM_LEADER_SCOPE_SMOKE_BASE_URL || process.env.PROJECT_DEVELOPER_SCOPE_SMOKE_BASE_URL || "http://localhost:3000";
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
      email: `team-leader-${label}-${suffix}@example.test`,
      username: `team-leader-${label}-${suffix}`.slice(0, 40),
      displayName: `Team Leader ${label}`,
      role,
      status: "ACTIVE",
      emailVerified: true
    }
  });
  created.userIds.push(user.id);
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000), userAgent: `team-leader-scope-smoke-${label}` }
  });
  created.sessionIds.push(session.id);
  return { user, cookie: `jiying_session=${encodeURIComponent(token)}` };
}

async function createProject(owner, label) {
  const project = await prisma.productionProject.create({
    data: { name: `Team Leader Scope ${label}`, createdById: owner.id, metadata: { smoke: true } }
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
  const [owner, teamLeader, globalDeveloper] = await Promise.all([createUser("owner"), createUser("leader"), createUser("global-dev", "DEVELOPER")]);
  const projectA = await createProject(owner.user, "A");
  const projectB = await createProject(owner.user, "B");
  const [snapshotA, snapshotB] = await Promise.all([
    createPendingSnapshot(projectA, owner.user, "project-a"),
    createPendingSnapshot(projectB, owner.user, "project-b")
  ]);

  const addMember = await request(`/api/team-projects/${encodeURIComponent(projectA.id)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ userId: teamLeader.user.id, role: "MEMBER" })
  });
  expectStatus(addMember, [201], "Owner adds team member");
  if (addMember.body?.member?.id) created.projectMemberIds.push(addMember.body.member.id);

  const grant = await request(`/api/team-projects/${encodeURIComponent(projectA.id)}/team-leaders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ userId: teamLeader.user.id })
  });
  expectStatus(grant, [201], "Owner grants team leader");
  if (grant.body?.grant?.id) created.grantIds.push(grant.body.grant.id);

  const me = await request("/api/auth/me", { headers: { Cookie: teamLeader.cookie } });
  expectStatus(me, [200], "Team leader me");
  assert(me.body?.user?.role === "USER", "Team leader must remain a normal USER globally.");
  assert(me.body?.user?.capabilities?.developer === false, "Team leader must not get global developer capability.");
  assert((me.body?.user?.projectRoles?.teamLeaderGrants || []).some((item) => item.projectId === projectA.id), "Team leader grant should be visible in /api/auth/me.");

  const projectAInternal = await request(`/api/team-projects/${encodeURIComponent(projectA.id)}/assets?view=review&reviewStatus=IN_REVIEW`, { headers: { Cookie: teamLeader.cookie } });
  expectStatus(projectAInternal, [200], "Team leader reads own project review assets");
  assert(projectAInternal.body?.canManage === true, "Team leader should have project asset management capability.");
  assert((projectAInternal.body?.items || []).some((item) => item.id === snapshotA.id), "Team leader should see project A pending snapshot.");

  const projectBInternal = await request(`/api/team-projects/${encodeURIComponent(projectB.id)}/assets?view=review&reviewStatus=IN_REVIEW`, { headers: { Cookie: teamLeader.cookie } });
  expectStatus(projectBInternal, [404], "Team leader cannot read other project review assets");
  const globalDeveloperProjectAReview = await request(`/api/team-projects/${encodeURIComponent(projectA.id)}/assets?view=review&reviewStatus=IN_REVIEW`, { headers: { Cookie: globalDeveloper.cookie } });
  expectStatus(globalDeveloperProjectAReview, [404], "Global developer without project membership cannot read project review assets");
  const globalDeveloperTeamAssets = await request(`/api/production-assets/team?projectId=${encodeURIComponent(projectA.id)}&stage=SCRIPT_01`, { headers: { Cookie: globalDeveloper.cookie } });
  expectStatus(globalDeveloperTeamAssets, [404], "Global developer without project membership cannot read team assets");

  const developerMedia = await request("/api/developer/media", { headers: { Cookie: teamLeader.cookie } });
  expectStatus(developerMedia, [403], "Team leader cannot access global developer media");
  const developerHealth = await request("/api/developer/system/health", { headers: { Cookie: teamLeader.cookie } });
  expectStatus(developerHealth, [403], "Team leader cannot access system monitoring");

  console.log(JSON.stringify({
    success: true,
    checked: {
      meRole: me.body.user.role,
      globalDeveloperCapability: me.body.user.capabilities.developer,
      projectAInternal: projectAInternal.status,
      projectBInternal: projectBInternal.status,
      globalDeveloperProjectAReview: globalDeveloperProjectAReview.status,
      globalDeveloperTeamAssets: globalDeveloperTeamAssets.status,
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
