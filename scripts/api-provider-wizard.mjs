import fs from "fs/promises";
import path from "path";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const CONFIG_PATH = path.resolve(process.cwd(), process.env.API_PROVIDER_CONFIG_PATH || "config/api-providers.local.json");
const VALID_TYPES = new Set(["text", "image", "video"]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberList(value) {
  return parseList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
}

async function readExistingConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    return {
      ownerId: typeof parsed.ownerId === "string" && parsed.ownerId.trim() ? parsed.ownerId.trim() : "guest",
      providers: Array.isArray(parsed.providers) ? parsed.providers : []
    };
  } catch (error) {
    if (error.code === "ENOENT") return { ownerId: "guest", providers: [] };
    throw error;
  }
}

async function askRequired(rl, question, fallback) {
  while (true) {
    const suffix = fallback ? ` (${fallback})` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim() || fallback || "";
    if (answer) return answer;
    console.log("This value is required.");
  }
}

async function askProviderType(rl) {
  while (true) {
    const answer = (await rl.question("Provider type [text/image/video] (text): ")).trim().toLowerCase() || "text";
    if (VALID_TYPES.has(answer)) return answer;
    console.log("Type must be one of: text, image, video.");
  }
}

async function askUrl(rl) {
  while (true) {
    const answer = await askRequired(rl, "Base URL", "https://api.example.com/v1/chat/completions");
    try {
      new URL(answer);
      return answer;
    } catch {
      console.log("Base URL must be a valid URL.");
    }
  }
}

async function askMetadata(rl, type) {
  const provider = (await rl.question("Provider adapter name (openai-compatible): ")).trim() || "openai-compatible";
  if (type === "text") {
    const requestFormat = (await rl.question("Request format (chat-completions): ")).trim() || "chat-completions";
    return { provider, requestFormat };
  }

  if (type === "image") {
    const resolutions = parseList((await rl.question("Supported resolutions, comma-separated (1024x1024,1536x1024,1024x1536): ")).trim() || "1024x1024,1536x1024,1024x1536");
    const ratios = parseList((await rl.question("Supported ratios, comma-separated (1:1,16:9,9:16): ")).trim() || "1:1,16:9,9:16");
    const quality = (await rl.question("Default quality (standard): ")).trim() || "standard";
    return { provider, resolutions, ratios, quality };
  }

  const resolutions = parseList((await rl.question("Supported resolutions, comma-separated (1280x720,1920x1080): ")).trim() || "1280x720,1920x1080");
  const ratios = parseList((await rl.question("Supported ratios, comma-separated (16:9,9:16): ")).trim() || "16:9,9:16");
  const durations = parseNumberList((await rl.question("Supported durations in seconds, comma-separated (5,10): ")).trim() || "5,10");
  const hasAudio = ((await rl.question("Supports audio? [y/N]: ")).trim().toLowerCase()) === "y";
  return { provider, resolutions, ratios, durations, hasAudio };
}

function defaultMetadata(type, args = {}) {
  const provider = typeof args.provider === "string" && args.provider.trim() ? args.provider.trim() : "openai-compatible";
  if (type === "text") {
    return {
      provider,
      requestFormat: typeof args.requestFormat === "string" && args.requestFormat.trim() ? args.requestFormat.trim() : "chat-completions"
    };
  }
  if (type === "image") {
    return {
      provider,
      resolutions: parseList(typeof args.resolutions === "string" ? args.resolutions : "1024x1024,1536x1024,1024x1536"),
      ratios: parseList(typeof args.ratios === "string" ? args.ratios : "1:1,16:9,9:16"),
      quality: typeof args.quality === "string" && args.quality.trim() ? args.quality.trim() : "standard"
    };
  }
  return {
    provider,
    resolutions: parseList(typeof args.resolutions === "string" ? args.resolutions : "1280x720,1920x1080"),
    ratios: parseList(typeof args.ratios === "string" ? args.ratios : "16:9,9:16"),
    durations: parseNumberList(typeof args.durations === "string" ? args.durations : "5,10"),
    hasAudio: args.hasAudio === true || args.hasAudio === "true" || args.hasAudio === "y"
  };
}

function validateCliProvider(provider) {
  if (!provider.alias) throw new Error("--alias is required in --yes mode.");
  if (!VALID_TYPES.has(provider.type)) throw new Error("--type must be one of: text, image, video.");
  if (!provider.id) throw new Error("--id is required in --yes mode.");
  if (!provider.baseUrl) throw new Error("--base-url is required in --yes mode.");
  try {
    new URL(provider.baseUrl);
  } catch {
    throw new Error("--base-url must be a valid URL.");
  }
  if (!provider.modelName) throw new Error("--model-name is required in --yes mode.");
}

async function saveProvider(config, ownerId, provider) {
  const nextProviders = config.providers.filter((item) => item?.id !== provider.id);
  nextProviders.push(provider);

  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(
    CONFIG_PATH,
    `${JSON.stringify({ ownerId, providers: nextProviders }, null, 2)}\n`,
    "utf8"
  );

  return nextProviders.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.yes) {
    const config = await readExistingConfig();
    const type = typeof args.type === "string" ? args.type.trim().toLowerCase() : "text";
    const alias = typeof args.alias === "string" ? args.alias.trim() : "";
    const provider = {
      id: typeof args.id === "string" && args.id.trim() ? args.id.trim() : slugify(`local-${type}-${alias}`),
      alias,
      type,
      baseUrl: typeof args.baseUrl === "string" ? args.baseUrl.trim() : "",
      modelName: typeof args.modelName === "string" ? args.modelName.trim() : "",
      ...(typeof args.apiKey === "string" && args.apiKey.trim() ? { apiKey: args.apiKey.trim() } : {}),
      isEnabled: args.enabled !== "false",
      metadata: defaultMetadata(type, args)
    };
    validateCliProvider(provider);
    const count = await saveProvider(config, typeof args.ownerId === "string" && args.ownerId.trim() ? args.ownerId.trim() : config.ownerId, provider);
    console.log(`Saved ${count} provider(s) to ${CONFIG_PATH}.`);
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log("Jiying local API provider setup");
    console.log("The API key is written only to config/api-providers.local.json, which is ignored by Git.");

    const config = await readExistingConfig();
    const ownerId = (await rl.question(`Owner ID (${config.ownerId}): `)).trim() || config.ownerId;
    const alias = await askRequired(rl, "Display name", "OpenAI Compatible Text");
    const type = await askProviderType(rl);
    const suggestedId = slugify(`local-${type}-${alias}`) || `local-${type}-provider`;
    const id = await askRequired(rl, "Stable provider ID", suggestedId);
    const baseUrl = await askUrl(rl);
    const modelName = await askRequired(rl, "Model name", type === "text" ? "gpt-4o-mini" : `${type}-model-name`);
    const apiKey = (await rl.question("API key (input hidden is not available in this terminal; it will not be printed back): ")).trim();
    const isEnabledAnswer = (await rl.question("Enable this provider now? [Y/n]: ")).trim().toLowerCase();
    const metadata = await askMetadata(rl, type);

    const provider = {
      id,
      alias,
      type,
      baseUrl,
      modelName,
      ...(apiKey ? { apiKey } : {}),
      isEnabled: isEnabledAnswer !== "n",
      metadata
    };

    const count = await saveProvider(config, ownerId, provider);
    console.log(`Saved ${count} provider(s) to ${CONFIG_PATH}.`);
    console.log("Restart the backend or run `podman compose up --build -d` to import and encrypt the key.");
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("API provider setup failed:", error.message);
  process.exitCode = 1;
});
