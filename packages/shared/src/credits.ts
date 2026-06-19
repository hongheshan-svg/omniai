import type { CreditAmount } from "./models";

export type CreditEstimateInput =
  | {
      capability: "text";
      estimatedInputTokens: number;
      estimatedOutputTokens: number;
    }
  | {
      capability: "image";
      imageCount: number;
      quality: "standard" | "high";
    }
  | {
      capability: "video";
      durationSeconds: number;
      resolution: "720p" | "1080p";
    };

export function estimateCreditCost(input: CreditEstimateInput): CreditAmount {
  if (input.capability === "text") {
    const totalTokens = input.estimatedInputTokens + input.estimatedOutputTokens;
    return { credits: Math.max(1, Math.ceil(totalTokens / 1000)), unit: "credit" };
  }

  if (input.capability === "image") {
    const qualityMultiplier = input.quality === "high" ? 2 : 1;
    return { credits: input.imageCount * qualityMultiplier, unit: "credit" };
  }

  const resolutionMultiplier = input.resolution === "1080p" ? 3 : 2;
  return {
    credits: Math.ceil(input.durationSeconds) * resolutionMultiplier,
    unit: "credit"
  };
}
