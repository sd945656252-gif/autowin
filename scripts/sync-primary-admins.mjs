import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

function adminEmails() {
  return String(process.env.PRIMARY_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function syncPrimaryAdmins(db = prisma) {
  const emails = adminEmails();
  if (emails.length === 0) {
    return { success: true, updated: 0, skipped: 0, message: "PRIMARY_ADMIN_EMAILS is empty." };
  }

  const users = await db.user.findMany({ where: { email: { in: emails } } });
  const existing = new Set(users.map((user) => user.email?.toLowerCase()).filter(Boolean));
  const updated = [];
  for (const user of users) {
    if (user.role !== "ADMIN" || user.status !== "ACTIVE" || !user.emailVerified) {
      const next = await db.user.update({
        where: { id: user.id },
        data: { role: "ADMIN", status: "ACTIVE", emailVerified: true }
      });
      updated.push(next.email);
    }
  }

  const missing = emails.filter((email) => !existing.has(email));
  return {
    success: true,
    updated: updated.length,
    unchanged: users.length - updated.length,
    missing,
    admins: users.map((user) => user.email)
  };
}

async function main() {
  const result = await syncPrimaryAdmins();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  main()
    .catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
