import type { LookupAddress, LookupOptions } from "dns";
import dns from "dns/promises";
import http from "http";
import https from "https";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { fetch, Agent } from "undici";
import { HttpError } from "../shared/http";
import { assertSafeOutboundUrl, isOutboundHostAllowedPrivate, isPrivateIpAddress } from "./outbound-url";

const MAX_SAFE_REDIRECTS = 3;

type SafeFetchOptions = RequestInit & {
  label?: string;
  maxRedirects?: number;
};

type SafeAxiosOptions = AxiosRequestConfig & {
  label?: string;
  maxRedirects?: number;
};

async function safeLookup(hostname: string, label: string) {
  const allowPrivate = isOutboundHostAllowedPrivate(hostname);
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new HttpError(400, `${label} hostname could not be resolved.`);
  if (!allowPrivate && records.some((record) => isPrivateIpAddress(record.address))) {
    throw new HttpError(400, `${label} resolves to a private, loopback, or link-local address.`);
  }
  return records;
}

function createNodeLookup(label: string) {
  return async (hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void) => {
    try {
      const records = await safeLookup(hostname, label);
      if ((options as any)?.all) {
        callback(null, records);
        return;
      }
      const preferredFamily = typeof options.family === "number" ? options.family : 0;
      const selected = records.find((record) => preferredFamily === 0 || record.family === preferredFamily) || records[0];
      callback(null, selected.address, selected.family);
    } catch (error: any) {
      callback(error);
    }
  };
}

function createUndiciDispatcher(label: string) {
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        void createNodeLookup(label)(hostname, options as LookupOptions, callback as any);
      }
    }
  });
}

function createAxiosAgents(label: string) {
  const lookup = createNodeLookup(label);
  return {
    httpAgent: new http.Agent({ lookup }),
    httpsAgent: new https.Agent({ lookup })
  };
}

function redirectUrl(fromUrl: string, location: string | null) {
  if (!location) return null;
  try {
    return new URL(location, fromUrl).toString();
  } catch {
    throw new HttpError(502, "Upstream returned an invalid redirect URL.");
  }
}

export async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { label: optionLabel, maxRedirects: optionMaxRedirects, ...fetchOptions } = options;
  const label = optionLabel || "outbound URL";
  const maxRedirects = optionMaxRedirects ?? MAX_SAFE_REDIRECTS;
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertSafeOutboundUrl(currentUrl, label);
    const dispatcher = createUndiciDispatcher(label);
    const response = await fetch(currentUrl, {
      ...fetchOptions,
      redirect: "manual",
      dispatcher
    } as any) as unknown as Response;
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectCount === maxRedirects) {
      throw new HttpError(502, "Too many upstream redirects.");
    }
    const nextUrl = redirectUrl(currentUrl, response.headers.get("location"));
    if (!nextUrl) return response;
    currentUrl = nextUrl;
  }
  throw new HttpError(502, "Too many upstream redirects.");
}

export async function safeAxiosRequest<T = any>(config: SafeAxiosOptions): Promise<AxiosResponse<T>> {
  const { label: optionLabel, maxRedirects: optionMaxRedirects, ...axiosConfig } = config;
  const label = optionLabel || "outbound URL";
  if (!axiosConfig.url) throw new HttpError(400, `${label} is required.`);
  const maxRedirects = optionMaxRedirects ?? MAX_SAFE_REDIRECTS;
  let currentUrl = axiosConfig.url;
  let method = axiosConfig.method || "GET";
  let data = axiosConfig.data;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertSafeOutboundUrl(currentUrl, label);
    const agents = createAxiosAgents(label);
    const response = await axios.request<T>({
      ...axiosConfig,
      url: currentUrl,
      method,
      data,
      maxRedirects: 0,
      proxy: false,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      validateStatus: axiosConfig.validateStatus || null
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectCount === maxRedirects) {
      throw new HttpError(502, "Too many upstream redirects.");
    }
    const nextUrl = redirectUrl(currentUrl, String(response.headers.location || ""));
    if (!nextUrl) return response;
    currentUrl = nextUrl;
    if (response.status === 303) {
      method = "GET";
      data = undefined;
    }
  }
  throw new HttpError(502, "Too many upstream redirects.");
}

export async function safeAxiosGet<T = any>(url: string, config: SafeAxiosOptions = {}) {
  return safeAxiosRequest<T>({ ...config, url, method: "GET" });
}

export async function safeAxiosPost<T = any>(url: string, data?: any, config: SafeAxiosOptions = {}) {
  return safeAxiosRequest<T>({ ...config, url, data, method: "POST" });
}
