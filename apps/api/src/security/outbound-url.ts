import dns from "dns/promises";
import net from "net";
import { HttpError } from "../shared/http";

const PRIVATE_HOST_ALLOWLIST = new Set(
  (process.env.OUTBOUND_PRIVATE_HOST_ALLOWLIST || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

function normalizeHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function isPrivateIPv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0;
}

function isPrivateIPv6(address: string) {
  const normalized = address.toLowerCase();
  const mappedIPv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIPv4) return isPrivateIPv4(mappedIPv4[1]);
  const mappedIPv4Hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedIPv4Hex) {
    const high = Number.parseInt(mappedIPv4Hex[1], 16);
    const low = Number.parseInt(mappedIPv4Hex[2], 16);
    if (Number.isNaN(high) || Number.isNaN(low)) return true;
    const ipv4 = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
    return isPrivateIPv4(ipv4);
  }
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

export function isPrivateIpAddress(address: string) {
  const normalized = normalizeHostname(address);
  const version = net.isIP(normalized);
  if (version === 4) return isPrivateIPv4(normalized);
  if (version === 6) return isPrivateIPv6(normalized);
  return true;
}

export function isOutboundHostAllowedPrivate(hostname: string) {
  // ALLOW_PRIVATE_PROVIDER_URLS only enables explicitly named private hosts.
  // It must not become a blanket SSRF bypass for arbitrary internal targets.
  return process.env.ALLOW_PRIVATE_PROVIDER_URLS === "true" && PRIVATE_HOST_ALLOWLIST.has(normalizeHostname(hostname));
}

function isLocalHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local");
}

export function parseHttpUrl(value: string, label = "URL") {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, `${label} must be a valid URL.`);
  }

  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new HttpError(400, `${label} must use http or https.`);
  }

  if (!parsed.hostname) {
    throw new HttpError(400, `${label} must include a hostname.`);
  }

  return parsed;
}

export async function assertSafeOutboundUrl(value: string, label = "URL") {
  const parsed = parseHttpUrl(value, label);
  const hostname = normalizeHostname(parsed.hostname);
  const allowPrivate = isOutboundHostAllowedPrivate(hostname);
  if (allowPrivate) return parsed;

  if (isLocalHostname(hostname)) {
    throw new HttpError(400, `${label} cannot target localhost or local network hostnames.`);
  }

  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw new HttpError(400, `${label} cannot target private, loopback, or link-local addresses.`);
    }
    return parsed;
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIpAddress(entry.address))) {
    throw new HttpError(400, `${label} resolves to a private, loopback, or link-local address.`);
  }

  return parsed;
}
