import type { AuditAction } from "@prisma/client";
import type express from "express";
import { prisma } from "../../db/prisma";
import type { RequestUser } from "../auth/auth.shared";

export async function writeAuditLog(input: {
  actor: RequestUser;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  req?: express.Request;
  metadata?: any;
  beforeJson?: any;
  afterJson?: any;
}) {
  return prisma.auditLog.create({
    data: {
      actorId: input.actor.isGuest ? null : input.actor.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      ip: input.req?.ip || null,
      userAgent: input.req?.headers["user-agent"] || null,
      metadata: input.metadata ?? undefined,
      beforeJson: input.beforeJson ?? undefined,
      afterJson: input.afterJson ?? undefined
    }
  }).catch((error) => {
    console.warn("[Audit] Failed to write audit log:", error);
    return null;
  });
}
