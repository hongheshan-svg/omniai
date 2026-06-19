import { describe, expect, it } from "vitest";
import { estimateCreditCost } from "../credits";

describe("estimateCreditCost", () => {
  it("estimates text cost from token count", () => {
    expect(
      estimateCreditCost({
        capability: "text",
        estimatedInputTokens: 600,
        estimatedOutputTokens: 1400
      })
    ).toEqual({ credits: 2, unit: "credit" });
  });

  it("estimates image cost from image count and quality multiplier", () => {
    expect(
      estimateCreditCost({
        capability: "image",
        imageCount: 4,
        quality: "high"
      })
    ).toEqual({ credits: 8, unit: "credit" });
  });

  it("estimates video cost from duration seconds and resolution multiplier", () => {
    expect(
      estimateCreditCost({
        capability: "video",
        durationSeconds: 6,
        resolution: "1080p"
      })
    ).toEqual({ credits: 18, unit: "credit" });
  });
});
