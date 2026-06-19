import type { ProductModel } from "@gw-link-omniai/shared";

export function listProductModels(): ProductModel[] {
  return [
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
}
