import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.TEAM_ASSET_LIBRARY_SMOKE_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  userIds: [],
  projectIds: [],
  assetIds: [],
  mediaAssetIds: [],
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
  const body = Buffer.from(await response.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    json = null;
  }
  return { status: response.status, body, json, headers: response.headers };
}

async function createUser(label, role = "USER") {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const user = await prisma.user.create({
    data: {
      email: `team-asset-library-${label}-${suffix}@example.test`,
      username: `team-asset-library-${label}-${suffix}`.slice(0, 40),
      displayName: `Team Asset Library ${label}`,
      role,
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
      userAgent: `team-asset-library-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function createTeamAsset(owner) {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const fixtureDir = path.join(uploadsDir, "smoke");
  fs.mkdirSync(fixtureDir, { recursive: true });

  const filename = `team-asset-library-${suffix}.png`;
  const filePath = path.join(fixtureDir, filename);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  fs.writeFileSync(filePath, png);
  created.filePaths.push(filePath);

  const media = await prisma.mediaAsset.create({
    data: {
      ownerId: owner.id,
      createdById: owner.id,
      type: "IMAGE",
      title: "Team asset library smoke image",
      url: `/uploads/smoke/${filename}`,
      storageKey: `smoke/${filename}`,
      originalName: filename,
      fileHash: crypto.createHash("sha256").update(png).digest("hex"),
      mimeType: "image/png",
      sizeBytes: png.length,
      visibility: "OWNER_ONLY",
      metadata: { smoke: true, purpose: "team-asset-library-smoke" }
    }
  });
  created.mediaAssetIds.push(media.id);

  const project = await prisma.productionProject.create({
    data: {
      name: `Team Asset Library Smoke ${suffix}`,
      createdById: owner.id,
      metadata: { smoke: true, purpose: "team-asset-library-smoke" }
    }
  });
  created.projectIds.push(project.id);

  await prisma.productionProjectMember.create({
    data: {
      projectId: project.id,
      userId: owner.id,
      role: "OWNER"
    }
  });

  const asset = await prisma.productionAsset.create({
    data: {
      projectId: project.id,
      stage: "ART_03",
      scope: "TEAM",
      reviewStatus: "APPROVED",
      creatorId: owner.id,
      submitterId: owner.id,
      reviewerId: owner.id,
      mediaAssetId: media.id,
      originalName: filename,
      displayName: "Team asset library smoke image",
      description: "Visible in global developer asset library",
      mimeType: "image/png",
      sizeBytes: png.length,
      metadata: { smoke: true, purpose: "team-asset-library-smoke" }
    },
    include: { project: true }
  });
  created.assetIds.push(asset.id);
  return asset;
}

async function cleanup() {
  if (created.assetIds.length > 0) {
    await prisma.productionAssetReviewEvent.deleteMany({ where: { assetId: { in: created.assetIds } } });
    await prisma.productionAssetSnapshot.deleteMany({ where: { assetId: { in: created.assetIds } } });
    await prisma.productionAsset.deleteMany({ where: { id: { in: created.assetIds } } });
  }
  if (created.projectIds.length > 0) {
    await prisma.productionProjectMember.deleteMany({ where: { projectId: { in: created.projectIds } } });
    await prisma.productionProject.deleteMany({ where: { id: { in: created.projectIds } } });
  }
  if (created.mediaAssetIds.length > 0) await prisma.mediaAsset.deleteMany({ where: { id: { in: created.mediaAssetIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  for (const filePath of created.filePaths) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }
  await prisma.$disconnect();
}

async function main() {
  const owner = await createUser("owner");
  const admin = await createUser("admin", "ADMIN");
  const outsider = await createUser("outsider");
  const adminCookie = await createSession(admin.id, "admin");
  const outsiderCookie = await createSession(outsider.id, "outsider");
  const asset = await createTeamAsset(owner);

  const unauthorized = await request("/api/production-assets/team-library", { headers: { Cookie: outsiderCookie } });
  assert(unauthorized.status === 403, `Non-developer library access should be 403, got ${unauthorized.status}.`);

  const library = await request("/api/production-assets/team-library?type=image&stage=ART_03", { headers: { Cookie: adminCookie } });
  assert(library.status === 200, `Library expected 200, got ${library.status}: ${library.body.toString("utf8")}`);
  assert(library.json?.assets?.some((item) => item.id === asset.id), "Library should include approved team asset.");

  const stream = await request(`/api/production-assets/${encodeURIComponent(asset.id)}/stream`, { headers: { Cookie: adminCookie } });
  assert(stream.status === 200, `Stream expected 200, got ${stream.status}.`);
  assert(stream.headers.get("content-type")?.startsWith("image/png"), "Stream should return image/png.");
  assert(stream.body.length > 0, "Stream body should not be empty.");

  console.log(JSON.stringify({
    success: true,
    checked: {
      globalLibraryListsTeamAssets: true,
      nonDeveloperForbidden: true,
      adminCanStreamTeamAsset: true,
      assetId: asset.id
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(cleanup);
