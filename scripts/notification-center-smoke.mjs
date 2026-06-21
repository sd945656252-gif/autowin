import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const baseUrl = process.env.NOTIFICATION_CENTER_SMOKE_BASE_URL || "http://localhost:3000";
const prisma = new PrismaClient();
const created = {
  sessionIds: [],
  projectIds: [],
  userIds: [],
  mediaAssetIds: [],
  assetIds: [],
  snapshotIds: [],
  notificationIds: []
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
  return { status: response.status, body, headers: response.headers };
}

function expectStatus(response, allowed, label) {
  assert(allowed.includes(response.status), `${label} expected ${allowed.join("/")} but got ${response.status}: ${JSON.stringify(response.body)}`);
}

async function createUser(label, role = "USER") {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const user = await prisma.user.create({
    data: {
      email: `notification-smoke-${label}-${suffix}@example.test`,
      username: `notification-smoke-${label}-${suffix}`.slice(0, 40),
      displayName: `Notification Smoke ${label}`,
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
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userAgent: `notification-center-smoke-${label}`
    }
  });
  created.sessionIds.push(session.id);
  return { user, cookie: `jiying_session=${encodeURIComponent(token)}` };
}

async function uploadAttachment(cookie, filename, content, mimeType = "text/plain") {
  const form = new FormData();
  form.append("key", "notification-center-smoke");
  form.append("file", new Blob([content], { type: mimeType }), filename);
  const response = await fetch(`${baseUrl}/api/media/upload`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form
  });
  const body = await response.json().catch(() => ({}));
  expectStatus({ status: response.status, body }, [200], `Upload ${filename}`);
  assert(body.assetId, `Upload should return assetId: ${JSON.stringify(body)}`);
  created.mediaAssetIds.push(body.assetId);
  return body;
}

async function readNotifications(cookie, query = "") {
  const response = await request(`/api/notifications${query}`, { headers: { Cookie: cookie } });
  expectStatus(response, [200], `Read notifications ${query}`);
  return response.body.notifications || [];
}

async function createProject(owner, producer, member, outsider) {
  const project = await prisma.productionProject.create({
    data: {
      name: `Notification Center Smoke ${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      description: "notification center smoke project",
      createdById: owner.user.id,
      metadata: { smoke: true, purpose: "notification-center-smoke" },
      members: {
        create: [
          { userId: owner.user.id, role: "OWNER" },
          { userId: producer.user.id, role: "MEMBER" },
          { userId: member.user.id, role: "MEMBER" }
        ]
      },
      roleGrants: {
        create: {
          userId: producer.user.id,
          role: "PROJECT_DEVELOPER",
          grantedById: owner.user.id
        }
      }
    }
  });
  created.projectIds.push(project.id);
  assert(outsider.user.id !== member.user.id, "Outsider fixture should be distinct.");
  return project;
}

async function createPersonalAsset(member, project, media) {
  const createAsset = await request("/api/production-assets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: member.cookie },
    body: JSON.stringify({
      projectId: project.id,
      stage: "SCRIPT_01",
      originalName: "notification-review-smoke.txt",
      mediaAssetId: media.assetId,
      mimeType: "text/plain",
      sourceType: "notification_center_smoke",
      sourcePayload: { text: "notification center review smoke" },
      metadata: { smoke: true }
    })
  });
  expectStatus(createAsset, [201], "Create personal production asset");
  assert(createAsset.body?.asset?.id, "Create personal asset should return asset.");
  created.assetIds.push(createAsset.body.asset.id);
  return createAsset.body.asset;
}

async function submitReview(member, asset) {
  const submit = await request(`/api/production-assets/${encodeURIComponent(asset.id)}/submit-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: member.cookie },
    body: JSON.stringify({ note: "notification smoke submit", frozenPayload: { text: "review payload" } })
  });
  expectStatus(submit, [201], "Submit production asset review");
  assert(submit.body?.snapshot?.id, "Submit review should return snapshot.");
  created.snapshotIds.push(submit.body.snapshot.id);
  return submit.body.snapshot;
}

