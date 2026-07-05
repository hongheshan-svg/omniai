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
    paymentProvidersConfigPath: "config/payment-providers.json",
    initialCredits: 100,
    publicBaseUrl: "http://localhost:8787",
    devTopupEnabled: false,
    devPaymentsEnabled: true,
    devAdminEnabled: true,
    adminEmails: ["buyer@example.com"],
    ...overrides
  };
}

async function authenticateAs(server: ReturnType<typeof buildServer>, destination: string): Promise<string> {
  const start = await server.inject({ method: "POST", url: "/v1/auth/start-login", payload: { destination } });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({ method: "POST", url: "/v1/auth/verify-login", payload: { challengeId, code: devCode } });
  return (verify.json() as { token: string }).token;
}

async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
  return authenticateAs(server, "buyer@example.com");
}

describe("GET /v1/admin/orders", () => {
  it("returns 401 when unauthenticated", async () => {
    const server = buildServer({ config: config(), packageCatalog });
    const response = await server.inject({ method: "GET", url: "/v1/admin/orders" });
    expect(response.statusCode).toBe(401);
  });

  it("returns 403 when authenticated as a non-admin", async () => {
    const server = buildServer({ config: config(), packageCatalog });
    const token = await authenticateAs(server, "other@example.com");
    const response = await server.inject({
      method: "GET",
      url: "/v1/admin/orders",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Admin access required" });
  });

  it("returns 403 when admin is authenticated but admin orders are disabled", async () => {
    const server = buildServer({ config: config({ devAdminEnabled: false }), packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "GET",
      url: "/v1/admin/orders",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Admin orders are disabled" });
  });

  it("lists all orders when the caller is an admin and admin orders are enabled", async () => {
    const server = buildServer({ config: config(), packageCatalog });
    const token = await authenticate(server);
    await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${token}` }, payload: { packageId: "credits-100" } });

    const response = await server.inject({
      method: "GET",
      url: "/v1/admin/orders",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
    const { orders } = response.json() as { orders: Array<{ packageId: string }> };
    expect(orders).toHaveLength(1);
    expect(orders[0]?.packageId).toBe("credits-100");
  });
});
