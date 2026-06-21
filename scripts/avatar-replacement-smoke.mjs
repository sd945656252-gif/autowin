import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.ACCOUNT_SETTINGS_SMOKE_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();
const createdEmails = [];
const createdAvatarUrls = [];

const redPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
const presetAvatarUrl = "https://images.unsplash.com/photo-1614064641938-3bbee52942c7?w=150&auto=format&fit=crop&q=80";

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") || "";
  return raw.split(",").map((part) => part.split(";")[0].trim()).filter((part) => part.startsWith("jiying_session=")).join("; ");
}

function storageKeyFromUrl(url) {
  return decodeURIComponent(url.slice("/uploads/".length).split("?")[0]);
}

async function cleanup() {
  const storageKeys = createdAvatarUrls
    .filter((url) => url?.startsWith("/uploads/"))
    .map(storageKeyFromUrl);
  if (storageKeys.length > 0) {
    await prisma.mediaAsset.deleteMany({ where: { storageKey: { in: storageKeys } } });
  }
  if (createdEmails.length > 0) {
    const users = await prisma.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
  await prisma.$disconnect();
}

async function updateProfilePhoto(cookie, displayName, photoURL) {
  const profile = await request("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ displayName, photoURL })
  });
  assert(profile.status === 200, `Profile update expected 200, got ${profile.status}: ${JSON.stringify(profile.body)}`);
  const storedAvatarUrl = profile.body?.user?.photoURL;
  assert(typeof storedAvatarUrl === "string", `Expected stored avatar URL string, got ${storedAvatarUrl}.`);
  if (storedAvatarUrl.startsWith("/uploads/avatar-")) createdAvatarUrls.push(storedAvatarUrl);
  return storedAvatarUrl;
}

async function main() {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const email = `avatar-replace-${suffix}@example.test`;
  const password = "AvatarSmoke123!";
  createdEmails.push(email);

  const register = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "Avatar Replace Smoke" })
  });
  assert(register.status === 200, `Register expected 200, got ${register.status}: ${JSON.stringify(register.body)}`);
  const cookie = cookieFrom(register);
  assert(cookie, "Expected registration to set session cookie.");

  const firstUrl = await updateProfilePhoto(cookie, "Avatar Replace Smoke", redPng);
  assert(firstUrl.startsWith("/uploads/avatar-"), `Expected first avatar to be stored as upload, got ${firstUrl}.`);
  const firstStorageKey = storageKeyFromUrl(firstUrl);
  const firstAsset = await prisma.mediaAsset.findFirst({ where: { storageKey: firstStorageKey } });
  assert(firstAsset, "Expected first avatar media asset to exist after upload.");

  const presetUrl = await updateProfilePhoto(cookie, "Avatar Replace Smoke", presetAvatarUrl);
  assert(presetUrl === presetAvatarUrl, "Preset avatar URL should be stored unchanged.");
  const assetAfterPreset = await prisma.mediaAsset.findFirst({ where: { storageKey: firstStorageKey } });
  assert(!assetAfterPreset, "Switching to preset avatar should clean up the previous local avatar asset.");
  const presetAsset = await prisma.mediaAsset.findFirst({ where: { url: presetAvatarUrl } });
  assert(!presetAsset, "Preset avatar URL should not create a local media asset.");

  const secondUrl = await updateProfilePhoto(cookie, "Avatar Replace Smoke", gif);
  assert(secondUrl.startsWith("/uploads/avatar-"), `Expected second avatar to be stored as upload, got ${secondUrl}.`);
  const secondStorageKey = storageKeyFromUrl(secondUrl);
  assert(secondUrl !== firstUrl, "Replacing avatar should create a new stored URL.");

  const oldAsset = await prisma.mediaAsset.findFirst({ where: { storageKey: firstStorageKey } });
  const newAsset = await prisma.mediaAsset.findFirst({ where: { storageKey: secondStorageKey } });
  assert(!oldAsset, "Expected replaced avatar media asset to be cleaned up.");
  assert(newAsset, "Expected latest avatar media asset to exist.");

  const me = await request("/api/auth/me", { headers: { Cookie: cookie } });
  assert(me.body?.user?.photoURL === secondUrl, "Current user should keep the latest avatar URL.");

  console.log(JSON.stringify({
    success: true,
    checked: {
      firstAvatarCleaned: true,
      presetUrlStoredUnchanged: true,
      presetDidNotCreateMediaAsset: true,
      latestAvatarPersisted: true,
      latestAvatarUrl: secondUrl
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
