import crypto from "crypto";
import { z } from "zod";

const SENSITIVE_WORKFLOW_STATE_KEYS = /(^|[_-])(api[_-]?key|custom[_-]?key|authorization|bearer|token|secret|password)($|[_-])/i;
const REDACTED_WORKFLOW_STATE_SECRET = "[REDACTED]";

const workflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().optional(),
  position: z.object({
    x: z.number(),
    y: z.number()
  }).optional(),
  config: z.record(z.string(), z.any()).optional(),
  data: z.record(z.string(), z.any()).optional()
});

const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional().nullable(),
  targetHandle: z.string().optional().nullable(),
  data: z.record(z.string(), z.any()).optional()
});

export const workflowSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  metadata: z.record(z.string(), z.any()).optional()
});

export type WorkflowSchema = z.infer<typeof workflowSchema>;

export function redactWorkflowState(value: any): any {
  if (Array.isArray(value)) return value.map((item) => redactWorkflowState(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => {
    if (SENSITIVE_WORKFLOW_STATE_KEYS.test(key)) {
      return [key, nestedValue ? REDACTED_WORKFLOW_STATE_SECRET : nestedValue];
    }
    return [key, redactWorkflowState(nestedValue)];
  }));
}

export function normalizeCanvasStateToWorkflowSchema(state: any): WorkflowSchema {
  const cleanState = redactWorkflowState(state || {});
  const nodes = Array.isArray(cleanState?.nodes) ? cleanState.nodes : [];
  const shotNodes = Array.isArray(cleanState?.shotNodes) ? cleanState.shotNodes : [];
  const edges = Array.isArray(cleanState?.edges) ? cleanState.edges : [];

  const normalizedNodes = [...nodes, ...shotNodes].map((node: any) => ({
    id: String(node.id || crypto.randomUUID()),
    type: String(node.type || node.moduleType || "custom"),
    name: typeof node.name === "string" ? node.name : undefined,
    position: {
      x: Number(node.x || node.position?.x || 0),
      y: Number(node.y || node.position?.y || 0)
    },
    config: node
  }));

  const parentEdges = normalizedNodes
    .filter((node: any) => node.config?.parentId)
    .map((node: any) => ({
      id: `${node.config.parentId}->${node.id}`,
      source: String(node.config.parentId),
      target: node.id
    }));

  return workflowSchema.parse({
    schemaVersion: 1,
    nodes: normalizedNodes,
    edges: edges.length > 0 ? edges : parentEdges,
    metadata: {
      source: "canvas_state",
      shots: Array.isArray(cleanState?.shots) ? cleanState.shots : [],
      apiConfigCount: Array.isArray(cleanState?.apiConfigs) ? cleanState.apiConfigs.length : 0
    }
  });
}

export function parseWorkflowSchema(input: any): WorkflowSchema {
  return workflowSchema.parse(redactWorkflowState(input));
}

