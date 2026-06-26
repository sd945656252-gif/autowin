import type express from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

const DEFAULT_ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const DEFAULT_ALLOWED_HEADERS = "Content-Type, Authorization, x-requested-with";
const DEFAULT_DEV_ENCRYPTION_KEY = "dev_jiying_32_byte_secret_key_01";

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/$/, "");
}

function requestOrigin(req: express.Request) {
  const protocol = req.protocol || "http";
  const host = req.get("host");
  return host ? normalizeOrigin(`${protocol}://${host}`) : "";
}

function originFromReferer(referer: string) {
  try {
    const url = new URL(referer);
    return normalizeOrigin(`${url.protocol}//${url.host}`);
  } catch {
    return "";
  }
}

function isLocalUrl(value?: string | null) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function getAllowedOrigins() {
  const rawOrigins = [
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL,
    ...(process.env.ALLOWED_ORIGINS || "").split(",")
  ];
  return new Set(rawOrigins.filter(Boolean).map((origin) => normalizeOrigin(String(origin))));
}

function isSharedMode() {
  return process.env.NODE_ENV === "production" || process.env.LOCAL_TEAM_MODE === "true";
}

function cspSourceList(envName: string, defaults: string[]) {
  const extra = (process.env[envName] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...defaults, ...extra].join(" ");
}

export function applySecurityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const sharedMode = isSharedMode();
  const scriptSrc = sharedMode
    ? "'self' 'wasm-unsafe-eval'"
    : "'self' 'unsafe-inline' 'unsafe-eval' blob:";
  const styleSrc = sharedMode && process.env.CSP_STRICT_STYLE === "true"
    ? cspSourceList("CSP_STYLE_SRC_EXTRA", ["'self'"])
    : cspSourceList("CSP_STYLE_SRC_EXTRA", ["'self'", "'unsafe-inline'"]);
  const imgSrc = sharedMode
    ? cspSourceList("CSP_IMG_SRC_EXTRA", ["'self'", "data:", "blob:"])
    : "'self' data: blob: http: https:";
  const mediaSrc = sharedMode
    ? cspSourceList("CSP_MEDIA_SRC_EXTRA", ["'self'", "data:", "blob:"])
    : "'self' data: blob: http: https:";
  const connectSrc = sharedMode
    ? cspSourceList("CSP_CONNECT_SRC_EXTRA", ["'self'", "wss:"])
    : "'self' ws: wss: http: https:";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      `img-src ${imgSrc}`,
      `media-src ${mediaSrc}`,
      `connect-src ${connectSrc}`,
      "font-src 'self' data:",
      "object-src 'none'",
      "frame-ancestors 'self'"
    ].join("; ")
  );
  next();
}

export function applyCorsAndUtf8(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = typeof req.headers.origin === "string" ? normalizeOrigin(req.headers.origin) : "";
  const allowedOrigins = getAllowedOrigins();

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", DEFAULT_ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", DEFAULT_ALLOWED_HEADERS);

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: any) => {
    if (name.toLowerCase() === "content-type" && typeof value === "string") {
      const lowerValue = value.toLowerCase();
      const shouldDeclareUtf8 = lowerValue.startsWith("text/") || lowerValue.includes("javascript") || lowerValue.includes("json");

      if (shouldDeclareUtf8 && !lowerValue.includes("charset")) {
        return originalSetHeader(name, `${value}; charset=utf-8`);
      }
    }
    return originalSetHeader(name, value);
  }) as typeof res.setHeader;

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}

export function applyUnsafeRequestOriginGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const origin = typeof req.headers.origin === "string" ? normalizeOrigin(req.headers.origin) : "";
  const refererOrigin = !origin && typeof req.headers.referer === "string" ? originFromReferer(req.headers.referer) : "";
  const suppliedOrigin = origin || refererOrigin;

  if (!suppliedOrigin) {
    next();
    return;
  }

  const allowedOrigins = getAllowedOrigins();
  const sameOrigin = requestOrigin(req);
  if (suppliedOrigin === sameOrigin || allowedOrigins.has(suppliedOrigin)) {
    next();
    return;
  }

  res.status(403).json({ success: false, error: "Cross-origin write request is not allowed." });
}

export function createRateLimiter(options: RateLimitOptions) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const key = `${options.keyPrefix}:${req.ip}:${req.path}`;
    const bucket = rateLimitBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ success: false, error: "Too many requests. Please retry later." });
      return;
    }

    next();
  };
}

export function applyWriteRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  return createRateLimiter({ keyPrefix: "write", windowMs: 60_000, max: Number(process.env.WRITE_RATE_LIMIT_PER_MINUTE || 120) })(req, res, next);
}

export function applyAiRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  return createRateLimiter({ keyPrefix: "ai", windowMs: 60_000, max: Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 20) })(req, res, next);
}

export function logSecurityWarnings() {
  const publicUrl = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  const isShared = !isLocalUrl(publicUrl);
  if (!isShared) return;

  const warnings: string[] = [];
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY === DEFAULT_DEV_ENCRYPTION_KEY) {
    warnings.push("ENCRYPTION_KEY is missing or still uses the development default.");
  }
  if (!process.env.SEED_ADMIN_PASSWORD) {
    warnings.push("SEED_ADMIN_PASSWORD is missing or still uses the development default.");
  }
  if (process.env.REQUIRE_STRONG_LOCAL_SECRETS === "true" && warnings.length > 0) {
    throw new Error(`Unsafe shared configuration: ${warnings.join(" ")}`);
  }
  for (const warning of warnings) {
    console.warn(`[Security] ${warning}`);
  }
}
