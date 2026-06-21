import type {
  CreationAsset,
  CreationAssetContent,
  CreationAssetPreview,
  CreationAssetRequest,
  CreationAssetSource,
  CreationMode,
  GenerationTaskStatus,
  PresetSuggestion
} from "@gw-link-omniai/shared";
import type { AssetRepository } from "../repositories/types";
import { InMemoryAssetRepository } from "../repositories/memory";

export class AssetError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "AssetError";
  }
}

export interface AssetServiceClock {
  now(): Date;
}

export interface AssetServiceOptions {
  clock?: AssetServiceClock;
  idGenerator?: () => string;
}

export interface AssetService {
  createAsset(request: CreationAssetRequest, userId: string): CreationAsset | Promise<CreationAsset>;
  listAssets(userId: string): CreationAsset[] | Promise<CreationAsset[]>;
}

const previews: Record<CreationMode, CreationAssetPreview> = {
  text: {
    title: "文本资产",
    description: "占位文本资产，后续阶段将接入真实文本生成结果。"
  },
  image: {
    title: "图片资产",
    description: "占位图片资产，后续阶段将接入真实图片文件。"
  },
  video: {
    title: "视频资产",
    description: "占位视频资产，后续阶段将接入真实视频文件。"
  }
};

export class AssetServiceImpl implements AssetService {
  private readonly clock: AssetServiceClock;
  private readonly idGenerator: () => string;
  private readonly assets: AssetRepository;
  private nextAssetId = 1;

  constructor(assetRepository: AssetRepository, options: AssetServiceOptions = {}) {
    this.assets = assetRepository;
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? (() => this.createAssetId());
  }

  async createAsset(request: CreationAssetRequest, userId: string): Promise<CreationAsset> {
    const value: unknown = request;

    if (!isRecord(value)) {
      throw new AssetError("Invalid asset request", 400);
    }

    const mode = value.mode;
    if (!isCreationMode(mode)) {
      throw new AssetError("Unsupported asset mode", 400);
    }

    if (typeof value.title !== "string" || value.title.trim().length === 0) {
      throw new AssetError("Asset title is required", 400);
    }

    if (typeof value.prompt !== "string" || value.prompt.trim().length === 0) {
      throw new AssetError("Prompt is required", 400);
    }

    if (typeof value.optimizedPrompt !== "string" || value.optimizedPrompt.trim().length === 0) {
      throw new AssetError("Optimized prompt is required", 400);
    }

    const preset = value.preset;
    if (!isValidPresetSuggestion(preset)) {
      throw new AssetError("Invalid preset suggestion", 400);
    }

    const content = value.content;
    if (!isValidAssetContent(mode, content)) {
      throw new AssetError("Invalid asset content", 400);
    }

    const source = value.source;
    if (!isValidAssetSource(source)) {
      throw new AssetError("Invalid asset source", 400);
    }

    const asset: CreationAsset = {
      id: this.idGenerator(),
      mode,
      title: value.title.trim(),
      content: cloneContent(content),
      preview: clonePreview(previews[mode]),
      source: {
        taskId: source.taskId.trim(),
        taskStatus: source.taskStatus
      },
      prompt: value.prompt.trim(),
      optimizedPrompt: value.optimizedPrompt.trim(),
      preset: clonePreset(preset),
      createdAt: this.clock.now().toISOString()
    };

    await this.assets.insert(asset, userId);
    return cloneAsset(asset);
  }

  async listAssets(userId: string): Promise<CreationAsset[]> {
    return this.assets.list(userId);
  }

  private createAssetId(): string {
    const id = `creation_asset_${this.nextAssetId.toString().padStart(6, "0")}`;
    this.nextAssetId += 1;
    return id;
  }
}

export class InMemoryAssetService extends AssetServiceImpl {
  constructor(options: AssetServiceOptions = {}) {
    super(new InMemoryAssetRepository(), options);
  }
}

function isCreationMode(value: unknown): value is CreationMode {
  return value === "text" || value === "image" || value === "video";
}

function isGenerationTaskStatus(value: unknown): value is GenerationTaskStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed";
}

function isValidAssetSource(value: unknown): value is CreationAssetSource {
  return (
    isRecord(value) &&
    typeof value.taskId === "string" &&
    value.taskId.trim().length > 0 &&
    isGenerationTaskStatus(value.taskStatus) &&
    value.taskStatus === "succeeded"
  );
}

function isValidAssetContent(mode: CreationMode, value: unknown): value is CreationAssetContent {
  if (!isRecord(value) || value.kind !== mode) {
    return false;
  }

  if (value.kind === "text") {
    return (
      typeof value.text === "string" &&
      value.text.trim().length > 0 &&
      (value.format === "markdown" || value.format === "plain")
    );
  }

  if (value.kind === "image") {
    return (
      typeof value.url === "string" &&
      value.url.trim().length > 0 &&
      typeof value.alt === "string" &&
      value.alt.trim().length > 0
    );
  }

  return (
    typeof value.url === "string" &&
    value.url.trim().length > 0 &&
    typeof value.durationSeconds === "number" &&
    Number.isFinite(value.durationSeconds) &&
    value.durationSeconds > 0 &&
    typeof value.posterUrl === "string" &&
    value.posterUrl.trim().length > 0
  );
}

function isValidPresetSuggestion(value: unknown): value is PresetSuggestion {
  if (!isRecord(value)) {
    return false;
  }

  const { modelId, parameters, creditEstimate } = value;

  if (typeof modelId !== "string" || modelId.trim().length === 0) {
    return false;
  }

  if (!isRecord(parameters)) {
    return false;
  }

  if (!Object.values(parameters).every(isPresetParameterValue)) {
    return false;
  }

  return (
    isRecord(creditEstimate) &&
    typeof creditEstimate.credits === "number" &&
    Number.isFinite(creditEstimate.credits) &&
    creditEstimate.credits > 0 &&
    creditEstimate.unit === "credit"
  );
}

function isPresetParameterValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAsset(asset: CreationAsset): CreationAsset {
  return {
    ...asset,
    content: cloneContent(asset.content),
    preview: clonePreview(asset.preview),
    source: cloneSource(asset.source),
    preset: clonePreset(asset.preset)
  };
}

function cloneContent(content: CreationAssetContent): CreationAssetContent {
  if (content.kind === "text") {
    return {
      kind: content.kind,
      text: content.text,
      format: content.format
    };
  }

  if (content.kind === "image") {
    return {
      kind: content.kind,
      url: content.url,
      alt: content.alt
    };
  }

  return {
    kind: content.kind,
    url: content.url,
    durationSeconds: content.durationSeconds,
    posterUrl: content.posterUrl
  };
}

function clonePreview(preview: CreationAssetPreview): CreationAssetPreview {
  return { ...preview };
}

function cloneSource(source: CreationAssetSource): CreationAssetSource {
  return { ...source };
}

function clonePreset(preset: PresetSuggestion): PresetSuggestion {
  return {
    modelId: preset.modelId,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}
