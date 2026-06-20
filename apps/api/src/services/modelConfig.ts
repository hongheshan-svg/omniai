import { readFileSync } from "node:fs";
import type { ProductModel } from "@gw-link-omniai/shared";

export type ProviderProtocol = "openai-compatible" | "anthropic-compatible";

export interface ProviderModelConfig extends ProductModel {
  providerModelId: string;
}

export interface ModelProviderConfig {
  id: string;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnv: string;
  models: ProviderModelConfig[];
}

export interface ModelCatalogConfig {
  providers: ModelProviderConfig[];
}

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

const providerProtocols = ["openai-compatible", "anthropic-compatible"] as const;
const modelCapabilities = ["text", "image", "video"] as const;
const modelVisibilities = ["visible", "hidden", "maintenance"] as const;
const minimumPlans = ["free", "pro", "studio"] as const;

export function loadModelCatalogConfig(path: string): ModelCatalogConfig {
  return validateModelCatalogConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function validateModelCatalogConfig(value: unknown): ModelCatalogConfig {
  const root = asRecord(value);
  const providers = root?.providers;

  if (!Array.isArray(providers) || providers.length === 0) {
    throw new ModelConfigError("Model providers are required");
  }

  const modelIds = new Set<string>();

  return {
    providers: providers.map((provider) => validateProvider(provider, modelIds))
  };
}

function validateProvider(value: unknown, modelIds: Set<string>): ModelProviderConfig {
  const provider = requireRecord(value, "Invalid model provider configuration");
  const protocol = provider.protocol;
  const models = provider.models;

  if (!isProviderProtocol(protocol)) {
    throw new ModelConfigError("Unsupported provider protocol");
  }

  if (!Array.isArray(models)) {
    throw new ModelConfigError("Provider models are required");
  }

  return {
    id: requireNonEmptyString(provider.id, "Invalid provider id"),
    displayName: requireNonEmptyString(provider.displayName, "Invalid provider display name"),
    protocol,
    baseUrl: requireNonEmptyString(provider.baseUrl, "Invalid provider base URL"),
    apiKeyEnv: requireNonEmptyString(provider.apiKeyEnv, "Invalid provider API key environment"),
    models: models.map((model) => validateModel(model, modelIds))
  };
}

function validateModel(value: unknown, modelIds: Set<string>): ProviderModelConfig {
  const model = requireRecord(value, "Invalid model configuration");
  const id = requireNonEmptyString(model.id, "Invalid model id");
  const capability = model.capability;
  const visibility = model.visibility;
  const minimumPlan = model.minimumPlan;
  const creditUnitCost = model.creditUnitCost;
  const tags = model.tags;

  if (modelIds.has(id)) {
    throw new ModelConfigError("Duplicate model id");
  }

  if (!isModelCapability(capability)) {
    throw new ModelConfigError("Unsupported model capability");
  }

  if (!isModelVisibility(visibility)) {
    throw new ModelConfigError("Unsupported model visibility");
  }

  if (!isMinimumPlan(minimumPlan)) {
    throw new ModelConfigError("Unsupported model minimum plan");
  }

  if (typeof creditUnitCost !== "number" || !Number.isFinite(creditUnitCost) || creditUnitCost <= 0) {
    throw new ModelConfigError("Invalid model credit unit cost");
  }

  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) {
    throw new ModelConfigError("Invalid model tags");
  }

  modelIds.add(id);

  return {
    id,
    providerModelId: requireNonEmptyString(model.providerModelId, "Invalid provider model id"),
    displayName: requireNonEmptyString(model.displayName, "Invalid model display name"),
    capability,
    tags: [...tags],
    visibility,
    minimumPlan,
    creditUnitCost
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  const record = asRecord(value);

  if (record === undefined) {
    throw new ModelConfigError(message);
  }

  return record;
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ModelConfigError(message);
  }

  return value;
}

function isProviderProtocol(value: unknown): value is ProviderProtocol {
  return providerProtocols.includes(value as ProviderProtocol);
}

function isModelCapability(value: unknown): value is ProviderModelConfig["capability"] {
  return modelCapabilities.includes(value as ProviderModelConfig["capability"]);
}

function isModelVisibility(value: unknown): value is ProviderModelConfig["visibility"] {
  return modelVisibilities.includes(value as ProviderModelConfig["visibility"]);
}

function isMinimumPlan(value: unknown): value is ProviderModelConfig["minimumPlan"] {
  return minimumPlans.includes(value as ProviderModelConfig["minimumPlan"]);
}
