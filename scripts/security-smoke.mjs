const baseUrl = process.env.SECURITY_SMOKE_BASE_URL || "http://localhost:3000";
let prisma = null;
let createdGlobalConfigId = null;
let createdIncompleteProviderId = null;
const createdGlobalUserAccessProviderIds = [];
const createdSmokeEmails = [];
const createdWorkflowIds = [];
const createdWorkflowRunIds = [];

async function getPrisma() {
  if (!prisma) {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
  }
  return prisma;
}

async function createGlobalProviderFixture() {
  const db = await getPrisma();
  createdGlobalConfigId = `secsmoke-global-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await db.customApiConfig.create({
    data: {
      id: createdGlobalConfigId,
      ownerId: null,
      alias: "Security Smoke Global Provider",
      type: "text",
      baseUrl: "https://example.com/v1",
      modelName: "security-smoke-model",
      encryptedKey: "not-used-by-forbidden-test",
      keyPreview: "sk...test",
      userAccessEnabled: false,
      isEnabled: true
    }
  });
  return createdGlobalConfigId;
}

async function createGlobalUserAccessProviderFixture(enabled) {
  const db = await getPrisma();
  const id = `secsmoke-user-access-${enabled ? "enabled" : "disabled"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await db.customApiConfig.create({
    data: {
      id,
      ownerId: null,
      alias: `Security Smoke User Access ${enabled ? "Enabled" : "Disabled"}`,
      type: "text",
      capability: "TEXT_GENERATOR",
      baseUrl: "https://example.com/v1",
      modelName: "security-smoke-model",
      encryptedKey: "not-used-by-list-test",
      keyPreview: "sk...test",
      userAccessEnabled: enabled,
      isEnabled: true
    }
  });
  createdGlobalUserAccessProviderIds.push(id);
  return id;
}

async function createIncompleteGlobalProviderFixture() {
  const db = await getPrisma();
  createdIncompleteProviderId = `secsmoke-incomplete-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await db.customApiConfig.create({
    data: {
      id: createdIncompleteProviderId,
      ownerId: null,
      alias: "Security Smoke Incomplete Provider",
      type: "text",
      capability: "TEXT_GENERATOR",
      baseUrl: "https://example.com/v1",
      modelName: "security-smoke-model",
      encryptedKey: null,
      keyPreview: null,
      userAccessEnabled: true,
      isEnabled: true
    }
  });
  return createdIncompleteProviderId;
}

async function cleanupFixtures() {
  const db = prisma || (createdGlobalConfigId || createdIncompleteProviderId || createdGlobalUserAccessProviderIds.length > 0 || createdSmokeEmails.length > 0 ? await getPrisma() : null);
  if (createdGlobalConfigId) {
    await db.customApiConfig.deleteMany({ where: { id: createdGlobalConfigId } });
  }
  if (createdIncompleteProviderId) {
    await db.customApiConfig.deleteMany({ where: { id: createdIncompleteProviderId } });
  }
  if (createdGlobalUserAccessProviderIds.length > 0) {
    await db.customApiConfig.deleteMany({ where: { id: { in: createdGlobalUserAccessProviderIds } } });
  }
  if (createdWorkflowRunIds.length > 0) {
    await db.workflowRun.deleteMany({ where: { id: { in: createdWorkflowRunIds } } });
  }
  if (createdWorkflowIds.length > 0) {
    await db.workflow.deleteMany({ where: { id: { in: createdWorkflowIds } } });
  }
  if (createdSmokeEmails.length > 0) {
    await db.user.deleteMany({ where: { email: { in: createdSmokeEmails } } });
  }
  if (prisma) await prisma.$disconnect();
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") || "";
  return raw.split(",").map((part) => part.split(";")[0].trim()).filter((part) => part.startsWith("jiying_session=")).join("; ");
}

async function registerSmokeUser() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `secsmoke-${suffix}@example.test`;
  const response = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "SmokeTest123!", displayName: `Security Smoke ${suffix}`, username: `secsmoke-${suffix}` })
  });
  assert(response.status === 200, `Expected smoke registration 200, got ${response.status}`);
  assert(response.body?.user?.role === "USER", `Expected ordinary registration to create USER, got ${response.body?.user?.role}`);
  const cookie = cookieFrom(response);
  assert(cookie, "Expected registration to set a session cookie");
  createdSmokeEmails.push(email);
  return { email, cookie };
}

async function registerDeveloperSmokeUser() {
  const user = await registerSmokeUser();
  const db = await getPrisma();
  await db.user.update({ where: { email: user.email }, data: { role: "DEVELOPER" } });
  return user;
}

function connectWebSocket(path, cookie) {
  return new Promise(async (resolve, reject) => {
    const { WebSocket } = await import("ws");
    const wsUrl = `${baseUrl.replace(/^http/, "ws")}${path}`;
    const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timed out for ${path}`));
    }, 5000);
    ws.once("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForWsMessage(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    function onMessage(data) {
      let message = null;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (predicate(message)) {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve(message);
      }
    }
    ws.on("message", onMessage);
  });
}

