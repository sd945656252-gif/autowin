import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const urls = process.argv.slice(2);
const targets = urls.length > 0 ? urls : ["http://localhost:3000/", "http://localhost:3000/pipeline"];
const configuredPort = Number(process.env.BROWSER_CONSOLE_CHECK_PORT || 0);
const timeoutMs = Number(process.env.BROWSER_CONSOLE_CHECK_TIMEOUT_MS || 15000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserCandidates() {
  const candidates = [];
  if (process.env.BROWSER_PATH) candidates.push(process.env.BROWSER_PATH);
  if (process.platform === "win32") {
    const roots = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA
    ].filter(Boolean);
    for (const root of roots) {
      candidates.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
      candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    candidates.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
    candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    candidates.push("google-chrome");
    candidates.push("google-chrome-stable");
    candidates.push("microsoft-edge");
    candidates.push("chromium");
    candidates.push("chromium-browser");
  }
  return candidates;
}

function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (!candidate) continue;
    if (candidate.includes(path.sep) || candidate.endsWith(".exe")) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    return candidate;
  }
  return null;
}

function chooseDebugPort() {
  if (configuredPort > 0) return configuredPort;
  return 40000 + Math.floor(Math.random() * 20000);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function stderrSummary(lines) {
  const text = lines.join("").trim();
  return text ? ` Browser stderr:\n${text.slice(-3000)}` : "";
}

async function waitForDebugEndpoint(port, browser, stderrLines) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browser.exitCode !== null || browser.signalCode !== null) {
      throw new Error(`Browser exited before opening DevTools. exitCode=${browser.exitCode} signal=${browser.signalCode}.${stderrSummary(stderrLines)}`);
    }
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Browser DevTools endpoint did not open on port ${port} within ${timeoutMs}ms.${stderrSummary(stderrLines)}`);
}

function openCdpSocket(wsUrl, context = {}) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  function rejectPending(error) {
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    pending.clear();
  }

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject, timeout } = pending.get(payload.id);
      pending.delete(payload.id);
      clearTimeout(timeout);
      if (payload.error) reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      else resolve(payload.result);
    }
    if (payload.method) {
      socket.dispatchEvent(new MessageEvent("cdp-event", { data: payload }));
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out connecting to browser DevTools websocket.")), timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveCommand, rejectCommand) => {
            const timeout = setTimeout(() => {
              pending.delete(id);
              rejectCommand(new Error(`Timed out waiting for CDP command ${method}.`));
            }, timeoutMs);
            pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timeout });
          });
        },
        onEvent(handler) {
          socket.addEventListener("cdp-event", (event) => handler(event.data));
        },
        close() {
          socket.close();
        }
      });
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      const error = new Error(`Failed to connect to browser DevTools websocket at ${wsUrl}. debugPort=${context.port || "unknown"} browser=${context.browserPath || "unknown"}.${stderrSummary(context.stderrLines || [])}`);
      rejectPending(error);
      reject(error);
    });
    socket.addEventListener("close", () => {
      rejectPending(new Error(`Browser DevTools websocket closed unexpectedly.${stderrSummary(context.stderrLines || [])}`));
    });
  });
}

async function checkUrl(targetUrl, context) {
  const { port } = context;
  const page = await fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  const cdp = await openCdpSocket(page.webSocketDebuggerUrl, context);
  const errors = [];
  const ignored = [];
  let loaded = false;

  cdp.onEvent((event) => {
    if (event.method === "Runtime.exceptionThrown") {
      errors.push(`Runtime exception: ${event.params?.exceptionDetails?.text || "unknown exception"}`);
    }
    if (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error") {
      const text = (event.params.args || []).map((arg) => arg.value || arg.description || arg.unserializableValue || "").join(" ");
      errors.push(`Console error: ${text || "console.error called"}`);
    }
    if (event.method === "Log.entryAdded" && event.params?.entry?.level === "error") {
      const entry = event.params.entry;
      const message = `Log error: ${entry.text || "browser log error"}${entry.url ? ` (${entry.url})` : ""}`;
      if (
        entry.url?.endsWith("/favicon.ico")
      ) {
        ignored.push(message);
      } else {
        errors.push(message);
      }
    }
    if (event.method === "Page.loadEventFired") loaded = true;
  });

  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url: targetUrl });

    const deadline = Date.now() + timeoutMs;
    while (!loaded && Date.now() < deadline) await sleep(200);
    await sleep(1200);

    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: "({ title: document.title, bodyText: document.body.innerText.slice(0, 400), rootChildren: document.querySelector('#root')?.children.length || 0 })",
      returnByValue: true
    });

    if (!loaded) errors.push("Page load event did not fire before timeout.");
    const value = evaluation?.result?.value || {};
    if (!value.rootChildren) errors.push("React root did not render children.");
    return { url: targetUrl, title: value.title, textSample: value.bodyText, errors, ignored };
  } finally {
    cdp.close();
  }
}

async function removeDirectoryWithRetry(dir) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      return;
    } catch {
      await sleep(250);
    }
  }
}

function killBrowserTree(browser) {
  if (browser.exitCode !== null || browser.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  browser.kill();
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error("No Chrome/Edge browser was found. Set BROWSER_PATH to enable browser console checks.");
  }

  const port = chooseDebugPort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "jiying-browser-check-"));
  const stderrLines = [];
  const browser = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-3d-apis",
    "--use-angle=swiftshader",
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-sync",
    "--disable-component-update",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-features=CalculateNativeWinOcclusion,MediaRouter,UseSkiaRenderer,VizDisplayCompositor",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  browser.stderr?.on("data", (chunk) => {
    stderrLines.push(String(chunk));
    if (stderrLines.length > 50) stderrLines.shift();
  });

  try {
    await waitForDebugEndpoint(port, browser, stderrLines);
    const results = [];
    const context = { port, browserPath, stderrLines };
    for (const targetUrl of targets) {
      results.push(await checkUrl(targetUrl, context));
    }
    const failures = results.flatMap((result) => result.errors.map((error) => `${result.url}: ${error}`));
    console.log(JSON.stringify({ success: failures.length === 0, debugPort: port, browserPath, results }, null, 2));
    if (failures.length > 0) throw new Error(failures.join("\n"));
  } finally {
    killBrowserTree(browser);
    await removeDirectoryWithRetry(profileDir);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
