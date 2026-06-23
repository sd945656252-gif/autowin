import type http from "http";
import { WebSocketServer, type WebSocket } from "ws";
import type { UserRole } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { getSessionUser, parseCookies } from "../auth/auth.shared";
import { writeAuditLog } from "../audit/audit.service";

type ClientState = {
  userId: string;
  role: UserRole;
  displayName: string;
  workflowId?: string;
  messageWindowStartedAt: number;
  messageCount: number;
  violations: number;
  req?: http.IncomingMessage;
};

const clients = new Map<WebSocket, ClientState>();
const MAX_WS_MESSAGE_BYTES = Number(process.env.WS_MAX_MESSAGE_BYTES || 64 * 1024);
const WS_RATE_WINDOW_MS = Number(process.env.WS_RATE_WINDOW_MS || 60_000);
const WS_RATE_LIMIT = Number(process.env.WS_RATE_LIMIT_PER_MINUTE || 120);
const WS_MAX_VIOLATIONS = Number(process.env.WS_MAX_VIOLATIONS || 3);
const ALLOWED_MESSAGE_TYPES = new Set(["join-workflow", "canvas-event", "node-event", "edge-event", "node-config-event", "save-revision"]);

function send(socket: WebSocket, payload: any) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function roomClients(workflowId: string) {
  return Array.from(clients.entries()).filter(([, state]) => state.workflowId === workflowId);
}

function broadcast(workflowId: string, payload: any, except?: WebSocket) {
  for (const [socket] of roomClients(workflowId)) {
    if (socket !== except) send(socket, payload);
  }
}

function broadcastPresence(workflowId: string) {
  const users = roomClients(workflowId).map(([, state]) => ({ userId: state.userId, displayName: state.displayName }));
  broadcast(workflowId, { type: "presence", workflowId, users });
}

function messageByteLength(raw: WebSocket.RawData) {
  if (Buffer.isBuffer(raw)) return raw.length;
  if (Array.isArray(raw)) return raw.reduce((sum, item) => sum + item.length, 0);
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  return Buffer.byteLength(String(raw));
}

function recordViolation(socket: WebSocket, state: ClientState, error: string) {
  state.violations += 1;
  send(socket, { type: "error", error });
  void writeAuditLog({
    actor: { id: state.userId, role: state.role, isGuest: false },
    action: "ACCESS",
    entityType: "WorkflowWebSocket",
    entityId: state.workflowId || null,
    metadata: {
      decision: "denied",
      reason: error,
      violations: state.violations
    },
    req: state.req as any
  });
  if (state.violations >= WS_MAX_VIOLATIONS) {
    socket.close(1008, "WebSocket policy violation");
  }
}

function assertRateLimit(socket: WebSocket, state: ClientState) {
  const now = Date.now();
  if (now - state.messageWindowStartedAt > WS_RATE_WINDOW_MS) {
    state.messageWindowStartedAt = now;
    state.messageCount = 0;
  }
  state.messageCount += 1;
  if (state.messageCount > WS_RATE_LIMIT) {
    recordViolation(socket, state, "Too many WebSocket messages. Slow down and retry.");
    return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidWorkflowId(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}

function isValidEventPayload(message: any) {
  if (["canvas-event", "node-event", "edge-event", "node-config-event"].includes(message.type)) {
    if (!isPlainObject(message.payload)) return false;
    return Buffer.byteLength(JSON.stringify(message.payload)) <= MAX_WS_MESSAGE_BYTES;
  }
  if (message.type === "save-revision") {
    return Number.isInteger(Number(message.revision)) && Number(message.revision) >= 0;
  }
  return true;
}

async function canAccessWorkflow(workflowId: string, userId: string) {
  const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, ownerId: userId } });
  return Boolean(workflow);
}

async function handleMessage(socket: WebSocket, raw: WebSocket.RawData) {
  const state = clients.get(socket);
  if (!state) return;

  if (messageByteLength(raw) > MAX_WS_MESSAGE_BYTES) {
    recordViolation(socket, state, "WebSocket message is too large.");
    return;
  }

  if (!assertRateLimit(socket, state)) return;

  let message: any;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    send(socket, { type: "error", error: "Invalid JSON message." });
    return;
  }

  if (!ALLOWED_MESSAGE_TYPES.has(message.type)) {
    recordViolation(socket, state, "Unknown message type.");
    return;
  }

  if (message.type === "join-workflow") {
    const workflowId = String(message.workflowId || "");
    if (!isValidWorkflowId(workflowId) || !(await canAccessWorkflow(workflowId, state.userId))) {
      send(socket, { type: "error", error: "Forbidden workflow." });
      return;
    }
    state.workflowId = workflowId;
    send(socket, { type: "joined", workflowId });
    broadcastPresence(workflowId);
    return;
  }

  if (!state.workflowId) {
    send(socket, { type: "error", error: "Join a workflow before sending events." });
    return;
  }

  if (!isValidEventPayload(message)) {
    recordViolation(socket, state, "Invalid WebSocket payload.");
    return;
  }

  if (["canvas-event", "node-event", "edge-event", "node-config-event"].includes(message.type)) {
    broadcast(state.workflowId, { ...message, workflowId: state.workflowId, actorId: state.userId }, socket);
    return;
  }

  if (message.type === "save-revision") {
    const expectedRevision = Number(message.revision);
    const workflow = await prisma.workflow.findUnique({ where: { id: state.workflowId }, select: { draftRevision: true } });
    if (!workflow || workflow.draftRevision !== expectedRevision) {
      send(socket, { type: "revision-conflict", workflowId: state.workflowId, currentRevision: workflow?.draftRevision ?? null });
      return;
    }
    const updated = await prisma.workflow.update({ where: { id: state.workflowId }, data: { draftRevision: { increment: 1 } } });
    broadcast(state.workflowId, { type: "revision-updated", workflowId: state.workflowId, revision: updated.draftRevision, actorId: state.userId });
    send(socket, { type: "revision-updated", workflowId: state.workflowId, revision: updated.draftRevision, actorId: state.userId });
    return;
  }

  send(socket, { type: "error", error: "Unknown message type." });
}

export function registerWorkflowWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (pathname !== "/ws") return;

    const fakeReq: any = { headers: req.headers };
    const token = parseCookies(fakeReq).jiying_session;
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const user = await getSessionUser(fakeReq).catch(() => null);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.set(ws, {
        userId: user.id,
        role: user.role,
        displayName: user.displayName || user.email || user.id,
        messageWindowStartedAt: Date.now(),
        messageCount: 0,
        violations: 0,
        req
      });
      send(ws, { type: "connected", userId: user.id });
      ws.on("message", (raw) => void handleMessage(ws, raw));
      ws.on("close", () => {
        const previous = clients.get(ws);
        clients.delete(ws);
        if (previous?.workflowId) broadcastPresence(previous.workflowId);
      });
    });
  });

  console.log("Workflow WebSocket gateway mounted at /ws.");
}
