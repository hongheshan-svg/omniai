import { describe, expect, it } from "vitest";
import type { PaymentProvidersConfig } from "../paymentProviderConfig";
import { FakeCheckoutProvider } from "../fakeCheckoutProvider";
import { HttpCheckoutProvider } from "../httpCheckoutProvider";
import { resolvePaymentProvider } from "../resolvePaymentProvider";

const config: PaymentProvidersConfig = {
  activeProvider: "fake",
  providers: [
    { id: "fake", displayName: "Mock Checkout", protocol: "mock", baseUrl: "", apiKeyEnv: "" },
    {
      id: "stripe",
      displayName: "Stripe",
      protocol: "http-checkout",
      baseUrl: "https://api.stripe.com/v1",
      apiKeyEnv: "STRIPE_API_KEY"
    }
  ]
};

describe("resolvePaymentProvider", () => {
  it("resolves the mock protocol to FakeCheckoutProvider when it is the active provider", () => {
    const provider = resolvePaymentProvider(config, { publicBaseUrl: "https://app.test" });

    expect(provider).toBeInstanceOf(FakeCheckoutProvider);
  });

  it("resolves a non-mock protocol to HttpCheckoutProvider via activeProviderOverride", () => {
    const provider = resolvePaymentProvider(config, {
      publicBaseUrl: "https://app.test",
      activeProviderOverride: "stripe"
    });

    expect(provider).toBeInstanceOf(HttpCheckoutProvider);
  });

  it("throws for an unknown active provider id", () => {
    expect(() =>
      resolvePaymentProvider(config, { publicBaseUrl: "https://app.test", activeProviderOverride: "nope" })
    ).toThrow("Unknown payment provider: nope");
  });
});
