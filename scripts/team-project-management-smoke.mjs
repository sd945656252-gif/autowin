import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.TEAM_PROJECT_MANAGEMENT_SMOKE_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();
const created = { sessionIds: [], projectIds: [], userIds: [] };

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
      email: `team-project-${label}-${suffix}@example.test`,
      username: `team-project-${label}-${suffix}`.slice(0, 40),
      displayName: `Team Project ${label}`,
      role,
      status: "ACTIVE",
      emailVerified: true
    }
  });
  created.userIds.push(user.id);
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      userAgent: `team-project-management-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return { user, cookie: `jiying_session=${encodeURIComponent(token)}` };
}

async function createProject(cookie, payload, label) {
  const response = await request("/api/team-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload)
  });
  expectStatus(response, [201], label);
  assert(response.body?.project?.id, `${label} should return project.`);
  created.projectIds.push(response.body.project.id);
  return response.body.project;
}

async function cleanup() {
  if (created.projectIds.length > 0) {
    await prisma.productionAssetReviewEvent.deleteMany({ where: { asset: { projectId: { in: created.projectIds } } } });
    await prisma.productionAssetSnapshot.deleteMany({ where: { asset: { projectId: { in: created.projectIds } } } });
    await prisma.productionAsset.deleteMany({ where: { projectId: { in: created.projectIds } } });
    await prisma.productionProjectRoleGrant.deleteMany({ where: { projectId: { in: created.projectIds } } });
    await prisma.productionProjectMember.deleteMany({ where: { projectId: { in: created.projectIds } } });
    await prisma.productionProject.deleteMany({ where: { id: { in: created.projectIds } } });
  }
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.$disconnect();
}

async function main() {
  const [owner, memberA, memberB, memberC] = await Promise.all([
    createUser("owner"),
    createUser("member-a"),
    createUser("member-b"),
    createUser("member-c")
  ]);

  const personalProject = await createProject(owner.cookie, {
    name: "Smoke Personal Film",
    projectKind: "PERSONAL",
    workflowType: "film",
    description: "personal project smoke"
  }, "Create personal project");

  const teamProject = await createProject(owner.cookie, {
    name: "Smoke Team Film",
    projectKind: "TEAM",
    workflowType: "film",
    description: "team project smoke"
  }, "Create team project");

  const personalList = await request("/api/team-projects?projectKind=PERSONAL", { headers: { Cookie: owner.cookie } });
  expectStatus(personalList, [200], "List personal projects");
  assert(personalList.body.projects.some((project) => project.id === personalProject.id), "Personal list should include personal project.");
  assert(!personalList.body.projects.some((project) => project.id === teamProject.id), "Personal list should not include team project.");

  const teamList = await request("/api/team-projects?projectKind=TEAM", { headers: { Cookie: owner.cookie } });
  expectStatus(teamList, [200], "List team projects");
  assert(teamList.body.projects.some((project) => project.id === teamProject.id), "Team list should include team project.");
  assert(!teamList.body.projects.some((project) => project.id === personalProject.id), "Team list should not include personal project.");

  const renamed = await request(`/api/team-projects/${encodeURIComponent(personalProject.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ name: "Smoke Personal Film Renamed" })
  });
  expectStatus(renamed, [200], "Rename personal project");
  assert(renamed.body.project.name === "Smoke Personal Film Renamed", "Rename should persist.");

  const deleted = await request(`/api/team-projects/${encodeURIComponent(personalProject.id)}`, {
    method: "DELETE",
    headers: { Cookie: owner.cookie }
  });
  expectStatus(deleted, [200], "Delete personal project");

  for (const target of [memberA, memberB, memberC]) {
    const added = await request(`/api/team-projects/${encodeURIComponent(teamProject.id)}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ userId: target.user.id, role: "MEMBER" })
    });
    expectStatus(added, [201], `Add ${target.user.displayName}`);
  }

  const firstGrant = await request(`/api/team-projects/${encodeURIComponent(teamProject.id)}/team-leaders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ userId: memberA.user.id })
  });
  expectStatus(firstGrant, [201], "Grant first member as team leader");

  const blockedGrant = await request(`/api/team-projects/${encodeURIComponent(teamProject.id)}/team-leaders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ userId: memberB.user.id })
  });
  expectStatus(blockedGrant, [409], "Block third team leader");

  const swapped = await request(`/api/team-projects/${encodeURIComponent(teamProject.id)}/team-leaders/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ fromUserId: memberA.user.id, toUserId: memberB.user.id })
  });
  expectStatus(swapped, [200], "Swap team leader");

  const members = await request(`/api/team-projects/${encodeURIComponent(teamProject.id)}/members`, { headers: { Cookie: owner.cookie } });
  expectStatus(members, [200], "Read team members after swap");
  const memberAAfter = members.body.members.find((member) => member.userId === memberA.user.id);
  const memberBAfter = members.body.members.find((member) => member.userId === memberB.user.id);
  assert(memberAAfter?.teamRole !== "TEAM_LEADER", "Swapped-out member should no longer be team leader.");
  assert(memberBAfter?.teamRole === "TEAM_LEADER", "Swapped-in member should be team leader.");

  const stillBlockedGrant = await request(`/api/team-projects/${encodeURIComponent(teamProject.id)}/team-leaders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: owner.cookie },
    body: JSON.stringify({ userId: memberC.user.id })
  });
  expectStatus(stillBlockedGrant, [409], "Keep two team leader limit after swap");

  console.log(JSON.stringify({
    success: true,
    checked: {
      personalProjectSeparated: true,
      teamProjectSeparated: true,
      renameProject: renamed.body.project.name,
      deleteProject: deleted.body.deleted,
      blockedThirdLeader: blockedGrant.status,
      swappedLeader: memberBAfter.userId,
      blockedAfterSwap: stillBlockedGrant.status
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
