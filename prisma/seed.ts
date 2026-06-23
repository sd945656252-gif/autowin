import "dotenv/config";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../apps/api/src/db/prisma";
import { normalizeEmail, normalizeUsername, passwordHash } from "../apps/api/src/modules/auth/auth.shared";

async function main() {
  const email = normalizeEmail(process.env.SEED_ADMIN_EMAIL || "admin@jiying.local");
  const username = normalizeUsername(process.env.SEED_ADMIN_USERNAME || "admin");
  const password = process.env.SEED_ADMIN_PASSWORD || "JiyingAdmin123!";
  const displayName = process.env.SEED_ADMIN_DISPLAY_NAME || "Jiying Admin";
  const isSharedOrProduction = process.env.NODE_ENV === "production" || process.env.LOCAL_TEAM_MODE === "true" || process.env.REQUIRE_STRONG_LOCAL_SECRETS === "true";

  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
  }
  if (isSharedOrProduction && password === "JiyingAdmin123!") {
    throw new Error("Refusing to seed the default admin password in shared or production mode. Set SEED_ADMIN_PASSWORD to a strong unique value.");
  }

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      username,
      displayName,
      passwordHash: passwordHash(password),
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true
    },
    update: {
      username,
      displayName,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });

  console.log(`Seeded ADMIN user: ${user.email} (${user.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
