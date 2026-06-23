import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { resolveSmokeBaseUrl } from "./smoke-base-url.mjs";

dotenv.config();

const baseUrl = await resolveSmokeBaseUrl(["PROMPT_OPTIMIZATION_SMOKE_BASE_URL", "PIPELINE_ASSISTANT_SMOKE_BASE_URL"]);
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  userIds: []
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

async function createUser(role, label) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `prompt-optimization-${label}-${suffix}@example.test`,
      username: `prompt-optimization-${label}-${suffix}`.slice(0, 40),
      displayName: `Prompt Optimization ${label}`,
      role,
      status: "ACTIVE",
      emailVerified: true
    }
  });
  created.userIds.push(user.id);
  return user;
}

async function createCookie(userId, label) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      userAgent: `prompt-optimization-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return `jiying_session=${encodeURIComponent(token)}`;
}

async function cleanup() {
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.$disconnect();
}

async function main() {
  const admin = await createUser("ADMIN", "admin");
  const user = await createUser("USER", "user");
  const adminCookie = await createCookie(admin.id, "admin");
  const userCookie = await createCookie(user.id, "user");

  const anonymousList = await request("/api/prompt-optimization/profiles");
  expectStatus(anonymousList, [401], "Anonymous profile list");

  const userList = await request("/api/prompt-optimization/profiles", {
    headers: { Cookie: userCookie }
  });
  expectStatus(userList, [200], "User profile list");
  assert(Array.isArray(userList.body?.profiles), "Profile list should return profiles.");
  assert(userList.body.profiles.length >= 5, "Profile list should include all built-in prompt profiles.");
  assert(userList.body.profiles.some((profile) => profile.key === "video_prompt"), "video_prompt profile should exist.");

  const ordinaryWrite = await request("/api/prompt-optimization/profiles/video_prompt", {
    method: "PUT",
    headers: { Cookie: userCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt: "普通用户不应该能保存这个足够长的系统提示词。" })
  });
  expectStatus(ordinaryWrite, [403], "Ordinary user profile write");

  const invalidKey = await request("/api/prompt-optimization/profiles/not_a_profile", {
    method: "PUT",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt: "管理员写入无效 key 时应当拿到 404，而不是创建未知配置。" })
  });
  expectStatus(invalidKey, [404], "Invalid profile key");

  const original = userList.body.profiles.find((profile) => profile.key === "video_prompt");
  const smokePrompt = `${original.systemPrompt}\n\nSmoke verification marker ${Date.now()}`;
  const update = await request("/api/prompt-optimization/profiles/video_prompt", {
    method: "PUT",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt: smokePrompt, isEnabled: true })
  });
  expectStatus(update, [200], "Admin profile update");
  assert(update.body?.profile?.systemPrompt === smokePrompt, "Updated profile should echo saved system prompt.");

  const reset = await request("/api/prompt-optimization/profiles/video_prompt/reset", {
    method: "POST",
    headers: { Cookie: adminCookie }
  });
  expectStatus(reset, [200], "Admin profile reset");
  assert(reset.body?.profile?.systemPrompt === reset.body?.profile?.defaultSystemPrompt, "Reset should restore default system prompt.");

  const audit = await prisma.auditLog.findFirst({
    where: {
      actorId: admin.id,
      action: "UPDATE",
      entityType: "PromptOptimizationProfile",
      entityId: reset.body.profile.id
    },
    orderBy: { createdAt: "desc" }
  });
  assert(audit?.metadata?.key === "video_prompt", "Profile update/reset should write audit log.");

  console.log(JSON.stringify({
    success: true,
    checked: {
      anonymousList: anonymousList.status,
      userList: userList.body.profiles.length,
      ordinaryWrite: ordinaryWrite.status,
      invalidKey: invalidKey.status,
      update: update.status,
      reset: reset.status,
      audit: Boolean(audit)
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
