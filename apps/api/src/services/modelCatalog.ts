import type { CreationMode, ProductModel } from "@gw-link-omniai/shared";
import type {
  ModelCatalogConfig,
  ModelProviderConfig,
  ProviderModelConfig,
  ProviderProtocol
} from "./modelConfig";

export interface CatalogProviderReference {
  id: string;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnv: string;
}

export interface CatalogModelReference {
  product: ProductModel;
  provider: CatalogProviderReference;
  providerModelId: string;
}

export interface ModelCatalog {
  listVisibleModels(): ProductModel[];
  getModelReference(modelId: string, mode: CreationMode): CatalogModelReference;
}

export class ModelCatalogError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ModelCatalogError";
  }
}

interface CatalogProviderData extends CatalogProviderReference {
  models: ProviderModelConfig[];
}

export class ConfigModelCatalog implements ModelCatalog {
  private readonly providers: CatalogProviderData[];

  constructor(config: ModelCatalogConfig) {
    this.providers = config.providers.map((provider) => cloneProviderData(provider));
  }

  listVisibleModels(): ProductModel[] {
    return this.providers.flatMap((provider) =>
      provider.models
        .filter((model) => model.visibility === "visible")
        .map((model) => cloneProductModel(model))
    );
  }

  getModelReference(modelId: string, mode: CreationMode): CatalogModelReference {
    const match = this.findModel(modelId);

    if (match === undefined || match.model.visibility === "hidden") {
      throw new ModelCatalogError("Model was not found", 404);
    }

    if (match.model.capability !== mode) {
      throw new ModelCatalogError("Model does not support this creation mode", 400);
    }

    return {
      product: cloneProductModel(match.model),
      provider: cloneProviderReference(match.provider),
      providerModelId: match.model.providerModelId
    };
  }

  private findModel(
    modelId: string
  ): { provider: CatalogProviderData; model: ProviderModelConfig } | undefined {
    for (const provider of this.providers) {
      const model = provider.models.find((candidate) => candidate.id === modelId);

      if (model !== undefined) {
        return { provider, model };
      }
    }

    return undefined;
  }
}

export function listProductModels(catalog?: ModelCatalog): ProductModel[] {
  if (catalog === undefined) {
    return legacyProductModels.map((model) => cloneProductModel(model));
  }

  return catalog.listVisibleModels();
}

const legacyProductModels: ProductModel[] = [
  {
    id: "gw-text-balanced",
    displayName: "OmniAI Text Balanced",
    capability: "text",
    tags: ["recommended", "balanced"],
    visibility: "visible",
    minimumPlan: "free",
    creditUnitCost: 1
  },
  {
    id: "gw-image-creative",
    displayName: "OmniAI Image Creative",
    capability: "image",
    tags: ["creative", "high-quality"],
    visibility: "visible",
    minimumPlan: "pro",
    creditUnitCost: 2
  },
  {
    id: "gw-video-motion",
    displayName: "OmniAI Video Motion",
    capability: "video",
    tags: ["motion", "async-task"],
    visibility: "visible",
    minimumPlan: "studio",
    creditUnitCost: 3
  }
];

function cloneProviderData(provider: ModelProviderConfig): CatalogProviderData {
  return {
    ...cloneProviderReference(provider),
    models: provider.models.map((model) => ({
      ...cloneProductModel(model),
      providerModelId: model.providerModelId
    }))
  };
}

function cloneProviderReference(provider: CatalogProviderReference): CatalogProviderReference {
  return {
    id: provider.id,
    displayName: provider.displayName,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    apiKeyEnv: provider.apiKeyEnv
  };
}

function cloneProductModel(model: ProductModel): ProductModel {
  return {
    id: model.id,
    displayName: model.displayName,
    capability: model.capability,
    tags: [...model.tags],
    visibility: model.visibility,
    minimumPlan: model.minimumPlan,
    creditUnitCost: model.creditUnitCost
  };
}
