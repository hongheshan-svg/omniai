import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { ConfigPackageCatalog } from "../../services/packageCatalog";

const packageCatalog = new ConfigPackageCatalog({
  packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
});

describe("GET /v1/packages", () => {
  it("returns the public package catalog without auth", async () => {
    const server = buildServer({ packageCatalog });
    const response = await server.inject({ method: "GET", url: "/v1/packages" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
    });
  });
});
