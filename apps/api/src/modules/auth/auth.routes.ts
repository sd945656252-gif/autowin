import type express from "express";
import crypto from "crypto";
import fs from "fs";
import { MediaAssetType, MediaVisibility, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { getRedisConnection } from "../../queue/redis";
import { HttpError, sendApiError } from "../../shared/http";
import { decodeJwtPart } from "../../shared/jwt";
import { getUploadFilePath, getUploadsDir } from "../../shared/storage-paths";
import { findMediaAssetByStorageKey, recordLocalMediaAsset } from "../media/media.service";
import { hasValidMagicNumber } from "../media/media.upload";
import {
  clearSessionCookie,
  createLocalSession,
  getSessionUser,
  hashToken,
  isPrimaryAdminEmail,
  needsPasswordRehash,
  normalizeEmail,
  normalizeUsername,
  parseCookies,
  passwordHash,
  requireAuth,
  refreshLocalSession,
  serializeLocalUser,
  serializeLocalUserWithProjectRoles,
  touchCurrentUser,
  verifyPassword
} from "./auth.shared";

const OAUTH_STATE_TTL_SECONDS = 600;
const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_AVATAR_URL_LENGTH = 120_000;
const MAX_AVATAR_BYTES = 512 * 1024;
const GOOGLE_OAUTH_PROMPTS = new Set(["none", "consent", "select_account"]);
const AVATAR_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([a-z0-9+/=\s]+)$/i;

type StoredOAuthState = {
  nonceHash?: string;
  createdAt?: string;
};

function assertProfileInput(displayName: string, avatarUrl: string | null) {
  if (!displayName.trim()) throw new HttpError(400, "Display name is required.", "DISPLAY_NAME_REQUIRED");
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) throw new HttpError(400, "Display name is too long.", "DISPLAY_NAME_TOO_LONG", { maxLength: MAX_DISPLAY_NAME_LENGTH });
  if (!avatarUrl) return;
  if (avatarUrl.length > MAX_AVATAR_URL_LENGTH) throw new HttpError(413, "Avatar image is too large.", "AVATAR_TOO_LARGE", { maxLength: MAX_AVATAR_URL_LENGTH });
  if (avatarUrl.startsWith("data:")) {
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(avatarUrl)) {
      throw new HttpError(400, "Avatar data URL must be a supported image.", "INVALID_AVATAR_URL");
    }
    return;
  }
  if (avatarUrl.startsWith("/uploads/avatar-")) return;
  if (avatarUrl.startsWith("/")) throw new HttpError(400, "Avatar URL is invalid.", "INVALID_AVATAR_URL");
  let parsed: URL;
  try {
    parsed = new URL(avatarUrl);
  } catch {
    throw new HttpError(400, "Avatar URL is invalid.", "INVALID_AVATAR_URL");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) throw new HttpError(400, "Avatar URL must use http or https.", "INVALID_AVATAR_URL");
}

function normalizeOptionalAvatarUrl(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || null;
}

function avatarMimeToExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  return mimeType.split("/")[1] || "bin";
}

async function persistAvatarDataUrl(actor: Awaited<ReturnType<typeof requireAuth>>, avatarUrl: string) {
  const match = avatarUrl.match(AVATAR_DATA_URL_PATTERN);
  if (!match) throw new HttpError(400, "Avatar data URL must be a supported image.", "INVALID_AVATAR_URL");

  const mimeType = `image/${match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase()}`;
  const base64Data = match[2].replace(/\s/g, "");
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, "base64");
  } catch {
    throw new HttpError(400, "Avatar image data is invalid.", "INVALID_AVATAR_DATA");
  }
  if (!buffer.length) throw new HttpError(400, "Avatar image data is empty.", "INVALID_AVATAR_DATA");
  if (buffer.length > MAX_AVATAR_BYTES) throw new HttpError(413, "Avatar image is too large.", "AVATAR_TOO_LARGE", { maxBytes: MAX_AVATAR_BYTES });
  if (!hasValidMagicNumber(buffer, mimeType)) throw new HttpError(400, "Avatar image data does not match its declared type.", "INVALID_AVATAR_DATA");

  const uploadsDir = getUploadsDir();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const filename = `avatar-${actor.id}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${avatarMimeToExtension(mimeType)}`;
  const filePath = getUploadFilePath(filename);
  fs.writeFileSync(filePath, buffer);

  await recordLocalMediaAsset({
    requestUser: actor,
    type: MediaAssetType.IMAGE,
    url: `/uploads/${filename}`,
    filePath,
    originalName: filename,
    mimeType,
    visibility: MediaVisibility.PUBLIC,
    metadata: { avatar: true }
  });

  return `/uploads/${filename}`;
}

