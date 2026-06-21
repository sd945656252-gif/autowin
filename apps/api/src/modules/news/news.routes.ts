import type express from "express";
import cron from "node-cron";
import { AuditAction, UserRole } from "@prisma/client";
import { requireRoles } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";
import {
  broadcastWebSearchStatus,
  ensureBroadcastCache,
  readBroadcastItemsFlat,
  readBroadcastNews,
  runScheduledNewsRefresh
} from "./news-broadcast.service";
import {
  ensureArenaCache,
  readArenaSnapshot,
  runScheduledArenaRefresh,
} from "./news.service";

function isDateGroup(value: unknown): value is string {
  return typeof value === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(value);
}

async function refreshNewsWithAudit(req: express.Request, dateGroup?: string) {
  const actor = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
  const startedAt = new Date().toISOString();
  try {
    const result = await runScheduledNewsRefresh({ reason: "manual", dateGroup });
    await writeAuditLog({
      actor,
      action: AuditAction.UPDATE,
      entityType: "IndustryNewsBroadcast",
      entityId: dateGroup || "today",
      req,
      metadata: {
        module: "news-broadcast",
        dateGroup: dateGroup || null,
        triggeredAt: startedAt,
        sourceCount: result.sourceCount,
        fetchedCount: result.fetchedCount,
        filteredCount: result.filteredCount,
        pendingReviewCount: result.pendingReviewCount,
        translation: result.translation || null,
        status: result.status,
        message: result.message || null,
        scheduler: result.scheduler || null
      }
    });
    return result;
  } catch (error: any) {
    await writeAuditLog({
      actor,
      action: AuditAction.UPDATE,
      entityType: "IndustryNewsBroadcast",
      entityId: dateGroup || "today",
      req,
      metadata: {
        module: "news-broadcast",
        dateGroup: dateGroup || null,
        triggeredAt: startedAt,
        status: "failed",
        error: error?.message || String(error)
      }
    });
    throw error;
  }
}

async function refreshArenaWithAudit(req: express.Request) {
  const actor = await requireRoles(req, [UserRole.ADMIN, UserRole.DEVELOPER]);
  const startedAt = new Date().toISOString();
  try {
    const snapshot = await runScheduledArenaRefresh("manual");
    await writeAuditLog({
      actor,
      action: AuditAction.UPDATE,
      entityType: "IndustryModelArena",
      entityId: "snapshot",
      req,
      metadata: {
        module: "model-arena",
        triggeredAt: startedAt,
        status: snapshot.status,
        itemCount: snapshot.items.length,
        sourceCount: snapshot.sources.length,
        sourceStatuses: snapshot.sourceStatuses.map((source) => ({ source: source.source, ok: source.ok, statusCode: source.statusCode, itemCount: source.itemCount || 0, parsedMetricCount: source.parsedMetricCount || 0, message: source.message || null })),
        message: snapshot.message || null,
        scheduler: snapshot.scheduler || null
      }
    });
    return snapshot;
  } catch (error: any) {
    await writeAuditLog({
      actor,
      action: AuditAction.UPDATE,
      entityType: "IndustryModelArena",
      entityId: "snapshot",
      req,
      metadata: {
        module: "model-arena",
        triggeredAt: startedAt,
        status: "failed",
        error: error?.message || String(error)
      }
    });
    throw error;
  }
}

export function registerNewsRoutes(app: express.Express) {
  if (process.env.DISABLE_STARTUP_NEWS_REFRESH === "true") {
    console.log("[NewsBroadcast] Startup news refresh is disabled by DISABLE_STARTUP_NEWS_REFRESH=true.");
  } else {
    ensureBroadcastCache().catch((error) => console.error("[NewsBroadcast] Startup cache initialization failed:", error));
    ensureArenaCache().catch((error) => console.error("[ModelArena] Startup cache initialization failed:", error));
  }

  cron.schedule("55 8 * * *", () => {
    console.log("[NewsBroadcast] Running scheduled daily broadcast refresh...");
    runScheduledNewsRefresh({ reason: "cron" })
      .then((result) => console.log("[NewsBroadcast] Scheduled broadcast refresh finished", {
        status: result.status,
        fetchedCount: result.fetchedCount,
        schedulerStatus: result.scheduler?.lastScheduledStatus
      }))
      .catch((error) => console.error("[NewsCrawler] Scheduled broadcast refresh failed:", error));
  }, { timezone: "Asia/Shanghai" });

  cron.schedule("55 8 * * *", () => {
    console.log("[ModelArena] Running scheduled model arena refresh...", { reason: "cron" });
    runScheduledArenaRefresh("cron")
      .then((snapshot) => console.log("[ModelArena] Scheduled model arena refresh finished", {
        status: snapshot.status,
        itemCount: snapshot.items.length,
        schedulerStatus: snapshot.scheduler?.lastStatus,
        sourceOkCount: snapshot.sourceStatuses.filter((source) => source.ok).length
      }))
      .catch((error) => console.error("[ModelArena] Scheduled arena refresh failed:", error));
  }, { timezone: "Asia/Shanghai" });

  app.get("/api/news", async (_req, res) => {
    res.json(await readBroadcastItemsFlat());
  });

  app.get("/api/news/broadcast", async (_req, res) => {
    const broadcast = await readBroadcastNews();
    res.json({ ...broadcast, webSearch: broadcastWebSearchStatus() });
  });

  app.post("/api/news/broadcast/refresh", async (req, res) => {
    try {
      const rawDate = req.body?.date || req.body?.dateGroup;
      if (rawDate && !isDateGroup(rawDate)) {
        res.status(400).json({ success: false, error: "Invalid date. Expected YYYY-MM-DD." });
        return;
      }
      const result = await refreshNewsWithAudit(req, rawDate || undefined);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(error?.status || 500).json({ success: false, error: error?.message || "News refresh failed." });
    }
  });

  app.post("/industry/news/refresh", async (req, res) => {
    try {
      const rawDate = req.body?.date || req.body?.dateGroup;
      if (!isDateGroup(rawDate)) {
        res.status(400).json({ success: false, error: "Invalid date. Expected YYYY-MM-DD." });
        return;
      }
      const result = await refreshNewsWithAudit(req, rawDate);
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(error?.status || 500).json({ success: false, error: error?.message || "News refresh failed." });
    }
  });

  app.get("/api/news/arena", async (_req, res) => {
    res.json(await readArenaSnapshot());
  });

  app.post("/api/news/arena/refresh", async (req, res) => {
    try {
      const snapshot = await refreshArenaWithAudit(req);
      res.json({ success: true, snapshot });
    } catch (error: any) {
      res.status(error?.status || 500).json({ success: false, error: error?.message || "Arena refresh failed." });
    }
  });

  app.post("/industry/model-arena/refresh", async (req, res) => {
    try {
      const snapshot = await refreshArenaWithAudit(req);
      res.json({ success: true, snapshot });
    } catch (error: any) {
      res.status(error?.status || 500).json({ success: false, error: error?.message || "Arena refresh failed." });
    }
  });

  app.post("/api/news/crawl", async (req, res) => {
    try {
      const result = await refreshNewsWithAudit(req);
      res.json({ success: true, message: "Crawl completed.", result });
    } catch (error: any) {
      res.status(error?.status || 500).json({ success: false, error: error?.message || "Crawl failed." });
    }
  });
}
