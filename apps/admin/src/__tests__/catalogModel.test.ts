import { describe, expect, it } from "vitest";
import type { ProductModel } from "@gw-link-omniai/shared";
import { formatModelSummary, getModelCapabilityLabel } from "../catalogModel";

function model(overrides: Partial<ProductModel>): ProductModel {
  return {
    id: "m1",
    displayName: "M1",
    capability: "text",
    tags: [],
    visibility: "visible",
    minimumPlan: "free",
    creditUnitCost: 1,
    ...overrides
  };
}

describe("catalogModel", () => {
  it("labels capabilities in Chinese", () => {
    expect(getModelCapabilityLabel("text")).toBe("文本");
    expect(getModelCapabilityLabel("image")).toBe("图片");
    expect(getModelCapabilityLabel("video")).toBe("视频");
  });

  it("formats a model summary line", () => {
    expect(formatModelSummary(model({ capability: "text", minimumPlan: "free", creditUnitCost: 1 }))).toBe("文本 · free · 1 积分");
    expect(formatModelSummary(model({ capability: "image", minimumPlan: "pro", creditUnitCost: 2 }))).toBe("图片 · pro · 2 积分");
    expect(formatModelSummary(model({ capability: "video", minimumPlan: "studio", creditUnitCost: 3 }))).toBe("视频 · studio · 3 积分");
  });
});