async function cleanup() {
  if (created.notificationIds.length > 0) await prisma.notification.deleteMany({ where: { id: { in: created.notificationIds } } });
  if (created.userIds.length > 0) await prisma.notification.deleteMany({ where: { OR: [{ receiverId: { in: created.userIds } }, { senderId: { in: created.userIds } }] } });
  if (created.assetIds.length > 0) await prisma.productionAssetReviewEvent.deleteMany({ where: { assetId: { in: created.assetIds } } });
  if (created.sessionIds.length > 0) await prisma.authSession.deleteMany({ where: { id: { in: created.sessionIds } } });
  if (created.snapshotIds.length > 0) await prisma.productionAssetSnapshot.deleteMany({ where: { id: { in: created.snapshotIds } } });
  if (created.assetIds.length > 0) await prisma.productionAsset.deleteMany({ where: { id: { in: created.assetIds } } });
  if (created.projectIds.length > 0) {
    await prisma.productionProjectRoleGrant.deleteMany({ where: { projectId: { in: created.projectIds } } });
    await prisma.productionProjectMember.deleteMany({ where: { projectId: { in: created.projectIds } } });
    await prisma.productionProject.deleteMany({ where: { id: { in: created.projectIds } } });
  }
  if (created.mediaAssetIds.length > 0) await prisma.mediaAsset.deleteMany({ where: { id: { in: created.mediaAssetIds } } });
  if (created.userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  await prisma.$disconnect();
}

async function main() {
  const [owner, producer, member, outsider, manager] = await Promise.all([
    createUser("owner"),
    createUser("producer"),
    createUser("member"),
    createUser("outsider"),
    createUser("manager", "DEVELOPER")
  ]);
  const project = await createProject(owner, producer, member, outsider);

  const noticeAttachment = await uploadAttachment(producer.cookie, "notice-attachment.txt", "notice attachment body");
  const notice = await request("/api/notifications/notice", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: producer.cookie },
    body: JSON.stringify({
      projectId: project.id,
      receiverId: member.user.id,
      title: "Smoke single member notice",
      content: "Only the member should see this notice.",
      attachmentMediaAssetIds: [noticeAttachment.assetId]
    })
  });
  expectStatus(notice, [201], "Publish single member notice");
  created.notificationIds.push(...(notice.body.notifications || []).map((item) => item.id));

  const memberNotices = await readNotifications(member.cookie, "?category=NOTICE");
  const receivedNotice = memberNotices.find((item) => item.title === "Smoke single member notice");
  assert(receivedNotice?.attachments?.length === 1, `Member should receive notice attachment: ${JSON.stringify(memberNotices)}`);

  const outsiderNotices = await readNotifications(outsider.cookie, "?category=NOTICE");
  assert(!outsiderNotices.some((item) => item.title === "Smoke single member notice"), "Outsider should not see single member notice.");

  const noticeStream = await fetch(`${baseUrl}${receivedNotice.attachments[0].previewUrl}`, { headers: { Cookie: member.cookie } });
  assert(noticeStream.status === 200, `Receiver should preview attachment, got ${noticeStream.status}.`);
  const outsiderStream = await fetch(`${baseUrl}${receivedNotice.attachments[0].previewUrl}`, { headers: { Cookie: outsider.cookie } });
  assert(outsiderStream.status === 404, `Outsider should not preview receiver attachment, got ${outsiderStream.status}.`);

  const read = await request(`/api/notifications/${encodeURIComponent(receivedNotice.id)}/read`, {
    method: "POST",
    headers: { Cookie: member.cookie }
  });
  expectStatus(read, [200], "Mark notice as read");
  assert(read.body.notification.readAt, "Mark read should set readAt.");

  const remove = await request(`/api/notifications/${encodeURIComponent(receivedNotice.id)}`, {
    method: "DELETE",
    headers: { Cookie: member.cookie }
  });
  expectStatus(remove, [200], "Soft-delete notice");
  const afterDelete = await readNotifications(member.cookie, "?category=NOTICE");
  assert(!afterDelete.some((item) => item.id === receivedNotice.id), "Deleted notice should disappear from receiver list.");

  const broadcast = await request("/api/notifications/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: producer.cookie },
    body: JSON.stringify({
      projectId: project.id,
      title: "Smoke project broadcast",
      content: "Every project member should see this broadcast."
    })
  });
  expectStatus(broadcast, [201], "Publish project broadcast");
  created.notificationIds.push(...(broadcast.body.notifications || []).map((item) => item.id));

  const ownerBroadcasts = await readNotifications(owner.cookie, "?category=BROADCAST");
  const producerBroadcasts = await readNotifications(producer.cookie, "?category=BROADCAST");
  const memberBroadcasts = await readNotifications(member.cookie, "?category=BROADCAST");
  const outsiderBroadcasts = await readNotifications(outsider.cookie, "?category=BROADCAST");
  assert(ownerBroadcasts.some((item) => item.title === "Smoke project broadcast"), "Owner should receive project broadcast.");
  assert(producerBroadcasts.some((item) => item.title === "Smoke project broadcast"), "Producer should receive project broadcast.");
  assert(memberBroadcasts.some((item) => item.title === "Smoke project broadcast"), "Member should receive project broadcast.");
  assert(!outsiderBroadcasts.some((item) => item.title === "Smoke project broadcast"), "Outsider should not receive project broadcast.");

  const globalAnnouncement = await request("/api/notifications/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: manager.cookie },
    body: JSON.stringify({
      scope: "GLOBAL",
      title: "Smoke global announcement",
      content: "All active users should see this announcement."
    })
  });
  expectStatus(globalAnnouncement, [201], "Publish global announcement");
  created.notificationIds.push(...(globalAnnouncement.body.notifications || []).map((item) => item.id));

  const outsiderAnnouncements = await readNotifications(outsider.cookie, "?category=ANNOUNCEMENT");
  assert(outsiderAnnouncements.some((item) => item.title === "Smoke global announcement"), "Outsider should receive global announcement.");

  const userAnnouncementAttempt = await request("/api/notifications/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: member.cookie },
    body: JSON.stringify({ scope: "GLOBAL", title: "Forbidden announcement", content: "Should fail." })
  });
  expectStatus(userAnnouncementAttempt, [403], "Block ordinary user announcement");

  const reviewMedia = await uploadAttachment(member.cookie, "review-asset.txt", "review asset body");
  const personalAsset = await createPersonalAsset(member, project, reviewMedia);
  const snapshot = await submitReview(member, personalAsset);
  const producerAfterSubmit = await readNotifications(producer.cookie, "?category=NOTICE");
  assert(
    producerAfterSubmit.some((item) => item.type === "ASSET_SUBMITTED" && item.targetId === snapshot.id && item.content.includes("提交了文件")),
    "Producer should receive automatic review-submitted notice."
  );

  const approve = await request(`/api/team-projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(snapshot.id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: producer.cookie },
    body: JSON.stringify({ note: "notification smoke approve" })
  });
  expectStatus(approve, [200], "Producer approves submitted asset");
  if (approve.body?.teamAsset?.id) created.assetIds.push(approve.body.teamAsset.id);

  const memberAfterApproval = await readNotifications(member.cookie, "?category=NOTICE");
  assert(
    memberAfterApproval.some((item) => item.type === "ASSET_APPROVED" && item.targetId === personalAsset.id && item.content.includes("已审核通过")),
    "Submitter should receive automatic review-approved notice."
  );

  const count = await request("/api/notifications/unread-count", { headers: { Cookie: member.cookie } });
  expectStatus(count, [200], "Read unread count");
  assert(typeof count.body.count === "number", "Unread count should be numeric.");

  console.log(JSON.stringify({
    success: true,
    projectId: project.id,
    checked: {
      singleNoticeVisibleOnlyToReceiver: true,
      attachmentPreviewAuthorized: noticeStream.status,
      attachmentPreviewBlockedForOutsider: outsiderStream.status,
      readAndSoftDelete: true,
      projectBroadcastMembersOnly: true,
      globalAnnouncement: true,
      ordinaryUserAnnouncementBlocked: userAnnouncementAttempt.status,
      reviewSubmissionAutoNotice: true,
      reviewApprovalAutoNotice: true,
      unreadCount: count.body.count
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
