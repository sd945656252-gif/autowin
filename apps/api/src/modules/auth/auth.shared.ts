import crypto from "crypto";
import type express from "express";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { HttpError } from "../../shared/http";

export type RequestUser = {
  id: string;
  role: UserRole | "GUEST";
  isGuest: boolean;
};

export type LocalAuthUser = {
  id: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  passwordHash?: string | null;
  role: UserRole;
  status: UserStatus;
  lastSeenAt?: Date | null;
};

export function canAccessDeveloper(role: UserRole | "GUEST") {
  return role === UserRole.ADMIN || role === UserRole.DEVELOPER;
}

export function canAccessAdmin(role: UserRole | "GUEST") {
  return role === UserRole.ADMIN;
}

export function isPrimaryAdminEmail(email?: string | null): boolean {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const configuredEmails = (process.env.PRIMARY_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return configuredEmails.includes(normalizedEmail);
}

export function parseCookies(req: express.Request): Record<string, string> {
  const rawCookie = req.headers.cookie || "";
  return rawCookie.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index < 0) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
    return cookies;
  }, {} as Record<string, string>);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 40);
}

export function passwordHash(password: string, salt = crypto.randomBytes(16).toString("base64url")): string {
  if (arguments.length === 1) {
    return `bcrypt$${bcrypt.hashSync(password, 12)}`;
  }
  const derived = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash?: string | null): boolean {
  if (!storedHash) return false;
  if (storedHash.startsWith("bcrypt$")) {
    return bcrypt.compareSync(password, storedHash.slice("bcrypt$".length));
  }
  const [scheme, salt, expected] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = passwordHash(password, salt).split("$")[2];
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function needsPasswordRehash(storedHash?: string | null) {
  return Boolean(storedHash && !storedHash.startsWith("bcrypt$"));
}

export function serializeLocalUser(user: LocalAuthUser) {
  return {
    id: user.id,
    uid: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    photoURL: user.avatarUrl,
    hasPassword: Boolean(user.passwordHash),
    role: user.role,
    capabilities: {
      developer: canAccessDeveloper(user.role),
      admin: canAccessAdmin(user.role)
    }
  };
}

export async function serializeLocalUserWithProjectRoles(user: LocalAuthUser) {
  const now = new Date();
  const [memberships, teamLeaderGrants] = await Promise.all([
    prisma.productionProjectMember.findMany({
      where: { userId: user.id },
      select: { projectId: true, role: true }
    }),
    prisma.productionProjectRoleGrant.findMany({
      where: {
        userId: user.id,
        role: "PROJECT_DEVELOPER",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      },
      select: { projectId: true, expiresAt: true }
    })
  ]);
  const serializedTeamLeaderGrants = teamLeaderGrants.map((grant) => ({
    projectId: grant.projectId,
    expiresAt: grant.expiresAt?.toISOString?.() || grant.expiresAt || null
  }));
  return {
    ...serializeLocalUser(user),
    projectRoles: {
      memberships,
      teamLeaderGrants: serializedTeamLeaderGrants,
      projectDeveloperGrants: serializedTeamLeaderGrants
    }
  };
}

export function setSessionCookie(res: express.Response, token: string, expiresAt: Date) {
  const isSecure = process.env.NODE_ENV === "production";
  const parts = [
    `jiying_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`
  ];
  if (isSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: express.Response) {
  res.setHeader("Set-Cookie", "jiying_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
}

export async function getSessionUser(req: express.Request): Promise<LocalAuthUser | null> {
  const token = parseCookies(req).jiying_session;
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== UserStatus.ACTIVE) {
    return null;
  }

  return session.user;
}

export async function createLocalSession(req: express.Request, res: express.Response, userId: string) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  await prisma.$transaction([
    prisma.authSession.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        userAgent: req.headers["user-agent"] || null,
        ipAddress: req.ip
      }
    }),
    prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
  ]);
  setSessionCookie(res, token, expiresAt);
}

export async function touchCurrentUser(req: express.Request) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) {
    throw new HttpError(401, "Authentication is required.");
  }
  return prisma.user.update({
    where: { id: sessionUser.id },
    data: { lastSeenAt: new Date() }
  });
}

export async function refreshLocalSession(req: express.Request, res: express.Response) {
  const token = parseCookies(req).jiying_session;
  if (!token) throw new HttpError(401, "Authentication is required.");

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== UserStatus.ACTIVE) {
    clearSessionCookie(res);
    throw new HttpError(401, "Authentication is required.");
  }

  await prisma.authSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() }
  });
  await createLocalSession(req, res, session.userId);
  return session.user;
}

export function getRequestedUserId(req: express.Request): string | null {
  const queryUserId = typeof req.query.userId === "string" ? req.query.userId : null;
  return queryUserId;
}

export async function resolveRequestUser(req: express.Request, options: { allowGuest?: boolean } = {}): Promise<RequestUser> {
  const requestedUserId = getRequestedUserId(req);
  const sessionUser = await getSessionUser(req);

  if (sessionUser) {
    if (requestedUserId && requestedUserId !== "guest" && requestedUserId !== sessionUser.id) {
      throw new HttpError(403, "Forbidden.");
    }
    return { id: sessionUser.id, role: sessionUser.role, isGuest: false };
  }

  if (options.allowGuest === false) {
    throw new HttpError(401, "Authentication is required.");
  }
  if (requestedUserId && requestedUserId !== "guest") {
    throw new HttpError(401, "Authentication is required.");
  }
  return { id: "guest", role: "GUEST", isGuest: true };
}

export async function requireAuth(req: express.Request): Promise<RequestUser> {
  return resolveRequestUser(req, { allowGuest: false });
}

export async function requireRoles(req: express.Request, roles: UserRole[]): Promise<RequestUser> {
  const requestUser = await requireAuth(req);
  if (requestUser.isGuest || !roles.includes(requestUser.role as UserRole)) {
    throw new HttpError(403, "Forbidden.");
  }
  return requestUser;
}
