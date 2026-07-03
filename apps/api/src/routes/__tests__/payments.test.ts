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
