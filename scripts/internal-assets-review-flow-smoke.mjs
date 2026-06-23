import crypto from "node:crypto";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.INTERNAL_ASSETS_REVIEW_FLOW_SMOKE_BASE_URL || "http://localhost:3000";
const adminEmail = process.env.INTERNAL_ASSETS_REVIEW_FLOW_SMOKE_ADMIN_EMAIL || process.env.PRIMARY_ADMIN_EMAILS?.split(",")[0]?.trim() || "";
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
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

function localDateStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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
      email: `smoke-internal-assets-owner-${suffix}@example.test`,
      username: `smoke-internal-assets-owner-${suffix}`.slice(0, 40),
      displayName: "Smoke Internal Assets Owner",
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
      userAgent: `internal-assets-review-flow-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function uploadSmokeMedia(ownerCookie, filename, content) {
  const form = new FormData();
  form.append("key", "internal-assets-review-flow");
  form.append("file", new Blob([content], { type: "text/plain" }), filename);
  const upload = await fetch(`${baseUrl}/api/media/upload`, {
    method: "POST",
    headers: { Cookie: ownerCookie },
    body: form
  });
  const body = await upload.json().catch(() => ({}));
  expectStatus({ status: upload.status, body }, [200], "Upload smoke media");
  assert(body?.assetId, `Expected uploaded media asset id: ${JSON.stringify(body)}`);
  created.mediaAssetIds.push(body.assetId);
  return body;
}

async function createProject(owner) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.productionProject.create({
    data: {
      name: `Internal Assets Review Flow Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "internal-assets-review-flow-smoke" }
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

  return { project, suffix };
}

async function addLeader(projectId, userId) {
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
      role: "PROJECT_DEVELOPER"
    }
  });
  created.grantIds.push(grant.id);
}

async function createPersonalAsset(ownerCookie, fixture, label) {
  const sourcePayload = label === "file-preview-path" ? undefined : { text: `${label} source payload` };
  const createAsset = await request("/api/production-assets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({
      projectId: fixture.project.id,
      stage: "SCRIPT_01",
      originalName: `${label}-${fixture.filename}`,
      mediaAssetId: fixture.media.id,
      mimeType: "text/plain",
      sizeBytes: fixture.sizeBytes,
      sourceType: "smoke_fixture",
      ...(sourcePayload ? { sourcePayload } : {}),
      metadata: { smoke: true, purpose: "internal-assets-review-flow-smoke", label }
    })
  });
  expectStatus(createAsset, [201], `Create ${label} personal production asset`);
  const asset = createAsset.body?.asset;
  assert(asset?.id, `Expected ${label} personal asset id.`);
  created.assetIds.push(asset.id);
  return asset;
}

