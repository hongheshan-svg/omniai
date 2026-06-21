import type { CreationAsset, CreationMode } from "@gw-link-omniai/shared";

export type AssetFilter = "all" | CreationMode;

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
