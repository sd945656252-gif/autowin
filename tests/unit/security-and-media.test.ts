import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.ALLOW_PRIVATE_PROVIDER_URLS = "true";
process.env.OUTBOUND_PRIVATE_HOST_ALLOWLIST = "internal.example";

const outbound = await import("../../apps/api/src/security/outbound-url.ts");
const storagePaths = await import("../../apps/api/src/shared/storage-paths.ts");
const mediaRange = await import("../../apps/api/src/modules/media/media-range.ts");

test("private IP detection covers IPv4, IPv6, and IPv4-mapped IPv6", () => {
  assert.equal(outbound.isPrivateIpAddress("10.0.0.1"), true);
  assert.equal(outbound.isPrivateIpAddress("127.0.0.1"), true);
  assert.equal(outbound.isPrivateIpAddress("192.168.1.10"), true);
  assert.equal(outbound.isPrivateIpAddress("::1"), true);
  assert.equal(outbound.isPrivateIpAddress("fd00::1"), true);
  assert.equal(outbound.isPrivateIpAddress("::ffff:127.0.0.1"), true);
  assert.equal(outbound.isPrivateIpAddress("[::ffff:7f00:1]"), true);
  assert.equal(outbound.isPrivateIpAddress("8.8.8.8"), false);
});

test("outbound URL validation rejects local targets and allows public IP literals", async () => {
  await assert.rejects(() => outbound.assertSafeOutboundUrl("http://localhost:3000", "test URL"), /localhost/);
  await assert.rejects(() => outbound.assertSafeOutboundUrl("http://127.0.0.1:3000", "test URL"), /private/);
  await assert.rejects(() => outbound.assertSafeOutboundUrl("http://[::ffff:127.0.0.1]", "test URL"), /private/);

  const parsed = await outbound.assertSafeOutboundUrl("https://8.8.8.8/dns-query", "test URL");
  assert.equal(parsed.hostname, "8.8.8.8");
});

test("private host allowlist is explicit", () => {
  assert.equal(outbound.isOutboundHostAllowedPrivate("internal.example"), true);
  assert.equal(outbound.isOutboundHostAllowedPrivate("localhost"), false);
});

test("upload paths stay inside configured uploads directory", () => {
  const uploadsDir = path.join(os.tmpdir(), `jiying-upload-path-test-${process.pid}`);
  process.env.UPLOADS_DIR = uploadsDir;

  assert.equal(storagePaths.getUploadFilePath("image.png"), path.join(uploadsDir, "image.png"));
  assert.equal(storagePaths.getUploadFilePath("nested/image.png"), path.join(uploadsDir, "nested", "image.png"));
  assert.throws(() => storagePaths.getUploadFilePath("../escape.png"), /escapes uploads directory/);
  assert.throws(() => storagePaths.getUploadFilePath(path.resolve(os.tmpdir(), "escape.png")), /escapes uploads directory/);
});

test("media range parser handles valid, clamped, missing, and invalid ranges", () => {
  assert.deepEqual(mediaRange.parseMediaRange(undefined, 100), { kind: "none" });
  assert.deepEqual(mediaRange.parseMediaRange("bytes=10-19", 100), {
    kind: "range",
    start: 10,
    end: 19,
    contentLength: 10,
    contentRange: "bytes 10-19/100"
  });
  assert.deepEqual(mediaRange.parseMediaRange("bytes=90-999", 100), {
    kind: "range",
    start: 90,
    end: 99,
    contentLength: 10,
    contentRange: "bytes 90-99/100"
  });
  assert.equal(mediaRange.parseMediaRange("bytes=101-120", 100).kind, "invalid");
  assert.equal(mediaRange.parseMediaRange("bytes=50-10", 100).kind, "invalid");
  assert.equal(mediaRange.parseMediaRange("items=0-1", 100).kind, "invalid");
  assert.equal(mediaRange.parseMediaRange("bytes=0-1", 0).kind, "invalid");
});
