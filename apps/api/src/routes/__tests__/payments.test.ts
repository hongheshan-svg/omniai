import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import type { ApiConfig } from "../../config";
import { ConfigPackageCatalog } from "../../services/packageCatalog";
import { signWebhookPayload } from "../../services/webhookSignature";

const SECRET = "whsec_test";
const packageCatalog = new ConfigPackageCatalog({
  packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
});

function config(secret?: string): ApiConfig {
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
    paymentWebhookSecret: secret
  };
}

async function authenticate(server: ReturnType<typeof buildServer>): Promise<string> {
  const start = await server.inject({ method: "POST", url: "/v1/auth/start-login", payload: { destination: "buyer@example.com" } });
  const { challengeId, devCode } = start.json() as { challengeId: string; devCode: string };
  const verify = await server.inject({ method: "POST", url: "/v1/auth/verify-login", payload: { challengeId, code: devCode } });
  return (verify.json() as { token: string }).token;
}

describe("POST /v1/payments/webhook", () => {
  it("rejects a missing signature", async () => {
    const server = buildServer({ config: config(SECRET), packageCatalog });
    const response = await server.inject({
      method: "POST",
      url: "/v1/payments/webhook",
      payload: { type: "payment.succeeded", checkoutRef: "x" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("credits the buyer on a signed payment.succeeded and is idempotent", async () => {
    const server = buildServer({ config: config(SECRET), packageCatalog });
    const token = await authenticate(server);
    const auth = { authorization: `Bearer ${token}` };

    // create the order, capture its checkoutRef
    const created = await server.inject({ method: "POST", url: "/v1/orders", headers: auth, payload: { packageId: "credits-100" } });
    const { order } = created.json() as { order: { checkoutRef: string } };

    const rawBody = JSON.stringify({ type: "payment.succeeded", checkoutRef: order.checkoutRef });
    const signature = signWebhookPayload(rawBody, SECRET);

    const balanceBefore = await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth });
    const before = (balanceBefore.json() as { balance: { credits: number } }).balance.credits;

    const hook1 = await server.inject({
      method: "POST",
      url: "/v1/payments/webhook",
      headers: { "content-type": "application/json", "x-gw-signature": signature },
      payload: rawBody
    });
    expect(hook1.statusCode).toBe(200);

    const balanceAfter = await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth });
    expect((balanceAfter.json() as { balance: { credits: number } }).balance.credits).toBe(before + 100);

    // redelivery — no double credit
    const hook2 = await server.inject({
      method: "POST",
      url: "/v1/payments/webhook",
      headers: { "content-type": "application/json", "x-gw-signature": signature },
      payload: rawBody
    });
    expect(hook2.statusCode).toBe(200);
    const balanceFinal = await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth });
    expect((balanceFinal.json() as { balance: { credits: number } }).balance.credits).toBe(before + 100);
  });
});

describe("POST /v1/payments/dev-complete", () => {
  it("returns 403 when dev payments are disabled", async () => {
    const server = buildServer({ config: { ...config(SECRET), devPaymentsEnabled: false }, packageCatalog });
    const token = await authenticate(server);
    const created = await server.inject({ method: "POST", url: "/v1/orders", headers: { authorization: `Bearer ${token}` }, payload: { packageId: "credits-100" } });
    const { order } = created.json() as { order: { id: string } };
    const response = await server.inject({ method: "POST", url: "/v1/payments/dev-complete", headers: { authorization: `Bearer ${token}` }, payload: { orderId: order.id } });
    expect(response.statusCode).toBe(403);
  });

  it("rejects an unauthenticated dev-complete", async () => {
    const server = buildServer({ config: { ...config(SECRET), devPaymentsEnabled: true }, packageCatalog });
    const response = await server.inject({ method: "POST", url: "/v1/payments/dev-complete", payload: { orderId: "x" } });
    expect(response.statusCode).toBe(401);
  });

  it("404s for an order the caller does not own", async () => {
    const server = buildServer({ config: { ...config(SECRET), devPaymentsEnabled: true }, packageCatalog });
    const token = await authenticate(server);
    const response = await server.inject({ method: "POST", url: "/v1/payments/dev-complete", headers: { authorization: `Bearer ${token}` }, payload: { orderId: "missing" } });
    expect(response.statusCode).toBe(404);
  });

  it("completes payment and credits the buyer (idempotent)", async () => {
    const server = buildServer({ config: { ...config(SECRET), devPaymentsEnabled: true }, packageCatalog });
    const token = await authenticate(server);
    const auth = { authorization: `Bearer ${token}` };
    const created = await server.inject({ method: "POST", url: "/v1/orders", headers: auth, payload: { packageId: "credits-100" } });
    const { order } = created.json() as { order: { id: string } };
    const before = ((await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth })).json() as { balance: { credits: number } }).balance.credits;

    const done = await server.inject({ method: "POST", url: "/v1/payments/dev-complete", headers: auth, payload: { orderId: order.id } });
    expect(done.statusCode).toBe(200);
    expect((done.json() as { order: { status: string } }).order.status).toBe("paid");
    const after = ((await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth })).json() as { balance: { credits: number } }).balance.credits;
    expect(after).toBe(before + 100);

    // idempotent
    await server.inject({ method: "POST", url: "/v1/payments/dev-complete", headers: auth, payload: { orderId: order.id } });
    const final = ((await server.inject({ method: "GET", url: "/v1/credits/balance", headers: auth })).json() as { balance: { credits: number } }).balance.credits;
    expect(final).toBe(before + 100);
  });
});
