import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.SHOWCASE_MISSING_MEDIA_SMOKE_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();
const key = `extra-missing-media-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const missingStorageKey = `missing-showcase-smoke-${Date.now()}.mp4`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function cleanup() {
  await prisma.showcaseWork.deleteMany({ where: { key } });
  await prisma.videoRegistryItem.deleteMany({ where: { key } });
  await prisma.$disconnect();
}

async function main() {
  await prisma.showcaseWork.create({
    data: {
      key,
      title: "Missing Media Smoke",
      category: "Regression Check",
      videoUrl: `/uploads/${missingStorageKey}`,
      storageKey: missingStorageKey,
      sortOrder: 9999,
      status: "PUBLISHED",
      metadata: { smoke: true, purpose: "showcase-missing-media-smoke" }
    }
  });

  const registry = await request("/api/videos");
  assert(registry.status === 200, `Expected registry 200, got ${registry.status}: ${JSON.stringify(registry.body)}`);
  assert(registry.body?.videos?.[key] === null, `Expected missing showcase video to be hidden, got ${registry.body?.videos?.[key]}`);
  assert(registry.body?.works?.find((work) => work.key === key)?.playbackUrl === null, "Expected missing showcase work playbackUrl to be null.");

  const stream = await request(`/api/videos/${encodeURIComponent(key)}/stream`);
  assert(stream.status === 404, `Expected missing showcase stream 404, got ${stream.status}: ${JSON.stringify(stream.body)}`);

  console.log(JSON.stringify({
    success: true,
    key,
    checked: {
      registry: registry.status,
      playbackUrl: registry.body?.videos?.[key],
      stream: stream.status
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
