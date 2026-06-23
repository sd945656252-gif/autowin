import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { syncPrimaryAdmins } from "./sync-primary-admins.mjs";

dotenv.config();

const baseUrl = process.env.ACCOUNT_SETTINGS_SMOKE_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();
const createdEmails = [];
const createdAvatarUrls = [];

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

function primaryAdminEmail() {
  return String(process.env.PRIMARY_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)[0] || "sd945656252@gmail.com";
}

async function cleanup() {
  if (createdAvatarUrls.length > 0) {
    const storageKeys = createdAvatarUrls
      .filter((url) => url.startsWith("/uploads/"))
      .map((url) => decodeURIComponent(url.slice("/uploads/".length).split("?")[0]))
      .filter(Boolean);
    if (storageKeys.length > 0) {
      await prisma.mediaAsset.deleteMany({ where: { storageKey: { in: storageKeys } } });
      await Promise.all(storageKeys.map(async (storageKey) => {
        try {
          await fs.rm(path.resolve(process.cwd(), "uploads", storageKey), { force: true });
        } catch {
          // Uploads may live inside a Podman volume during local preview.
        }
      }));
    }
  }
  if (createdEmails.length > 0) {
    const users = await prisma.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.oAuthAccount.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }
  await prisma.$disconnect();
}

async function main() {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const email = `account-smoke-${suffix}@example.test`;
  const initialPassword = "AccountSmoke123!";
  const updatedPassword = "AccountSmoke456!";
  const displayName = `Account Smoke ${suffix}`;
  const avatarUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  createdEmails.push(email);

  const register = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: initialPassword, displayName: "Initial Smoke" })
  });
  assert(register.status === 200, `Register expected 200, got ${register.status}: ${JSON.stringify(register.body)}`);
  const cookie = cookieFrom(register);
  assert(cookie, "Expected registration to set session cookie.");

  const profile = await request("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ displayName, photoURL: avatarUrl })
  });
  assert(profile.status === 200, `Profile update expected 200, got ${profile.status}: ${JSON.stringify(profile.body)}`);
  assert(profile.body?.user?.displayName === displayName, "Profile response did not include updated displayName.");
  const storedAvatarUrl = profile.body?.user?.photoURL;
  assert(typeof storedAvatarUrl === "string" && storedAvatarUrl.startsWith("/uploads/avatar-"), `Profile response should include a stored upload avatar URL, got ${storedAvatarUrl}.`);
  assert(!storedAvatarUrl.startsWith("data:"), "Profile response should not store avatar as a data URL.");
  createdAvatarUrls.push(storedAvatarUrl);

  const avatarFetch = await request(storedAvatarUrl);
  assert(avatarFetch.status === 200, `Stored avatar should be publicly readable, got ${avatarFetch.status}.`);

  const changePassword = await request("/api/auth/password/change", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ currentPassword: initialPassword, newPassword: updatedPassword })
  });
  assert(changePassword.status === 200, `Password change expected 200, got ${changePassword.status}: ${JSON.stringify(changePassword.body)}`);
  assert(changePassword.body?.user?.hasPassword === true, "Password change response should report hasPassword=true.");

  const me = await request("/api/auth/me", { headers: { Cookie: cookie } });
  assert(me.status === 200, `Me expected 200, got ${me.status}: ${JSON.stringify(me.body)}`);
  assert(me.body?.user?.displayName === displayName, "Updated displayName was not persisted.");
  assert(me.body?.user?.photoURL === storedAvatarUrl, "Updated avatar upload URL was not persisted.");

  const oldLogin = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: initialPassword })
  });
  assert(oldLogin.status === 401, `Old password should fail with 401, got ${oldLogin.status}.`);

  const newLogin = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: updatedPassword })
  });
  assert(newLogin.status === 200, `New password login expected 200, got ${newLogin.status}: ${JSON.stringify(newLogin.body)}`);
  assert(newLogin.body?.user?.displayName === displayName, "Login with new password did not return persisted profile.");
  assert(newLogin.body?.user?.photoURL === storedAvatarUrl, "Login with new password did not return persisted avatar URL.");

  const adminEmail = primaryAdminEmail();
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      username: `primary-admin-${suffix}`.slice(0, 40),
      displayName: "Primary Admin Smoke",
      role: "USER",
      status: "ACTIVE",
      emailVerified: false
    },
    update: { role: "USER", status: "ACTIVE", emailVerified: false }
  });

  await syncPrimaryAdmins(prisma);
  const syncedAdmin = await prisma.user.findUnique({ where: { id: adminUser.id } });
  assert(syncedAdmin?.role === "ADMIN", `Expected ${adminEmail} to sync to ADMIN, got ${syncedAdmin?.role}.`);
  assert(syncedAdmin?.status === "ACTIVE", `Expected ${adminEmail} to remain ACTIVE.`);
  assert(syncedAdmin?.emailVerified === true, `Expected ${adminEmail} to be emailVerified.`);

  await prisma.user.update({ where: { id: adminUser.id }, data: { role: "ADMIN", status: "ACTIVE", emailVerified: true } });

  console.log(JSON.stringify({
    success: true,
    checked: {
      profilePersisted: true,
      avatarPersisted: true,
      passwordChanged: true,
      oldPasswordRejected: oldLogin.status,
      newPasswordAccepted: newLogin.status,
      primaryAdminEmail: adminEmail,
      primaryAdminRole: syncedAdmin.role
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
