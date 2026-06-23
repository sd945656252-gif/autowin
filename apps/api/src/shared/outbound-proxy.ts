import { ProxyAgent, setGlobalDispatcher } from "undici";

let configured = false;

export function configureOutboundProxy() {
  if (configured) return;
  configured = true;

  const proxyUrl = process.env.CONTAINER_HTTPS_PROXY
    || process.env.CONTAINER_HTTP_PROXY
    || process.env.CONTAINER_ALL_PROXY
    || process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
    || process.env.ALL_PROXY
    || process.env.all_proxy;
  if (!proxyUrl) return;

  const noProxy = process.env.CONTAINER_NO_PROXY
    || process.env.NO_PROXY
    || process.env.no_proxy
    || "localhost,127.0.0.1,::1";

  process.env.HTTPS_PROXY = proxyUrl;
  process.env.https_proxy = proxyUrl;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.http_proxy = proxyUrl;
  process.env.ALL_PROXY = proxyUrl;
  process.env.all_proxy = proxyUrl;
  process.env.NO_PROXY = noProxy;
  process.env.no_proxy = noProxy;

  try {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    const safeProxyUrl = proxyUrl.replace(/\/\/([^:@/]+):([^@/]+)@/, "//***:***@");
    console.log(`[OutboundProxy] Backend fetch proxy enabled: ${safeProxyUrl}`);
  } catch (error) {
    console.warn("[OutboundProxy] Failed to configure backend fetch proxy:", error);
  }
}
