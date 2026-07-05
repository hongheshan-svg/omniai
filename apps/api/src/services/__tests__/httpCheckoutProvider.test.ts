import { describe, expect, it, vi } from "vitest";
import type { PaymentProviderDefinition } from "../paymentProviderConfig";
import { PaymentProviderError } from "../paymentProvider";
import { HttpCheckoutProvider } from "../httpCheckoutProvider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const stripeDefinition: PaymentProviderDefinition = {
  id: "stripe",
  displayName: "Stripe",
  protocol: "http-checkout",
  baseUrl: "https://api.stripe.com/v1",
  apiKeyEnv: "STRIPE_API_KEY",
  webhookSecretEnv: "STRIPE_WEBHOOK_SECRET"
};

function request() {
  return { checkoutRef: "chk_1", amountCents: 990, currency: "CNY", packageId: "credits-100" };
}

describe("HttpCheckoutProvider", () => {
  it("falls back to the same deterministic mock URL as Fake when no API key is configured, without calling fetch", async () => {
    const fetchMock = vi.fn();
    const provider = new HttpCheckoutProvider({
      definition: stripeDefinition,
      publicBaseUrl: "https://app.test",
      env: {},
      fetch: fetchMock as unknown as typeof fetch
    });

    const result = await provider.createCheckout(request());

    expect(result).toEqual({
      checkoutUrl: "https://app.test/checkout/mock?ref=chk_1",
      providerRef: "chk_1"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the provider checkout endpoint and maps the response when an API key is present", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: "https://pay/x", id: "cs_1" }));
    const provider = new HttpCheckoutProvider({
      definition: stripeDefinition,
      publicBaseUrl: "https://app.test",
      env: { STRIPE_API_KEY: "sk_test" },
      fetch: fetchMock as unknown as typeof fetch
    });

    const result = await provider.createCheckout(request());

    expect(result).toEqual({ checkoutUrl: "https://pay/x", providerRef: "cs_1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_test");
    expect(JSON.parse(init.body as string)).toEqual({
      reference: "chk_1",
      amountCents: 990,
      currency: "CNY",
      packageId: "credits-100"
    });
  });

  it("maps a non-2xx provider response to a 502 PaymentProviderError", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    const provider = new HttpCheckoutProvider({
      definition: stripeDefinition,
      publicBaseUrl: "https://app.test",
      env: { STRIPE_API_KEY: "sk_test" },
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(provider.createCheckout(request())).rejects.toMatchObject({
      name: "PaymentProviderError",
      statusCode: 502
    });
  });

  it("maps a network failure to a 502 PaymentProviderError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const provider = new HttpCheckoutProvider({
      definition: stripeDefinition,
      publicBaseUrl: "https://app.test",
      env: { STRIPE_API_KEY: "sk_test" },
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(provider.createCheckout(request())).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it("maps a non-JSON response body to a 502 PaymentProviderError", async () => {
    const fetchMock = vi.fn(
      async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } })
    );
    const provider = new HttpCheckoutProvider({
      definition: stripeDefinition,
      publicBaseUrl: "https://app.test",
      env: { STRIPE_API_KEY: "sk_test" },
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(provider.createCheckout(request())).rejects.toMatchObject({
      name: "PaymentProviderError",
      statusCode: 502
    });
  });

  it("maps an unexpected response shape to a 502 PaymentProviderError", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: 123, id: "cs_1" }));
    const provider = new HttpCheckoutProvider({
      definition: stripeDefinition,
      publicBaseUrl: "https://app.test",
      env: { STRIPE_API_KEY: "sk_test" },
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(provider.createCheckout(request())).rejects.toMatchObject({
      name: "PaymentProviderError",
      statusCode: 502
    });
  });
});
