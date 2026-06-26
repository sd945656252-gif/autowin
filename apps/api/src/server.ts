import express from "express";
import http from "http";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { registerAdminRoutes } from "./modules/admin/admin.routes";
import { registerAuthRoutes } from "./modules/auth/auth.routes";
import { registerCustomAiRoutes } from "./modules/custom-ai/custom-ai.routes";
import { registerCustomApiConfigRoutes } from "./modules/custom-api-configs/custom-api-configs.routes";
import { loadLocalApiProviderConfig } from "./modules/custom-api-configs/local-provider-config";
import { registerDeveloperMediaRoutes } from "./modules/developer/developer-media.routes";
import { registerDeveloperSystemRoutes } from "./modules/developer/developer-system.routes";
import { registerEditingRoutes } from "./modules/editing/editing.routes";
import { registerMediaRoutes } from "./modules/media/media.routes";
import { registerModelParamRoutes } from "./modules/model-params/model-params.routes";
import { registerModelCapabilityRoutes } from "./modules/model-capabilities/model-capabilities.routes";
import { ensureDefaultCapabilityProfiles } from "./modules/model-capabilities/model-capabilities.service";
import { syncOfficialCapabilityJson } from "./modules/model-capabilities/official-capability-sync.service";
import { registerNewsRoutes } from "./modules/news/news.routes";
import { registerNotificationRoutes } from "./modules/notifications/notifications.routes";
import { registerPipelineAssistantRoutes } from "./modules/pipeline-assistant/pipeline-assistant.routes";
import { registerInternalAssetRoutes } from "./modules/internal-assets/internal-assets.routes";
import { registerProductionAssetRoutes } from "./modules/production-assets/production-assets.routes";
import { ensurePromptOptimizationProfiles, registerPromptOptimizationRoutes } from "./modules/prompt-optimization/prompt-optimization.routes";
import { registerWorkflowWebSocket } from "./modules/realtime/workflow-ws";
import { registerScriptProcessingWorker, registerScriptWorkbenchRoutes } from "./modules/scripts/script-workbench.routes";
import { registerSlashAssetRoutes } from "./modules/slash-assets/slash-assets.routes";
import { registerTeamProjectRoutes } from "./modules/team-projects/team-projects.routes";
import { registerUserDataRoutes } from "./modules/user-data/user-data.routes";
import { cachePresetVideosLocally, logShowcaseTranscodeReadiness } from "./modules/video-registry/video-registry.service";
import { registerVideoRegistryRoutes } from "./modules/video-registry/video-registry.routes";
import { registerWorkflowExecuteRoutes, registerWorkflowExecutionWorker } from "./modules/workflow/workflow-execute.routes";
import { registerWorkflowRoutes } from "./modules/workflow/workflow.routes";
import { registerWorkflowSupportRoutes } from "./modules/workflow/workflow-support.routes";
import { registerWorkflowTaskRoutes } from "./modules/workflow/workflow-task.routes";
import { resolveRequestUser } from "./modules/auth/auth.shared";
import { canReadMediaAsset, findMediaAssetByStorageKey } from "./modules/media/media.service";
import { applyAiRateLimit, applyCorsAndUtf8, applySecurityHeaders, applyUnsafeRequestOriginGuard, applyWriteRateLimit, createRateLimiter, logSecurityWarnings } from "./security/http-security";
import { configureOutboundProxy } from "./shared/outbound-proxy";
import { getUploadsDir } from "./shared/storage-paths";

dotenv.config();
configureOutboundProxy();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const LISTEN_HOST = process.env.HOST || "0.0.0.0";
const uploadsDir = getUploadsDir();
const DEV_BOOT_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function getLanUrls(port: number) {
  return Object.values(os.networkInterfaces())
    .flatMap((items) => items || [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);
}

let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not defined. Please configure it before using AI generation.");
    }

    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return aiClient;
}

app.use(applySecurityHeaders);
app.use(applyCorsAndUtf8);
app.use(applyUnsafeRequestOriginGuard);
app.use("/api/auth", createRateLimiter({ keyPrefix: "auth", windowMs: 60_000, max: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE || 20) }));
app.use(["/api/workflow/execute", "/api/workflow/scene3d", "/api/workflow/check", "/api/pipeline/generate", "/api/pipeline", "/api/api-configs/test", "/api/custom-ai", "/api/model-params", "/api/news/crawl", "/api/news/broadcast/refresh", "/api/news/arena/refresh", "/api/scripts/import", "/api/scripts/ideas"], applyAiRateLimit);
app.use("/api", applyWriteRateLimit);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));

app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    uptime: Math.round(process.uptime()),
    runtime: {
      container: process.env.RUNNING_IN_DOCKER === "1",
      nodeEnv: process.env.NODE_ENV || "development"
    }
  });
});

app.get("/api/dev/boot", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ success: false });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    bootId: DEV_BOOT_ID,
    pid: process.pid,
    startedAt: new Date(Number.parseInt(DEV_BOOT_ID.split("-")[0], 36)).toISOString()
  });
});