async function main() {
  const checks = [];
  let smokeUser = null;

  checks.push(["health", async () => {
    const result = await request("/api/health");
    assert(result.status === 200, `Expected health 200, got ${result.status}`);
  }]);

  checks.push(["frontend-serves-with-security-headers", async () => {
    const result = await request("/");
    assert(result.status === 200, `Expected frontend 200, got ${result.status}`);
    assert(result.headers.get("x-content-type-options") === "nosniff", "Expected X-Content-Type-Options nosniff");
    assert(result.headers.get("x-frame-options") === "SAMEORIGIN", "Expected X-Frame-Options SAMEORIGIN");
    const csp = result.headers.get("content-security-policy") || "";
    assert(!!csp, "Expected Content-Security-Policy header");
    if (process.env.NODE_ENV === "production" || process.env.LOCAL_TEAM_MODE === "true") {
      assert(!csp.includes("'unsafe-eval'"), "Expected shared/production CSP to exclude unsafe-eval");
    }
  }]);

  for (const [name, path] of [
    ["unauth-chat-get-denied", "/api/chat"],
    ["unauth-prompt-history-get-denied", "/api/prompt-history"],
    ["unauth-saved-prompts-get-denied", "/api/saved-prompts"],
    ["unauth-canvas-state-get-denied", "/api/canvas-state"],
    ["unauth-workflows-get-denied", "/api/workflows"]
  ]) {
    checks.push([name, async () => {
      const result = await request(path);
      assert(result.status === 401, `Expected ${path} 401, got ${result.status}`);
    }]);
  }

  for (const [name, path, body] of [
    ["unauth-workflow-execute", "/api/workflow/execute", { node_id: "client-controlled", node_type: "image_generator", prompt: "x" }],
    ["unauth-pipeline-generate", "/api/pipeline/generate", { nodeId: "01", nodeName: "Script", prompt: "x" }],
    ["unauth-api-config-test", "/api/api-configs/test", { baseUrl: "http://127.0.0.1:5432", apiKey: "x" }],
    ["unauth-custom-ai-stream", "/api/custom-ai/stream", { systemPrompt: "x", userPrompt: "y" }],
    ["unauth-model-probe", "/api/model-params/probe", { type: "image", modelName: "test" }]
  ]) {
    checks.push([name, async () => {
      const result = await request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      assert(result.status === 401, `Expected ${path} 401, got ${result.status}`);
    }]);
  }

  checks.push(["unauth-news-crawl-denied", async () => {
    const result = await request("/api/news/crawl", { method: "POST" });
    assert(result.status === 401 || result.status === 403, `Expected news crawl 401/403, got ${result.status}`);
  }]);

  checks.push(["unauth-video-metadata-denied", async () => {
    const result = await request("/api/videos/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "smoke", title: "blocked" })
    });
    assert(result.status === 401, `Expected unauth video metadata 401, got ${result.status}`);
  }]);

  checks.push(["unauth-video-remove-denied", async () => {
    const result = await request("/api/videos/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "smoke" })
    });
    assert(result.status === 401, `Expected unauth video remove 401, got ${result.status}`);
  }]);

  checks.push(["unauth-video-upload-denied-before-file-handling", async () => {
    const form = new FormData();
    form.set("key", "smoke-video");
    form.set("file", new Blob(["not a video"], { type: "video/mp4" }), "fake.mp4");
    const result = await request("/api/videos/upload", { method: "POST", body: form });
    assert(result.status === 401, `Expected unauth video upload 401, got ${result.status}`);
  }]);

  checks.push(["unauth-task-status-denied", async () => {
    const result = await request("/api/workflow/status/not-a-real-task");
    assert(result.status === 401, `Expected unauth task status 401, got ${result.status}`);
  }]);

  checks.push(["ordinary-register-not-admin", async () => {
    smokeUser = await registerSmokeUser();
  }]);

  checks.push(["ordinary-user-cannot-manage-api-configs", async () => {
    const result = await request("/api/custom-api-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: smokeUser.cookie },
      body: JSON.stringify({ alias: "Smoke Provider", type: "text", baseUrl: "https://example.com", modelName: "smoke-model", apiKey: "sk-smoke" })
    });
    assert(result.status === 403, `Expected ordinary custom API config write 403, got ${result.status}`);
  }]);

  checks.push(["ordinary-user-cannot-list-global-api-configs", async () => {
    const result = await request("/api/custom-api-configs", {
      headers: { Cookie: smokeUser.cookie }
    });
    assert(result.status === 403, `Expected ordinary custom API config list 403, got ${result.status}`);
  }]);

  checks.push(["ordinary-user-cannot-use-global-provider-key", async () => {
    const configId = await createGlobalProviderFixture();
    const result = await request("/api/custom-ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: smokeUser.cookie },
      body: JSON.stringify({ configId })
    });
    assert(result.status === 403, `Expected ordinary global provider use 403, got ${result.status}`);
  }]);

  checks.push(["incomplete-global-provider-returns-400", async () => {
    const configId = await createIncompleteGlobalProviderFixture();
    const result = await request("/api/custom-ai/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: smokeUser.cookie },
      body: JSON.stringify({ configId, systemPrompt: "system", userPrompt: "hello" })
    });
    assert(result.status === 400, `Expected incomplete provider 400, got ${result.status}`);
    const message = typeof result.body?.error === "string" ? result.body.error : "";
    assert(message.includes("Provider is incomplete"), `Expected incomplete provider error, got ${JSON.stringify(result.body)}`);
  }]);

  checks.push(["ordinary-user-only-sees-enabled-global-text-models", async () => {
    const disabledId = await createGlobalUserAccessProviderFixture(false);
    const enabledId = await createGlobalUserAccessProviderFixture(true);
    const result = await request("/api/model-configs?capability=TEXT_GENERATOR", {
      headers: { Cookie: smokeUser.cookie }
    });
    assert(result.status === 200, `Expected ordinary model config list 200, got ${result.status}`);
    const ids = new Set((result.body?.models || []).map((item) => item.id));
    assert(ids.has(enabledId), "Expected ordinary user to see userAccessEnabled global text provider");
    assert(!ids.has(disabledId), "Expected ordinary user not to see disabled global text provider");
    const db = await getPrisma();
    await db.customApiConfig.deleteMany({ where: { id: { in: [disabledId, enabledId] } } });
  }]);

  checks.push(["ordinary-user-cannot-test-api-configs", async () => {
    const result = await request("/api/api-configs/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: smokeUser.cookie },
      body: JSON.stringify({ baseUrl: "https://example.com", apiKey: "sk-smoke" })
    });
    assert(result.status === 403, `Expected ordinary API config test 403, got ${result.status}`);
  }]);

  checks.push(["provider-test-rejects-private-targets", async () => {
    const developer = await registerDeveloperSmokeUser();
    const result = await request("/api/api-configs/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: developer.cookie },
      body: JSON.stringify({ baseUrl: "http://127.0.0.1:5432", apiKey: "sk-smoke", provider: "Smoke", alias: "Private target", type: "text", modelName: "smoke" })
    });
    assert(result.status === 400, `Expected private provider test URL 400, got ${result.status}`);
  }]);

  checks.push(["provider-create-rejects-private-targets", async () => {
    const developer = await registerDeveloperSmokeUser();
    const result = await request("/api/custom-api-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: developer.cookie },
      body: JSON.stringify({ alias: "Private target", type: "text", baseUrl: "http://localhost:11434", modelName: "smoke-model", apiKey: "sk-smoke" })
    });
    assert(result.status === 400, `Expected private provider create URL 400, got ${result.status}`);
  }]);

  checks.push(["upload-svg-rejected", async () => {
    const form = new FormData();
    form.set("key", "svg-test");
    form.set("file", new Blob(["<svg><script>alert(1)</script></svg>"], { type: "image/svg+xml" }), "x.svg");
    const result = await request("/api/media/upload", {
      method: "POST",
      headers: { Cookie: smokeUser.cookie },
      body: form
    });
    assert(result.status === 400, `Expected SVG upload rejection 400, got ${result.status}`);
  }]);

  checks.push(["developer-media-fake-mimetype-rejected", async () => {
    const developer = await registerDeveloperSmokeUser();
    const form = new FormData();
    form.set("title", "Fake image");
    form.set("file", new Blob(["not a real png"], { type: "image/png" }), "fake.png");
    const result = await request("/api/developer/media", {
      method: "POST",
      headers: { Cookie: developer.cookie },
      body: form
    });
    assert(result.status === 400, `Expected fake developer media upload 400, got ${result.status}`);
  }]);

  checks.push(["upload-path-traversal-sanitized", async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const form = new FormData();
    form.set("key", "../../evil");
    form.set("file", new Blob([pngBytes], { type: "image/png" }), "evil.png");
    const result = await request("/api/media/upload", {
      method: "POST",
      headers: { Cookie: smokeUser.cookie },
      body: form
    });
    assert(result.status === 200, `Expected sanitized PNG upload 200, got ${result.status}`);
    assert(typeof result.body?.url === "string" && result.body.url.startsWith("/api/media/assets/"), "Expected upload URL to use protected stream route");
    assert(!("storageUrl" in result.body), "Upload response must not expose internal storage URL");
    assert(!result.body.url.includes("..") && !result.body.url.includes("evil/"), `Unsafe upload URL: ${result.body.url}`);

    const ownerRead = await request(result.body.url, { headers: { Cookie: smokeUser.cookie } });
    assert(ownerRead.status === 200, `Expected owner stream read 200, got ${ownerRead.status}`);
  }]);

  checks.push(["unknown-upload-file-denied", async () => {
    const result = await request("/uploads/security-smoke-missing.png");
    assert(result.status === 404, `Expected unknown /uploads file 404, got ${result.status}`);
  }]);

  checks.push(["owner-only-upload-uses-protected-stream", async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const form = new FormData();
    form.set("key", "owner-only-test");
    form.set("file", new Blob([pngBytes], { type: "image/png" }), "owner-only.png");
    const upload = await request("/api/media/upload", {
      method: "POST",
      headers: { Cookie: smokeUser.cookie },
      body: form
    });
    assert(upload.status === 200, `Expected owner-only upload 200, got ${upload.status}`);
    assert(typeof upload.body?.url === "string" && upload.body.url.startsWith("/api/media/assets/"), "Expected protected stream URL");
    assert(!("storageUrl" in upload.body), "Upload response must not expose internal storage URL");
    const publicRead = await request(upload.body.url);
    assert(publicRead.status === 404, `Expected unauthenticated protected stream read 404, got ${publicRead.status}`);
  }]);

  checks.push(["workflow-inline-base64-denied", async () => {
    const result = await request("/api/workflow/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: smokeUser.cookie },
      body: JSON.stringify({ node_type: "image_generator", prompt: "x", images: ["data:image/png;base64,AAAA"] })
    });
    assert(result.status === 400, `Expected inline media workflow rejection 400, got ${result.status}`);
  }]);

  checks.push(["user-b-cannot-read-user-a-task", async () => {
    const userA = smokeUser || await registerSmokeUser();
    const userB = await registerSmokeUser();
    const createTask = await request("/api/workflow/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userA.cookie },
      body: JSON.stringify({ node_type: "video_generator", prompt: "security smoke local video" })
    });
    assert(createTask.status === 200, `Expected workflow task creation 200, got ${createTask.status}`);
    const taskId = createTask.body?.task_id;
    assert(typeof taskId === "string" && taskId.length > 10, "Expected workflow execute to return task_id");
    if (typeof createTask.body?.run_id === "string") createdWorkflowRunIds.push(createTask.body.run_id);
    const result = await request(`/api/workflow/status/${encodeURIComponent(taskId)}`, { headers: { Cookie: userB.cookie } });
    assert(result.status === 404, `Expected other user task status 404, got ${result.status}`);
  }]);

  checks.push(["workflow-execute-rejects-cross-user-workflow-and-sets-run-owner", async () => {
    const userA = smokeUser || await registerSmokeUser();
    const userB = await registerSmokeUser();
    const createWorkflow = await request("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userA.cookie },
      body: JSON.stringify({ name: "Security smoke owned workflow", reactFlow: { nodes: [], edges: [] } })
    });
    assert(createWorkflow.status === 201, `Expected workflow creation 201, got ${createWorkflow.status}`);
    const workflowId = createWorkflow.body?.workflow?.id;
    const versionId = createWorkflow.body?.workflow?.latestVersion?.id;
    assert(typeof workflowId === "string" && typeof versionId === "string", "Expected workflow and version ids");
    createdWorkflowIds.push(workflowId);

    const crossUser = await request("/api/workflow/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userB.cookie },
      body: JSON.stringify({ node_type: "video_generator", prompt: "blocked", workflow_id: workflowId, workflow_version_id: versionId })
    });
    assert(crossUser.status === 404 || crossUser.status === 403, `Expected cross-user workflow execute denial, got ${crossUser.status}`);

    const ownRun = await request("/api/workflow/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: userA.cookie },
      body: JSON.stringify({ node_type: "video_generator", prompt: "allowed", workflow_id: workflowId, workflow_version_id: versionId })
    });
    assert(ownRun.status === 200, `Expected owner workflow execute 200, got ${ownRun.status}`);
    const runId = ownRun.body?.run_id;
    assert(typeof runId === "string", "Expected workflow execute run_id");
    createdWorkflowRunIds.push(runId);
    const db = await getPrisma();
    const userARecord = await db.user.findUnique({ where: { email: userA.email }, select: { id: true } });
    const run = await db.workflowRun.findUnique({ where: { id: runId }, select: { ownerId: true, workflowId: true, versionId: true } });
    assert(run?.ownerId === userARecord?.id, "Expected workflow run ownerId to be set to executing user");
    assert(run.workflowId === workflowId, "Expected run workflowId to match request");
    assert(run.versionId === versionId, "Expected run versionId to match request");
  }]);

  checks.push(["websocket-oversized-message-rejected", async () => {
    const workflowResponse = await request("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: smokeUser.cookie },
      body: JSON.stringify({ name: "Security smoke WebSocket workflow", reactFlow: { nodes: [], edges: [] } })
    });
    assert(workflowResponse.status === 201, `Expected workflow creation 201, got ${workflowResponse.status}`);
    const workflowId = workflowResponse.body?.workflow?.id;
    assert(typeof workflowId === "string", "Expected workflow id for WebSocket smoke test");

    const ws = await connectWebSocket("/ws", smokeUser.cookie);
    try {
      await waitForWsMessage(ws, (message) => message.type === "connected");
      ws.send(JSON.stringify({ type: "join-workflow", workflowId }));
      await waitForWsMessage(ws, (message) => message.type === "joined");
      ws.send(JSON.stringify({ type: "canvas-event", payload: { data: "x".repeat(70 * 1024) } }));
      const error = await waitForWsMessage(ws, (message) => message.type === "error");
      assert(String(error.error || "").toLowerCase().includes("large"), `Expected oversized WebSocket error, got ${JSON.stringify(error)}`);
    } finally {
      ws.close();
    }
  }]);

  try {
    for (const [name, check] of checks) {
      await check();
      console.log(`ok - ${name}`);
    }
  } finally {
    await cleanupFixtures();
  }
}

main().catch((error) => {
  console.error(`security smoke failed: ${error.message}`);
  cleanupFixtures().finally(() => {
    process.exitCode = 1;
  });
});
