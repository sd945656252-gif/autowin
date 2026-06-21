import fs from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { createKeyPreview, encryptSecret } from "../../security/crypto";
import { normalizeTypeAndCapability } from "./custom-api-configs.shared";

type LocalApiProviderConfig = {
  id: string;
  alias: string;
  provider?: string;
  type: "image" | "video" | "text";
  baseUrl: string;
  modelName: string;
  apiKey?: string;
  isEnabled?: boolean;
  metadata?: Prisma.InputJsonValue;
};

type LocalApiProviderConfigFile = {
  ownerId?: string;
  providers?: LocalApiProviderConfig[];
};

const VALID_TYPES = new Set(["image", "video", "text"]);

function getConfigPath() {
  return path.resolve(process.cwd(), process.env.API_PROVIDER_CONFIG_PATH || "config/api-providers.local.json");
}

function validateProvider(provider: any, index: number): LocalApiProviderConfig {
  const label = `providers[${index}]`;
  if (!provider || typeof provider !== "object") throw new Error(`${label} must be an object.`);

  const id = String(provider.id || "").trim();
  const alias = String(provider.alias || "").trim();
  const providerName = String(provider.provider || "Local").trim();
  const type = String(provider.type || "").trim();
  const baseUrl = String(provider.baseUrl || "").trim();
  const modelName = String(provider.modelName || "").trim();

  if (!id) throw new Error(`${label}.id is required.`);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(id)) throw new Error(`${label}.id may only contain letters, numbers, underscore, dash, colon, and dot.`);
  if (!alias) throw new Error(`${label}.alias is required.`);
  if (!VALID_TYPES.has(type)) throw new Error(`${label}.type must be image, video, or text.`);
  if (!baseUrl) throw new Error(`${label}.baseUrl is required.`);
  if (!modelName) throw new Error(`${label}.modelName is required.`);

  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`${label}.baseUrl must be a valid URL.`);
  }

  return {
    id,
    alias,
    provider: providerName || "Local",
    type: type as LocalApiProviderConfig["type"],
    baseUrl,
    modelName,
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey.trim() : undefined,
    isEnabled: provider.isEnabled !== false,
    metadata: provider.metadata && typeof provider.metadata === "object"
      ? JSON.parse(JSON.stringify(provider.metadata)) as Prisma.InputJsonValue
      : undefined
  };
}

export async function loadLocalApiProviderConfig() {
  const configPath = getConfigPath();
  let raw: string;

  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      console.log(`[API Providers] Local config not found at ${configPath}. Skipping file-based provider import.`);
      return;
    }
    throw error;
  }

  const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as LocalApiProviderConfigFile;
  const providers = Array.isArray(parsed.providers) ? parsed.providers.map(validateProvider) : [];
  const ownerId = typeof parsed.ownerId === "string" && parsed.ownerId.trim() ? parsed.ownerId.trim() : "guest";

  if (providers.length === 0) {
    console.log(`[API Providers] ${configPath} contains no providers. Skipping.`);
    return;
  }

  for (const provider of providers) {
    const encryptedKey = provider.apiKey ? encryptSecret(provider.apiKey) : undefined;
    const keyPreview = provider.apiKey ? createKeyPreview(provider.apiKey) : undefined;
    const normalized = normalizeTypeAndCapability({ type: provider.type });

    await prisma.customApiConfig.upsert({
      where: { id: provider.id },
      create: {
        id: provider.id,
        ownerId,
        alias: provider.alias,
        provider: provider.provider || "Local",
        type: normalized.type,
        capability: normalized.capability,
        baseUrl: provider.baseUrl,
        modelName: provider.modelName,
        encryptedKey,
        keyPreview,
        metadata: provider.metadata,
        isEnabled: provider.isEnabled ?? true
      },
      update: {
        ownerId,
        alias: provider.alias,
        provider: provider.provider || "Local",
        type: normalized.type,
        capability: normalized.capability,
        baseUrl: provider.baseUrl,
        modelName: provider.modelName,
        ...(encryptedKey ? { encryptedKey, keyPreview } : {}),
        metadata: provider.metadata,
        isEnabled: provider.isEnabled ?? true
      }
    });
  }

  console.log(`[API Providers] Loaded ${providers.length} provider(s) from ${configPath} for owner '${ownerId}'. API keys were encrypted at rest.`);
}