app.use(
  "/uploads",
  async (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      res.status(405).send("Method Not Allowed");
      return;
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const relativeUrl = req.url || req.path || req.originalUrl.replace(/^\/uploads\/?/, "");
      const storageKey = decodeURIComponent(relativeUrl.split("?")[0].replace(/^\/+/, ""));
      const asset = await findMediaAssetByStorageKey(storageKey);
      if (asset) {
        const requestUser = await resolveRequestUser(req, { allowGuest: true });
        if (!canReadMediaAsset(requestUser, asset)) {
          res.status(404).send("Not Found");
          return;
        }
        if (asset.visibility !== "PUBLIC") {
          res.status(404).send("Not Found");
          return;
        }
      } else {
        res.status(404).send("Not Found");
        return;
      }
      next();
    } catch {
      res.status(404).send("Not Found");
    }
  },
  express.static(uploadsDir)
);

app.get("/api/config", (_req, res) => {
  if (process.env.NODE_ENV !== "production") {
    res.json({ isConfigured: !!process.env.GEMINI_API_KEY });
  } else {
    res.status(404).json({ success: false });
  }
});

registerVideoRegistryRoutes(app);
registerNewsRoutes(app);
registerMediaRoutes(app);
registerModelCapabilityRoutes(app);
registerModelParamRoutes(app);
registerAuthRoutes(app);
registerAdminRoutes(app);
registerDeveloperMediaRoutes(app);
registerDeveloperSystemRoutes(app);
registerTeamProjectRoutes(app);
registerProductionAssetRoutes(app);
registerInternalAssetRoutes(app);
registerSlashAssetRoutes(app);
registerNotificationRoutes(app);
registerPromptOptimizationRoutes(app);
registerPipelineAssistantRoutes(app);
registerEditingRoutes(app);
registerUserDataRoutes(app);
registerCustomApiConfigRoutes(app);
registerCustomAiRoutes(app);
registerScriptWorkbenchRoutes(app, { getAI });
registerWorkflowRoutes(app);
registerWorkflowSupportRoutes(app, { getAI });
registerWorkflowExecuteRoutes(app, { getAI });
registerWorkflowTaskRoutes(app);
if (process.env.WORKFLOW_WORKER_ENABLED === "true") {
  registerWorkflowExecutionWorker({ getAI });
}
if (process.env.SCRIPT_WORKER_ENABLED === "true") {
  registerScriptProcessingWorker({ getAI });
}

async function bootstrap() {
  logSecurityWarnings();

  await loadLocalApiProviderConfig();
  await ensureDefaultCapabilityProfiles();
  await ensurePromptOptimizationProfiles();
  await syncOfficialCapabilityJson().catch((error) => {
    console.warn("[ModelCapabilities] Trusted official capability JSON sync failed:", error);
  });
  await logShowcaseTranscodeReadiness();

  cachePresetVideosLocally().catch((error) => {
    console.warn("[PresetCache] Initialization task returned error:", error);
  });

  const server = http.createServer(app);

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: path.join(process.cwd(), "apps", "web"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa"
    });
    const devReloadFiles = [
      path.join(process.cwd(), "apps", "api", "src", "modules", "custom-ai", "provider-client.ts"),
      path.join(process.cwd(), "apps", "api", "src", "modules", "workflow", "provider-adapters", "index.ts"),
      path.join(process.cwd(), "apps", "api", "src", "modules", "model-capabilities", "model-capabilities.schema.ts"),
      path.join(process.cwd(), "apps", "api", "src", "modules", "model-capabilities", "model-capabilities.service.ts"),
      path.join(process.cwd(), "apps", "api", "src", "modules", "model-capabilities", "model-capabilities.registry.ts"),
      path.join(process.cwd(), "config", "model-capabilities.official.json")
    ];
    devReloadFiles.forEach((file) => vite.watcher.add(file));
    vite.watcher.on("change", (file) => {
      if (!devReloadFiles.includes(path.resolve(file))) return;
      vite.ws.send({ type: "full-reload", path: "*" });
    });
    app.use(vite.middlewares);
    console.log("Vite development server middleware loaded.");
  } else {
    const distPath = path.join(process.cwd(), "dist", "web");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static production assets from /dist.");
  }

  registerWorkflowWebSocket(server);
  server.listen({ port: PORT, host: LISTEN_HOST, ipv6Only: false }, () => {
    console.log(`Server running at http://localhost:${PORT} (listening on ${LISTEN_HOST})`);
    const publicAppUrl = process.env.PUBLIC_APP_URL || process.env.APP_URL;
    if (publicAppUrl) console.log(`Configured public URL: ${publicAppUrl}`);
    const lanUrls = process.env.RUNNING_IN_DOCKER === "1" ? [] : getLanUrls(PORT);
    if (lanUrls.length > 0) {
      console.log(`LAN preview URLs: ${lanUrls.join(", ")}`);
    }
  });
}

bootstrap();
