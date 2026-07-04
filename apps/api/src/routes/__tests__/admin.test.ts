import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import type { ApiConfig } from "../../config";
import { ConfigPackageCatalog } from "../../services/packageCatalog";

const packageCatalog = new ConfigPackageCatalog({
  packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
});

function config(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    port: 8787,
    gatewayBaseUrl: "https://gateway.gw-link.local",
    authDevCodesEnabled: true,
    modelConfigPath: "config/models.json",
    packagesConfigPath: "config/credit-packages.json",
    initialCredits: 100,
    publicBaseUrl: "http://localhost:8787",
    devTopupEnabled: false,
    devPaymentsEnabled: true,
    devAdminEnabled: true,
    ...overrides
  };
}

async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
  const start = await server.inject({ method: "POST", url: "/v1/auth/start-login", payload: { destination: "buyer@example.com" } });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({ method: "POST", url: "/v1/auth/verify-login", payload: { challengeId, code: devCode } });
  return (verify.json() as { token: string }).token;
}

describe("GET /v1/admin/orders", () => {
  it("returns 403 when admin is disabled", async () => {
    const server = buildServer({ config: config({ devAdminEnabled: false }), packageCatalog });
    const response = await server.inject({ method: "GET", url: "/v1/admin/orders" });
    expect(response.statusCode).toBe(403);
  });

  it("lists all orders when admin is enabled", async () => {
    const server = buildServer({ config: config(), packageCatalog });
    const token = await authenticate(server);
    await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${token}` }, payload: { packageId: "credits-100" } });

    const response = await server.inject({ method: "GET", url: "/v1/admin/orders" });
    expect(response.statusCode).toBe(200);
    const { orders } = response.json() as { orders: Array<{ packageId: string }> };
    expect(orders).toHaveLength(1);
    expect(orders[0]?.packageId).toBe("credits-100");
  });
});
