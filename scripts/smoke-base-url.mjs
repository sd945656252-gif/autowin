const DEFAULT_CANDIDATES = ["http://localhost:3000", "http://localhost:3001"];

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

async function isHealthy(baseUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.success === true;
  } catch {
    return false;
  }
}

export async function resolveSmokeBaseUrl(envNames = []) {
  for (const envName of envNames) {
    const value = normalizeBaseUrl(process.env[envName]);
    if (value) return value;
  }
  for (const candidate of DEFAULT_CANDIDATES) {
    if (await isHealthy(candidate)) return candidate;
  }
  return DEFAULT_CANDIDATES[0];
}
