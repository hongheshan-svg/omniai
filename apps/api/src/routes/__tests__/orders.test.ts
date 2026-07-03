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

// helper: authenticate against the built server, returns a bearer token
async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
  const start = await server.inject({
    method: "POST",
    url: "/v1/auth/start-login",
    payload: { destination: "buyer@example.com" }
  });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({
    method: "POST",
    url: "/v1/auth/verify-login",
    payload: { challengeId, code: devCode }
  });
  return (verify.json() as { token: string }).token;
}

describe("orders routes", () => {
  it("creates a pending order for an authenticated user", async () => {
    const server = buildServer({ packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { packageId: "credits-100" }
    });
    expect(response.statusCode).toBe(201);
    const { order } = response.json() as { order: { packageId: string; status: string; checkoutRef: string; credits: number } };
    expect(order).toMatchObject({ packageId: "credits-100", status: "pending", credits: 100 });
    expect(order.checkoutRef).toBeTruthy();
  });

  it("rejects an unauthenticated create", async () => {
    const server = buildServer({ packageCatalog });
    const response = await server.inject({ method: "POST", url: "/v1/orders", payload: { packageId: "credits-100" } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });

  it("rejects an invalid body", async () => {
    const server = buildServer({ packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { packageId: 5 }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid order request" });
  });

  it("returns 404 for an unknown package", async () => {
    const server = buildServer({ packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { packageId: "nope" }
    });
    expect(response.statusCode).toBe(404);
  });

  it("lists only the caller's own orders", async () => {
    const server = buildServer({ packageCatalog });
    const tokenA = await authenticate(server);
    await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { packageId: "credits-100" }
    });
    const listA = await server.inject({ method: "GET", url: "/v1/orders", headers: { authorization: `Bearer ${tokenA}` } });
    expect(listA.statusCode).toBe(200);
    expect((listA.json() as { orders: unknown[] }).orders).toHaveLength(1);
  });
});
