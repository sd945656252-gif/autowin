import "dotenv/config";

const PROTECTED_EMAILS = new Set(["sd945656252@gmail.com", "admin@jiying.local"]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function maybeUseLocalDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.RUNNING_IN_DOCKER === "1") return;
  try {
    const url = new URL(raw);
    if (url.hostname === "postgres") {
      url.hostname = "localhost";
      process.env.DATABASE_URL = url.toString();
    }
  } catch {
    // Prisma will report invalid DATABASE_URL with its normal diagnostics.
  }
}

function isProtectedUser(user) {
  return PROTECTED_EMAILS.has(normalizeEmail(user.email));
}

function isSecuritySmokeUser(user) {
  const email = normalizeEmail(user.email);
  const username = String(user.username || "").trim().toLowerCase();
  const displayName = String(user.displayName || "").trim();

  return (
    (email.startsWith("secsmoke-") && email.endsWith("@example.test")) ||
    (email.startsWith("security-smoke-") && email.endsWith("@example.test")) ||
    (email.startsWith("local-smoke-") && email.endsWith("@jiying.local")) ||
    username.startsWith("secsmoke-") ||
    username.startsWith("security-smoke-") ||
    displayName.startsWith("Security Smoke") ||
    displayName === "Local Smoke User"
  );
}

function formatUser(user) {
  return [
    `email=${user.email || "<null>"}`,
    `username=${user.username || "<null>"}`,
    `displayName=${user.displayName || "<null>"}`,
    `role=${user.role}`,
    `createdAt=${user.createdAt.toISOString()}`,
    `sessions=${user._count.sessions}`,
    `oauthAccounts=${user._count.oauthAccounts}`,
    `workflows=${user._count.workflows}`,
    `mediaAssets=${user._count.mediaAssets}`,
    `auditLogs=${user._count.auditLogs}`
  ].join(" | ");
}

async function main() {
  maybeUseLocalDatabaseUrl();
  const confirm = process.argv.includes("--confirm");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const candidates = await prisma.user.findMany({
      where: {
        NOT: {
          email: { in: Array.from(PROTECTED_EMAILS), mode: "insensitive" }
        },
        OR: [
          { email: { startsWith: "secsmoke-", endsWith: "@example.test", mode: "insensitive" } },
          { email: { startsWith: "security-smoke-", endsWith: "@example.test", mode: "insensitive" } },
          { email: { startsWith: "local-smoke-", endsWith: "@jiying.local", mode: "insensitive" } },
          { username: { startsWith: "secsmoke-", mode: "insensitive" } },
          { username: { startsWith: "security-smoke-", mode: "insensitive" } },
          { displayName: { startsWith: "Security Smoke" } },
          { displayName: "Local Smoke User" }
        ]
      },
      orderBy: { createdAt: "asc" },
      include: {
        _count: {
          select: {
            sessions: true,
            oauthAccounts: true,
            workflows: true,
            mediaAssets: true,
            auditLogs: true
          }
        }
      }
    });

    const users = candidates.filter((user) => isSecuritySmokeUser(user) && !isProtectedUser(user));

    console.log(`${confirm ? "CONFIRM" : "DRY-RUN"}: security smoke users matched: ${users.length}`);
    for (const user of users) {
      console.log(`- ${formatUser(user)}`);
    }

    if (!confirm) {
      console.log("No users were deleted. Re-run with: npm run security:cleanup -- --confirm");
      return;
    }

    if (users.length === 0) {
      console.log("No matching security smoke users to delete.");
      return;
    }

    const ids = users.map((user) => user.id);
    const result = await prisma.user.deleteMany({
      where: {
        id: { in: ids },
        NOT: {
          email: { in: Array.from(PROTECTED_EMAILS), mode: "insensitive" }
        }
      }
    });

    console.log(`Deleted security smoke users: ${result.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`security cleanup failed: ${error.message}`);
  process.exitCode = 1;
});
