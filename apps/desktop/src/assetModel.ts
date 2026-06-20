import type {
  CreationAsset,
  CreationAssetContent,
  CreationAssetPreview,
  CreationMode,
  GenerationTask,
  PresetSuggestion
} from "@gw-link-omniai/shared";

export type AssetFilter = "all" | CreationMode;

export interface LocalCreationAssetClock {
  now(): Date;
}

export interface LocalCreationAssetOptions {
  clock?: LocalCreationAssetClock;
  idGenerator?: () => string;
}

const assetModeLabels: Record<CreationMode, string> = {
  text: "文本资产",
  image: "图片资产",
  video: "视频资产"
};

const assetFilterLabels: Record<AssetFilter, string> = {
  all: "全部",
  text: "文本",
  image: "图片",
  video: "视频"
};

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

export function createLocalCreationAsset(
  task: GenerationTask,
  options: LocalCreationAssetOptions = {}
): CreationAsset {
  const createdAt = (options.clock ?? { now: () => new Date() }).now().toISOString();
  const idGenerator = options.idGenerator ?? createLocalCreationAssetId;

  return {
    id: idGenerator(),
    mode: task.mode,
    title: getAssetModeLabel(task.mode),
    content: createContent(task),
    preview: { ...previews[task.mode] },
    source: {
      taskId: task.id,
      taskStatus: "succeeded"
    },
    prompt: task.prompt,
    optimizedPrompt: task.optimizedPrompt,
    preset: clonePreset(task.preset),
    createdAt
  };
}

export function filterCreationAssets(assets: CreationAsset[], filter: AssetFilter): CreationAsset[] {
  if (filter === "all") {
    return assets;
  }

  return assets.filter((asset) => asset.mode === filter);
}

export function getAssetFilterLabel(filter: AssetFilter): string {
  return assetFilterLabels[filter];
}

export function getAssetModeLabel(mode: CreationMode): string {
  return assetModeLabels[mode];
}

export function summarizeAssetPrompt(asset: CreationAsset, maxLength = 48): string {
  const prompt = asset.prompt.trim();

  if (prompt.length <= maxLength) {
    return prompt;
  }

  return `${prompt.slice(0, maxLength)}...`;
}

function createContent(task: GenerationTask): CreationAssetContent {
  switch (task.mode) {
    case "text":
      return {
        kind: "text",
        text: task.optimizedPrompt,
        format: "markdown"
      };
    case "image":
      return {
        kind: "image",
        url: "https://assets.gw-link.local/placeholders/image-generation.png",
        alt: task.prompt
      };
    case "video":
      return {
        kind: "video",
        url: "https://assets.gw-link.local/placeholders/video-generation.mp4",
        durationSeconds: Number(task.preset.parameters.durationSeconds ?? 6),
        posterUrl: "https://assets.gw-link.local/placeholders/video-poster.png"
      };
  }
}

function clonePreset(preset: PresetSuggestion): PresetSuggestion {
  return {
    ...preset,
    parameters: { ...preset.parameters },
    creditEstimate: { ...preset.creditEstimate }
  };
}

function createLocalCreationAssetId(): string {
  return `desktop_creation_asset_${Date.now().toString(36)}`;
}
