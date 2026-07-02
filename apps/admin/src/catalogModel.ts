import type { ModelCapability, ProductModel } from "@gw-link-omniai/shared";

const capabilityLabels: Record<ModelCapability, string> = {
  text: "文本",
  image: "图片",
  video: "视频"
};

export function getModelCapabilityLabel(capability: ModelCapability): string {
  return capabilityLabels[capability];
}

export function formatModelSummary(model: ProductModel): string {
  return `${capabilityLabels[model.capability]} · ${model.minimumPlan} · ${model.creditUnitCost} 积分`;
}