async function submitReview(ownerCookie, personalAsset, label) {
  const reviewBody = label === "file-preview-path"
    ? { note: `${label} submit.` }
    : {
        note: `${label} submit.`,
        frozenPayload: { text: `${label} frozen payload`, smoke: true }
      };
  const submit = await request(`/api/production-assets/${encodeURIComponent(personalAsset.id)}/submit-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify(reviewBody)
  });
  expectStatus(submit, [201], `Submit ${label} review`);
  const snapshot = submit.body?.snapshot;
  assert(snapshot?.id && snapshot.reviewStatus === "IN_REVIEW", `Expected ${label} IN_REVIEW snapshot: ${JSON.stringify(submit.body)}`);
  created.snapshotIds.push(snapshot.id);
  return snapshot;
}

async function assertTeamAssetPresence(ownerCookie, projectId, assetId, expected, label) {
  const list = await request(`/api/production-assets/team?projectId=${encodeURIComponent(projectId)}&stage=SCRIPT_01`, {
    headers: { Cookie: ownerCookie }
  });
  expectStatus(list, [200], `${label} team asset list`);
  const found = (list.body?.assets || []).some((asset) => asset.id === assetId);
  assert(found === expected, `${label} team asset presence expected ${expected} but got ${found}: ${JSON.stringify(list.body)}`);
}

async function cleanup() {
  if (created.assetIds.length > 0) await prisma.productionAssetReviewEvent.deleteMany({ where: { assetId: { in: created.assetIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
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
  const fixture = await createProject(owner);
  const filename = `internal-assets-review-flow-${fixture.suffix}.txt`;
  const content = `Internal assets review flow smoke ${fixture.suffix}`;
  const media = await uploadSmokeMedia(ownerCookie, filename, content);
  fixture.media = { id: media.assetId };
  fixture.filename = filename;
  fixture.sizeBytes = Buffer.byteLength(content);
  await addLeader(fixture.project.id, admin.id);

  const rejectedPersonal = await createPersonalAsset(ownerCookie, fixture, "reject-path");
  const rejectedSnapshot = await submitReview(ownerCookie, rejectedPersonal, "reject-path");

  const deleteInReview = await request(`/api/production-assets/${encodeURIComponent(rejectedPersonal.id)}`, {
    method: "DELETE",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(deleteInReview, [409], "Delete IN_REVIEW personal asset");
  assert(deleteInReview.body?.code === "ASSET_IN_REVIEW_DELETE_FORBIDDEN", `Unexpected in-review delete code: ${JSON.stringify(deleteInReview.body)}`);

  const internalPending = await request(`/api/internal-assets?reviewStatus=IN_REVIEW&projectId=${encodeURIComponent(fixture.project.id)}`, {
    headers: { Cookie: adminCookie }
  });
  expectStatus(internalPending, [200], "List internal pending review snapshots");
  assert((internalPending.body?.items || []).some((item) => item.id === rejectedSnapshot.id && item.kind === "snapshot"), "Pending snapshot should remain in internal asset review queue.");
  const pendingRejectedItem = (internalPending.body?.items || []).find((item) => item.id === rejectedSnapshot.id);
  assert(
    String(pendingRejectedItem?.displayName || "").startsWith(`${localDateStamp()} Smoke Internal Assets Owner 智能出片 01剧本 `),
    `Internal asset display name should use local date naming format: ${JSON.stringify(pendingRejectedItem)}`
  );

  const reject = await request(`/api/internal-assets/${encodeURIComponent(rejectedSnapshot.id)}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "Smoke reject path." })
  });
  expectStatus(reject, [200], "Reject internal asset snapshot");
  assert(reject.body?.asset?.reviewStatus === "REJECTED", `Expected rejected personal asset: ${JSON.stringify(reject.body)}`);

  const rejectedTeamCandidates = await prisma.productionAsset.findMany({
    where: {
      projectId: fixture.project.id,
      scope: "TEAM",
      metadata: { path: ["personalAssetId"], equals: rejectedPersonal.id }
    }
  });
  assert(rejectedTeamCandidates.length === 0, `Rejected review created team assets: ${JSON.stringify(rejectedTeamCandidates)}`);

  const deleteRejected = await request(`/api/production-assets/${encodeURIComponent(rejectedPersonal.id)}`, {
    method: "DELETE",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(deleteRejected, [200], "Delete REJECTED personal asset");
  assert(deleteRejected.body?.asset?.deletedAt, `Expected rejected personal asset soft-deleted: ${JSON.stringify(deleteRejected.body)}`);

  const approvedPersonal = await createPersonalAsset(ownerCookie, fixture, "approve-path");
  const approvedSnapshot = await submitReview(ownerCookie, approvedPersonal, "approve-path");
  const approve = await request(`/api/internal-assets/${encodeURIComponent(approvedSnapshot.id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "Smoke approve path." })
  });
  expectStatus(approve, [200], "Approve internal asset snapshot");
  const teamAsset = approve.body?.teamAsset;
  assert(teamAsset?.id && teamAsset.reviewStatus === "APPROVED" && teamAsset.scope === "TEAM", `Expected approved TEAM asset: ${JSON.stringify(approve.body)}`);
  created.assetIds.push(teamAsset.id);

  await assertTeamAssetPresence(ownerCookie, fixture.project.id, teamAsset.id, true, "Approved");

  const filePreviewPersonal = await createPersonalAsset(ownerCookie, fixture, "file-preview-path");
  const filePreviewSnapshot = await submitReview(ownerCookie, filePreviewPersonal, "file-preview-path");
  const filePreviewList = await request(`/api/internal-assets?reviewStatus=IN_REVIEW&projectId=${encodeURIComponent(fixture.project.id)}`, {
    headers: { Cookie: adminCookie }
  });
  expectStatus(filePreviewList, [200], "List file-backed text preview snapshot");
  const filePreviewItem = (filePreviewList.body?.items || []).find((item) => item.id === filePreviewSnapshot.id);
  assert(
    filePreviewItem?.snapshot?.payloadPreview?.includes("Internal assets review flow smoke"),
    `Expected text file content preview from uploaded file: ${JSON.stringify(filePreviewItem)}`
  );
  const rejectFilePreview = await request(`/api/internal-assets/${encodeURIComponent(filePreviewSnapshot.id)}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ note: "Smoke file preview cleanup reject." })
  });
  expectStatus(rejectFilePreview, [200], "Reject file preview snapshot");

  const deleteApprovedPersonal = await request(`/api/production-assets/${encodeURIComponent(approvedPersonal.id)}`, {
    method: "DELETE",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(deleteApprovedPersonal, [409], "Delete APPROVED personal asset");
  assert(deleteApprovedPersonal.body?.code === "ASSET_DELETE_STATUS_FORBIDDEN", `Unexpected approved personal delete code: ${JSON.stringify(deleteApprovedPersonal.body)}`);

  const deleteTeamAsset = await request(`/api/production-assets/${encodeURIComponent(teamAsset.id)}`, {
    method: "DELETE",
    headers: { Cookie: ownerCookie }
  });
  expectStatus(deleteTeamAsset, [403], "Delete TEAM asset through personal delete endpoint");
  assert(deleteTeamAsset.body?.code === "ASSET_DELETE_SCOPE_FORBIDDEN", `Unexpected team delete code: ${JSON.stringify(deleteTeamAsset.body)}`);

  await assertTeamAssetPresence(ownerCookie, fixture.project.id, teamAsset.id, true, "After forbidden delete");

  console.log(JSON.stringify({
    success: true,
    admin: admin.email || admin.username || admin.id,
    owner: owner.email,
    projectId: fixture.project.id,
    rejectedPersonalAssetId: rejectedPersonal.id,
    rejectedSnapshotId: rejectedSnapshot.id,
    approvedPersonalAssetId: approvedPersonal.id,
    approvedSnapshotId: approvedSnapshot.id,
    filePreviewSnapshotId: filePreviewSnapshot.id,
    teamAssetId: teamAsset.id,
    checked: {
      deleteInReview: deleteInReview.status,
      deleteInReviewCode: deleteInReview.body?.code,
      internalPending: internalPending.status,
      reject: reject.status,
      rejectedTeamAssetCount: rejectedTeamCandidates.length,
      deleteRejected: deleteRejected.status,
      approve: approve.status,
      filePreview: filePreviewList.status,
      deleteApprovedPersonal: deleteApprovedPersonal.status,
      deleteApprovedPersonalCode: deleteApprovedPersonal.body?.code,
      deleteTeamAsset: deleteTeamAsset.status,
      deleteTeamAssetCode: deleteTeamAsset.body?.code
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
