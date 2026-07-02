import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiClient, ProductModel } from "@gw-link-omniai/shared";
import { ModelCatalogSection } from "../ModelCatalogSection";

const models: ProductModel[] = [
  { id: "gw-text-balanced", displayName: "均衡文本", capability: "text", tags: [], visibility: "visible", minimumPlan: "free", creditUnitCost: 1 },
  { id: "gw-image-creative", displayName: "创意图片", capability: "image", tags: [], visibility: "visible", minimumPlan: "pro", creditUnitCost: 2 }
];

function fakeClient(overrides: Partial<ApiClient>): ApiClient {
  return { listModels: async () => models, ...overrides } as unknown as ApiClient;
}

describe("ModelCatalogSection", () => {
  it("renders the fetched model catalog", async () => {
    render(<ModelCatalogSection client={fakeClient({})} />);
    expect(await screen.findByText("均衡文本")).toBeTruthy();
    expect(screen.getByText("文本 · free · 1 积分")).toBeTruthy();
    expect(screen.getByText("创意图片")).toBeTruthy();
    expect(screen.getByText("图片 · pro · 2 积分")).toBeTruthy();
  });

  it("shows an error message when loading fails", async () => {
    const client = fakeClient({ listModels: async () => { throw new Error("boom"); } });
    render(<ModelCatalogSection client={client} />);
    expect(await screen.findByText("模型目录加载失败，请稍后重试")).toBeTruthy();
  });
});