async function cleanupLocalAvatarUrl(avatarUrl: string | null | undefined) {
  if (!avatarUrl || !avatarUrl.startsWith("/uploads/avatar-")) return;
  const storageKey = decodeURIComponent(avatarUrl.slice("/uploads/".length).split("?")[0]);
  const asset = await findMediaAssetByStorageKey(storageKey).catch(() => null);
  if (asset) {
    await prisma.mediaAsset.deleteMany({ where: { storageKey } }).catch(() => undefined);
  }
  const filePath = getUploadFilePath(storageKey);
  if (fs.existsSync(filePath)) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (error) {
      console.warn("[Auth] Failed to remove replaced avatar file:", error);
    }
  }
}

async function uniqueUsername(seed: string, fallbackEmail: string) {
  const base = normalizeUsername(seed || fallbackEmail.split("@")[0] || "operator") || "operator";
  for (let index = 0; index < 20; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`.slice(0, 40);
    const existing = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  return `${base.slice(0, 28)}-${crypto.randomBytes(4).toString("hex")}`.slice(0, 40);
}

function oauthStateKey(state: string) {
  return `auth:google:oauth-state:${hashToken(state)}`;
}

function getRequestAppUrl(req: express.Request) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host") || "localhost:3000";
  return `${protocol}://${Array.isArray(host) ? host[0] : host}`.replace(/\/$/, "");
}

function isLocalDevelopmentUrl(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

function getUrlHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function shouldUseConfiguredLocalUrl(configuredUrl: string | undefined, requestUrl: string) {
  if (!configuredUrl || process.env.NODE_ENV === "production") return false;
  if (!isLocalDevelopmentUrl(configuredUrl) || !isLocalDevelopmentUrl(requestUrl)) return false;
  return getUrlHostname(configuredUrl) !== getUrlHostname(requestUrl);
}

function getPublicAppUrl(req: express.Request) {
  const configuredUrl = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  const requestUrl = getRequestAppUrl(req);

  if (process.env.NODE_ENV !== "production") {
    if (shouldUseConfiguredLocalUrl(configuredUrl, requestUrl)) return configuredUrl!.replace(/\/$/, "");
    if (configuredUrl && !isLocalDevelopmentUrl(configuredUrl)) return configuredUrl.replace(/\/$/, "");
    return requestUrl;
  }

  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  return requestUrl;
}

function hasGoogleOAuthConfig() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function setOAuthStateCookie(res: express.Response, state: string) {
  const isSecure = process.env.NODE_ENV === "production";
  const parts = [
    `jiying_oauth_state=${encodeURIComponent(state)}`,
    "Path=/api/auth/google",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600"
  ];
  if (isSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function setOAuthNonceCookie(res: express.Response, nonce: string) {
  const isSecure = process.env.NODE_ENV === "production";
  const parts = [
    `jiying_oauth_nonce=${encodeURIComponent(nonce)}`,
    "Path=/api/auth/google",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${OAUTH_STATE_TTL_SECONDS}`
  ];
  if (isSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearOAuthStateCookie(res: express.Response) {
  res.append("Set-Cookie", "jiying_oauth_state=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0");
  res.append("Set-Cookie", "jiying_oauth_nonce=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0");
}

async function storeOAuthState(state: string, nonce: string) {
  const redis = getRedisConnection();
  if (!redis) return;
  const payload: StoredOAuthState = {
    nonceHash: hashToken(nonce),
    createdAt: new Date().toISOString()
  };
  await redis.set(oauthStateKey(state), JSON.stringify(payload), "EX", OAUTH_STATE_TTL_SECONDS);
}

async function consumeOAuthState(state: string, nonce?: string) {
  const redis = getRedisConnection();
  if (!redis || !state) return false;
  const key = oauthStateKey(state);
  const stored = await redis.get(key);
  if (!stored) return false;
  let parsed: StoredOAuthState = {};
  try {
    parsed = JSON.parse(stored) as StoredOAuthState;
  } catch {
    await redis.del(key);
    return false;
  }
  if (nonce && parsed.nonceHash && parsed.nonceHash !== hashToken(nonce)) return false;
  await redis.del(key);
  return true;
}

async function validateStoredOAuthState(state: string, nonce?: string) {
  const redis = getRedisConnection();
  if (!redis || !state) return false;
  const stored = await redis.get(oauthStateKey(state));
  if (!stored) return false;
  let parsed: StoredOAuthState = {};
  try {
    parsed = JSON.parse(stored) as StoredOAuthState;
  } catch {
    return false;
  }
  return !(nonce && parsed.nonceHash && parsed.nonceHash !== hashToken(nonce));
}

function getGoogleOAuthPrompt(req: express.Request) {
  const prompt = typeof req.query.prompt === "string" ? req.query.prompt.trim() : "";
  return GOOGLE_OAUTH_PROMPTS.has(prompt) ? prompt : "";
}

async function verifyGoogleIdToken(idToken: string, expectedClientId: string) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  const profile = await response.json() as any;
  if (!response.ok) {
    throw new Error("Google ID token verification failed.");
  }

  const issuer = String(profile.iss || "");
  const audience = String(profile.aud || "");
  const expiresAt = Number(profile.exp || 0);
  if (!["accounts.google.com", "https://accounts.google.com"].includes(issuer)) {
    throw new Error("Google ID token issuer is invalid.");
  }
  if (audience !== expectedClientId) {
    throw new Error("Google ID token audience is invalid.");
  }
  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error("Google ID token is expired.");
  }
  if (String(profile.email_verified) !== "true") {
    throw new Error("Google account email is not verified.");
  }

  return profile;
}

export function registerAuthRoutes(app: express.Express) {
  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = await getSessionUser(req);
      if (!user) {
        res.json({ success: true, user: null });
        return;
      }
      const touchedUser = await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      res.json({ success: true, user: await serializeLocalUserWithProjectRoles(touchedUser) });
    } catch (error: any) {
      sendApiError(res, error, "Failed to load current user.");
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const email = normalizeEmail(String(req.body?.email || ""));
      const password = String(req.body?.password || "");
      const displayName = String(req.body?.displayName || email.split("@")[0] || "Operator").trim();
      const username = normalizeUsername(String(req.body?.username || displayName || email.split("@")[0]));

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ success: false, error: "Invalid email address." });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ success: false, error: "Password must be at least 8 characters." });
        return;
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, ...(username ? [{ username }] : [])] }
      });
      if (existing) {
        res.status(409).json({ success: false, error: "This email is already registered." });
        return;
      }

      const user = await prisma.user.create({
        data: {
          email,
          username,
          displayName,
          passwordHash: passwordHash(password),
          emailVerified: false,
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          lastLoginAt: new Date(),
          lastSeenAt: new Date()
        }
      });

      await createLocalSession(req, res, user.id);
      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "LOGIN",
          entityType: "Auth",
          entityId: user.id,
          afterJson: { method: "local_register", email }
        }
      });

      res.json({ success: true, user: serializeLocalUser(user) });
    } catch (error: any) {
      sendApiError(res, error, "Registration failed.");
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const email = normalizeEmail(String(req.body?.email || ""));
      const password = String(req.body?.password || "");
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || user.status !== UserStatus.ACTIVE || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({ success: false, error: "Invalid email or password." });
        return;
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          lastSeenAt: new Date(),
          ...(needsPasswordRehash(user.passwordHash) ? { passwordHash: passwordHash(password) } : {})
        }
      });

      await createLocalSession(req, res, updatedUser.id);
      await prisma.auditLog.create({
        data: {
          actorId: updatedUser.id,
          action: "LOGIN",
          entityType: "Auth",
          entityId: updatedUser.id,
          afterJson: { method: "local_password", email }
        }
      });

      res.json({ success: true, user: serializeLocalUser(updatedUser) });
    } catch (error: any) {
      sendApiError(res, error, "Login failed.");
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const token = parseCookies(req).jiying_session;
      if (token) {
        await prisma.authSession.updateMany({
          where: { tokenHash: hashToken(token), revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
      clearSessionCookie(res);
      res.json({ success: true });
    } catch (error: any) {
      sendApiError(res, error, "Logout failed.");
    }
  });

  app.post("/api/auth/refresh", async (req, res) => {
    try {
      const user = await refreshLocalSession(req, res);
      res.json({ success: true, user: serializeLocalUser(user) });
    } catch (error: any) {
      sendApiError(res, error, "Refresh failed.");
    }
  });

  app.post("/api/auth/heartbeat", async (req, res) => {
    try {
      const user = await touchCurrentUser(req);
      res.json({ success: true, lastSeenAt: user.lastSeenAt });
    } catch (error: any) {
      sendApiError(res, error, "Heartbeat failed.");
    }
  });

  app.patch("/api/auth/profile", async (req, res) => {
    try {
      const actor = await requireAuth(req);
      const displayName = String(req.body?.displayName || "").trim();
      const avatarUrl = normalizeOptionalAvatarUrl(req.body?.photoURL ?? req.body?.avatarUrl);
      assertProfileInput(displayName, avatarUrl);
      const previousUser = await prisma.user.findUnique({ where: { id: actor.id }, select: { avatarUrl: true } });
      const previousAvatarUrl = previousUser?.avatarUrl;
      const persistedAvatarUrl = avatarUrl?.startsWith("data:")
        ? await persistAvatarDataUrl(actor, avatarUrl)
        : avatarUrl;

      const updatedUser = await prisma.user.update({
        where: { id: actor.id },
        data: {
          displayName,
          avatarUrl: persistedAvatarUrl,
          lastSeenAt: new Date()
        }
      });
      if (previousAvatarUrl && previousAvatarUrl !== persistedAvatarUrl) {
        await cleanupLocalAvatarUrl(previousAvatarUrl);
      }
      await prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: "UPDATE",
          entityType: "AuthProfile",
          entityId: actor.id,
          afterJson: {
            displayName,
            avatarChanged: avatarUrl !== undefined,
            avatarKind: avatarUrl?.startsWith("data:") ? "local-upload" : avatarUrl ? "url" : "none"
          }
        }
      });

      res.json({ success: true, user: serializeLocalUser(updatedUser) });
    } catch (error: any) {
      sendApiError(res, error, "Profile update failed.");
    }
  });

  app.post("/api/auth/password/change", async (req, res) => {
    try {
      const actor = await requireAuth(req);
      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || "");
      if (newPassword.length < 8) throw new HttpError(400, "New password must be at least 8 characters.", "WEAK_PASSWORD");

      const user = await prisma.user.findUnique({ where: { id: actor.id } });
      if (!user || user.status !== UserStatus.ACTIVE) throw new HttpError(401, "Authentication is required.");
      if (user.passwordHash) {
        if (!verifyPassword(currentPassword, user.passwordHash)) throw new HttpError(401, "Current password is incorrect.", "INVALID_CURRENT_PASSWORD");
        if (verifyPassword(newPassword, user.passwordHash)) throw new HttpError(400, "New password must be different from the current password.", "PASSWORD_UNCHANGED");
      }

      const updatedUser = await prisma.user.update({
        where: { id: actor.id },
        data: { passwordHash: passwordHash(newPassword), lastSeenAt: new Date() }
      });
      await prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: "UPDATE",
          entityType: "AuthPassword",
          entityId: actor.id,
          afterJson: { method: user.passwordHash ? "local_password_change" : "local_password_create" }
        }
      });
      res.json({ success: true, user: serializeLocalUser(updatedUser) });
    } catch (error: any) {
      sendApiError(res, error, "Password change failed.");
    }
  });

  app.get("/api/auth/providers", (req, res) => {
    const publicAppUrl = getPublicAppUrl(req);
    res.json({
      success: true,
      providers: {
        localEmail: { enabled: true },
        google: {
          enabled: hasGoogleOAuthConfig(),
          configured: hasGoogleOAuthConfig(),
          redirectUri: `${publicAppUrl}/api/auth/google/callback`,
          missing: {
            clientId: !process.env.GOOGLE_OAUTH_CLIENT_ID,
            clientSecret: !process.env.GOOGLE_OAUTH_CLIENT_SECRET,
            publicAppUrl: !process.env.PUBLIC_APP_URL && !process.env.APP_URL
          }
        }
      }
    });
  });

  app.get("/api/auth/google", async (req, res) => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const appUrl = getPublicAppUrl(req);
    const requestUrl = getRequestAppUrl(req);
    if (appUrl !== requestUrl) {
      res.redirect(`${appUrl}/api/auth/google`);
      return;
    }
    if (!hasGoogleOAuthConfig() || !clientId) {
      res.status(503).json({
        success: false,
        error: "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.",
        redirectUri: `${appUrl}/api/auth/google/callback`
      });
      return;
    }
    const state = crypto.randomBytes(24).toString("base64url");
    const nonce = crypto.randomBytes(24).toString("base64url");
    setOAuthStateCookie(res, state);
    setOAuthNonceCookie(res, nonce);
    await storeOAuthState(state, nonce).catch((error) => {
      console.warn("[Auth] Failed to persist Google OAuth state:", error);
    });
    const redirectUri = `${appUrl}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      include_granted_scopes: "true"
    });
    const prompt = getGoogleOAuthPrompt(req);
    if (prompt) params.set("prompt", prompt);
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      const appUrl = getPublicAppUrl(req);
      if (!code || !clientId || !clientSecret) {
        res.status(400).send("Google OAuth callback is missing code or server configuration.");
        return;
      }
      const cookies = parseCookies(req);
      const expectedState = cookies.jiying_oauth_state;
      const expectedNonce = cookies.jiying_oauth_nonce;
      const hasValidCookieState = Boolean(state && expectedState && state === expectedState);
      const hasValidStoredState = hasValidCookieState ? true : await validateStoredOAuthState(state).catch((error) => {
        console.warn("[Auth] Failed to validate Google OAuth state:", error);
        return false;
      });
      if (!hasValidCookieState && !hasValidStoredState) {
        console.warn("[Auth] Google OAuth state validation failed.", {
          hasCallbackState: Boolean(state),
          hasCookieState: Boolean(expectedState),
          hasCookieNonce: Boolean(expectedNonce)
        });
        res.status(400).send("Google OAuth state validation failed. Please retry login.");
        return;
      }

      const redirectUri = `${appUrl}/api/auth/google/callback`;
      let tokenResponse: Response;
      try {
        tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code"
          })
        });
      } catch (error: any) {
        console.error("[Auth] Google OAuth token exchange request failed:", error);
        res.status(502).send("Google OAuth token exchange request failed. Please check backend outbound network/proxy and retry login.");
        return;
      }
      const tokenData = await tokenResponse.json() as any;
      if (!tokenResponse.ok || !tokenData.id_token) {
        res.status(401).send("Google OAuth token exchange failed.");
        return;
      }

      const decodedProfile = decodeJwtPart<any>(String(tokenData.id_token).split(".")[1]);
      const googleProfile = await verifyGoogleIdToken(String(tokenData.id_token), clientId);
      const providerUserId = String(googleProfile.sub || "");
      const email = normalizeEmail(String(googleProfile.email || ""));
      if (!providerUserId || !email) {
        res.status(401).send("Google profile is missing required identity fields.");
        return;
      }

      const emailVerified = String(googleProfile.email_verified) === "true";
      const role = emailVerified && isPrimaryAdminEmail(email) ? UserRole.ADMIN : UserRole.USER;
      const username = await uniqueUsername(googleProfile.name || decodedProfile.name || email.split("@")[0], email);
      const user = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          username,
          displayName: googleProfile.name || decodedProfile.name || email.split("@")[0],
          avatarUrl: googleProfile.picture || decodedProfile.picture || null,
          emailVerified,
          role,
          status: UserStatus.ACTIVE,
          lastLoginAt: new Date(),
          lastSeenAt: new Date(),
          oauthAccounts: {
            create: {
              provider: "google",
              providerUserId,
              email
            }
          }
        },
        update: {
          emailVerified,
          ...(role === UserRole.ADMIN ? { role } : {}),
          lastLoginAt: new Date(),
          lastSeenAt: new Date()
        }
      });

      await prisma.oAuthAccount.upsert({
        where: { provider_providerUserId: { provider: "google", providerUserId } },
        create: { userId: user.id, provider: "google", providerUserId, email },
        update: { userId: user.id, email }
      });
      await createLocalSession(req, res, user.id);
      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "LOGIN",
          entityType: "Auth",
          entityId: user.id,
          afterJson: { method: "google_oauth", email }
        }
      });
      await consumeOAuthState(state, hasValidCookieState ? expectedNonce : undefined).catch(() => undefined);
      clearOAuthStateCookie(res);
      res.redirect(appUrl);
    } catch (error: any) {
      console.error("[Auth] Google OAuth callback failed:", error);
      res.status(500).send("Google OAuth login failed.");
    }
  });
}
