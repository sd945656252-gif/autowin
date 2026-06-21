import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.VIDEO_SLASH_SMOKE_BASE_URL || "http://localhost:3000";
const userEmail = process.env.VIDEO_SLASH_SMOKE_USER_EMAIL || process.env.PRIMARY_ADMIN_EMAILS?.split(",")[0]?.trim() || "";
const createFixtureWhenMissing = process.env.VIDEO_SLASH_SMOKE_CREATE_FIXTURE !== "0";
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  configIds: [],
  profileIds: [],
  revisionIds: [],
  runIds: [],
  reviewEventIds: [],
  snapshotIds: [],
  assetIds: [],
  projectMemberIds: [],
  projectIds: [],
  mediaAssetIds: [],
  filePaths: []
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || Buffer.byteLength(raw, "utf8") < 32) {
    throw new Error("ENCRYPTION_KEY must be configured with at least 32 bytes.");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function findSmokeUser() {
  if (userEmail) {
    const user = await prisma.user.findUnique({ where: { email: userEmail.toLowerCase() } });
    if (user?.status === "ACTIVE") return user;
  }
  const admin = await prisma.user.findFirst({ where: { status: "ACTIVE", role: { in: ["ADMIN", "DEVELOPER"] } }, orderBy: { createdAt: "asc" } });
  if (admin) return admin;
  return prisma.user.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      userAgent: "video-slash-workflow-smoke"
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function findApprovedArtImageAsset(user) {
  const membershipProjectIds = user.role === "ADMIN" || user.role === "DEVELOPER"
    ? null
    : (await prisma.productionProjectMember.findMany({ where: { userId: user.id }, select: { projectId: true } })).map((item) => item.projectId);

  return prisma.productionAsset.findFirst({
    where: {
      stage: "ART_03",
      scope: "TEAM",
      reviewStatus: "APPROVED",
      deletedAt: null,
      mediaAssetId: { not: null },
      mimeType: { startsWith: "image/" },
      ...(membershipProjectIds ? { projectId: { in: membershipProjectIds } } : {})
    },
    include: {
      project: true,
      mediaAsset: true
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function createTemporaryArtFixture(user) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
  const fixtureDir = path.join(uploadsDir, "smoke");
  fs.mkdirSync(fixtureDir, { recursive: true });

  const filename = `video-slash-art-${suffix}.png`;
  const filePath = path.join(fixtureDir, filename);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  fs.writeFileSync(filePath, png);
  created.filePaths.push(filePath);

  const media = await prisma.mediaAsset.create({
    data: {
      ownerId: user.id,
      createdById: user.id,
      type: "IMAGE",
      title: "Video slash workflow smoke art",
      url: `/uploads/smoke/${filename}`,
      storageKey: `smoke/${filename}`,
      originalName: filename,
      fileHash: crypto.createHash("sha256").update(png).digest("hex"),
      mimeType: "image/png",
      sizeBytes: png.length,
      visibility: "OWNER_ONLY",
      metadata: { smoke: true, purpose: "video-slash-workflow" }
    }
  });
  created.mediaAssetIds.push(media.id);

  const project = await prisma.productionProject.create({
    data: {
      name: `Video Slash Smoke ${suffix}`,
      createdById: user.id,
      metadata: { smoke: true, purpose: "video-slash-workflow" }
    }
  });
  created.projectIds.push(project.id);

  const member = await prisma.productionProjectMember.create({
    data: {
      projectId: project.id,
      userId: user.id,
      role: "OWNER"
    }
  });
  created.projectMemberIds.push(member.id);

  const reviewedAt = new Date();
  const asset = await prisma.productionAsset.create({
    data: {
      projectId: project.id,
      stage: "ART_03",
      scope: "TEAM",
      reviewStatus: "APPROVED",
      creatorId: user.id,
      submitterId: user.id,
      reviewerId: user.id,
      mediaAssetId: media.id,
      originalName: filename,
      displayName: "Video slash workflow smoke art",
      mimeType: "image/png",
      sizeBytes: png.length,
      sourceType: "smoke_fixture",
      metadata: { smoke: true, purpose: "video-slash-workflow" }
    }
  });
  created.assetIds.push(asset.id);

  const snapshot = await prisma.productionAssetSnapshot.create({
    data: {
      assetId: asset.id,
      version: 1,
      reviewStatus: "APPROVED",
      createdById: user.id,
      reviewedById: user.id,
      mediaAssetId: media.id,
      originalName: filename,
      displayName: "Video slash workflow smoke art",
      frozenPayload: { mediaAssetId: media.id, smoke: true },
      frozenStorageObjectKey: media.storageKey,
      mimeType: "image/png",
      sizeBytes: png.length,
      reviewNote: "Temporary smoke fixture.",
      reviewedAt
    }
  });
  created.snapshotIds.push(snapshot.id);

  await prisma.productionAsset.update({
    where: { id: asset.id },
    data: { currentSnapshotId: snapshot.id }
  });

  const event = await prisma.productionAssetReviewEvent.create({
    data: {
      assetId: asset.id,
      snapshotId: snapshot.id,
      actorId: user.id,
      action: "APPROVE",
      note: "Temporary video slash smoke fixture.",
      metadata: { smoke: true }
    }
  });
  created.reviewEventIds.push(event.id);

  return prisma.productionAsset.findUnique({
    where: { id: asset.id },
    include: { project: true, mediaAsset: true }
  });
}

function videoCapabilityParams() {
  return {
    videoCapabilities: {
      modes: ["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"],
      defaultMode: "text_to_video",
      inputSlots: {
        firstFrame: { enabled: true },
        lastFrame: { enabled: true },
        referenceImages: { enabled: true, maxCount: 4 },
        sourceVideo: { enabled: false },
        referenceVideo: { enabled: false },
        audio: { enabled: false }
      },
      controls: {
        prompt: true,
        negativePrompt: false,
        duration: [5],
        aspectRatio: ["16:9"],
        resolution: ["720P"],
        fps: [24],
        cameraControl: false,
        motionStrength: false,
        seed: false,
        generateAudio: false
      },
      limits: {
        maxInputImages: 4,
        maxInputVideos: 0,
        maxInputAudios: 0
      },
      providerAdapter: "seedance-video",
      runtime: {
        endpoint: "/video/generations",
        responsePaths: ["url", "video_url", "data.0.url"],
        taskIdPaths: ["id", "task_id"],
        multipartFields: {
          referenceImages: "image[]",
          firstFrame: "first_frame",
          lastFrame: "last_frame"
        }
      }
    }
  };
}

async function createTemporaryVideoProvider(userId) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const canonicalModelId = `video-slash-smoke-${suffix}`;
  const profile = await prisma.modelCapabilityProfile.create({
    data: {
      canonicalModelId,
      provider: "Smoke",
      capability: "VIDEO_GENERATOR",
      aliases: ["video-slash-smoke"],
      verificationStatus: "MANUAL_VERIFIED",
      sourceUrls: []
    }
  });
  created.profileIds.push(profile.id);
  const revision = await prisma.modelCapabilityRevision.create({
    data: {
      profileId: profile.id,
      revision: 1,
      params: videoCapabilityParams(),
      sourceHash: crypto.createHash("sha256").update(canonicalModelId).digest("hex"),
      changedSummary: "Temporary video slash workflow smoke capability.",
      createdById: userId
    }
  });
  created.revisionIds.push(revision.id);
  await prisma.modelCapabilityProfile.update({ where: { id: profile.id }, data: { activeRevisionId: revision.id } });

  const config = await prisma.customApiConfig.create({
    data: {
      ownerId: userId,
      alias: "Video Slash Workflow Smoke Provider",
      provider: "Smoke",
      type: "video",
      capability: "VIDEO_GENERATOR",
      canonicalModelId,
      activeCapabilityRevisionId: revision.id,
      baseUrl: "https://example.com/v1",
      modelName: "video-slash-smoke-model",
      encryptedKey: encryptSecret("smoke-key-not-real"),
      keyPreview: "smok...real",
      isEnabled: true,
      userAccessEnabled: false
    }
  });
  created.configIds.push(config.id);
  return config;
}

async function cleanup() {
  if (created.runIds.length > 0) await prisma.workflowRun.deleteMany({ where: { id: { in: created.runIds } } });
  if (created.configIds.length > 0) await prisma.customApiConfig.deleteMany({ where: { id: { in: created.configIds } } });
  if (created.revisionIds.length > 0) await prisma.modelCapabilityRevision.deleteMany({ where: { id: { in: created.revisionIds } } });
  if (created.profileIds.length > 0) await prisma.modelCapabilityProfile.deleteMany({ where: { id: { in: created.profileIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.reviewEventIds.length > 0) await prisma.productionAssetReviewEvent.deleteMany({ where: { id: { in: created.reviewEventIds } } });
  if (created.snapshotIds.length > 0) await prisma.productionAssetSnapshot.deleteMany({ where: { id: { in: created.snapshotIds } } });
  if (created.assetIds.length > 0) await prisma.productionAsset.deleteMany({ where: { id: { in: created.assetIds } } });
  if (created.projectMemberIds.length > 0) await prisma.productionProjectMember.deleteMany({ where: { id: { in: created.projectMemberIds } } });
  if (created.projectIds.length > 0) await prisma.productionProject.deleteMany({ where: { id: { in: created.projectIds } } });
  if (created.mediaAssetIds.length > 0) await prisma.mediaAsset.deleteMany({ where: { id: { in: created.mediaAssetIds } } });
  for (const filePath of created.filePaths) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }
  await prisma.$disconnect();
}

async function main() {
  const user = await findSmokeUser();
  assert(user, "No ACTIVE user found. Log in once or create a user before running this smoke.");

  let artAsset = await findApprovedArtImageAsset(user);
  if (!artAsset && createFixtureWhenMissing) {
    artAsset = await createTemporaryArtFixture(user);
  }
  assert(
    artAsset,
    "No APPROVED TEAM ART_03 image asset found for the selected user. Save and approve one ART_03 image asset first, or keep VIDEO_SLASH_SMOKE_CREATE_FIXTURE enabled."
  );
  assert(artAsset.projectId, "Selected ART_03 asset is missing projectId.");
  assert(artAsset.mediaAssetId, "Selected ART_03 asset is missing mediaAssetId.");

  const cookie = await createSession(user.id);
  const provider = await createTemporaryVideoProvider(user.id);

  const slash = await request(`/api/team-projects/${encodeURIComponent(artAsset.projectId)}/slash-assets/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      fromStage: "SHOT_04",
      assetId: artAsset.id,
      snapshotId: artAsset.currentSnapshotId || undefined
    })
  });
  assert(slash.status === 200, `Expected slash resolve 200, got ${slash.status}: ${JSON.stringify(slash.body)}`);
  assert(slash.body?.resolved?.reference?.mediaAssetId === artAsset.mediaAssetId, "Slash resolve did not return the expected mediaAssetId.");
  assert(typeof slash.body?.resolved?.reference?.streamUrl === "string", "Slash resolve did not return streamUrl.");

  const execute = await request("/api/workflow/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      node_id: "video-slash-workflow-smoke",
      node_type: "video_generator",
      use_custom_api: true,
      custom_config_id: provider.id,
      prompt: "video slash workflow smoke",
      video_generation_mode: "image_to_video",
      aspect_ratio: "16:9",
      video_resolution: "720P",
      video_duration: 5,
      generate_audio: false,
      video_inputs: {
        referenceImageAssetIds: [artAsset.mediaAssetId]
      }
    })
  });
  assert(execute.status === 200, `Expected workflow execute 200, got ${execute.status}: ${JSON.stringify(execute.body)}`);
  assert(typeof execute.body?.task_id === "string", "Expected workflow execute task_id.");
  assert(typeof execute.body?.run_id === "string", "Expected workflow execute run_id.");
  created.runIds.push(execute.body.run_id);

  const run = await prisma.workflowRun.findUnique({ where: { id: execute.body.run_id }, select: { ownerId: true, inputJson: true, status: true } });
  assert(run?.ownerId === user.id, "Workflow run ownerId did not match smoke user.");
  assert(run.inputJson?.video_inputs?.referenceImageAssetIds?.[0] === artAsset.mediaAssetId, "Workflow run did not persist reference image assetId.");

  console.log(JSON.stringify({
    success: true,
    user: user.email || user.username || user.id,
    projectId: artAsset.projectId,
    artAssetId: artAsset.id,
    mediaAssetId: artAsset.mediaAssetId,
    taskId: execute.body.task_id,
    runId: execute.body.run_id,
    runStatus: run.status
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
