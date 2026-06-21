import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.ROLE_ACCESS_SMOKE_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();
const created = { userIds: [], sessionIds: [] };

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

async function createUserWithSession(role) {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const user = await prisma.user.create({
    data: {
      email: `role-access-${role.toLowerCase()}-${suffix}@example.test`,
      username: `role-access-${role.toLowerCase()}-${suffix}`.slice(0, 40),
      displayName: `Role Access ${role}`,
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
      userAgent: `role-access-smoke-${role}`
    }
  });
  created.sessionIds.push(session.id);
  return { user, cookie: `jiying_session=${encodeURIComponent(token)}` };
}

function expectStatus(actual, expected, label) {
  assert(expected.includes(actual), `${label} expected ${expected.join("/")} but got ${actual}.`);
}

async function cleanup() {
  if (created.sessionIds.length > 0) {
    await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  }
  if (created.userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: created.userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  }
  await prisma.$disconnect();
}

async function main() {
  const [user, developer, admin] = await Promise.all([
    createUserWithSession("USER"),
    createUserWithSession("DEVELOPER"),
    createUserWithSession("ADMIN")
  ]);

  const cases = [
    {
      label: "USER",
      cookie: user.cookie,
      expected: {
        meRole: "USER",
        developerHealth: [403],
        adminUsers: [403]
      }
    },
    {
      label: "DEVELOPER",
      cookie: developer.cookie,
      expected: {
        meRole: "DEVELOPER",
        developerHealth: [200],
        adminUsers: [403]
      }
    },
    {
      label: "ADMIN",
      cookie: admin.cookie,
      expected: {
        meRole: "ADMIN",
        developerHealth: [200],
        adminUsers: [200]
      }
    }
  ];

  const checked = {};
  for (const item of cases) {
    const me = await request("/api/auth/me", { headers: { Cookie: item.cookie } });
    expectStatus(me.status, [200], `${item.label} auth/me`);
    assert(me.body?.user?.role === item.expected.meRole, `${item.label} expected role ${item.expected.meRole}, got ${me.body?.user?.role}.`);
    assert(me.body?.user?.capabilities?.developer === (item.label === "ADMIN" || item.label === "DEVELOPER"), `${item.label} developer capability mismatch.`);
    assert(me.body?.user?.capabilities?.admin === (item.label === "ADMIN"), `${item.label} admin capability mismatch.`);

    const developerHealth = await request("/api/developer/system/health", { headers: { Cookie: item.cookie } });
    expectStatus(developerHealth.status, item.expected.developerHealth, `${item.label} developer health`);

    const adminUsers = await request("/api/users", { headers: { Cookie: item.cookie } });
    expectStatus(adminUsers.status, item.expected.adminUsers, `${item.label} admin users`);

    checked[item.label] = {
      role: me.body.user.role,
      capabilities: me.body.user.capabilities,
      developerHealth: developerHealth.status,
      adminUsers: adminUsers.status
    };
  }

  console.log(JSON.stringify({ success: true, checked }, null, 2));
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
