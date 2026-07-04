import { describe, expect, it } from "vitest";
import {
  loadPaymentProvidersConfig,
  parsePaymentProvidersConfig
} from "../paymentProviderConfig";
import { resolveConfigPath } from "../modelConfig";

const validConfig = {
  activeProvider: "fake",
  providers: [
    {
      id: "fake",
      displayName: "Mock Checkout",
      protocol: "mock",
      baseUrl: "",
      apiKeyEnv: "",
      webhookSecretEnv: "GW_LINK_PAYMENT_WEBHOOK_SECRET"
    },
    {
      id: "stripe",
      displayName: "Stripe",
      protocol: "http-checkout",
      baseUrl: "https://api.stripe.com/v1",
      apiKeyEnv: "STRIPE_API_KEY",
      webhookSecretEnv: "STRIPE_WEBHOOK_SECRET"
    }
  ]
};

describe("parsePaymentProvidersConfig", () => {
  it("parses a valid payment providers config", () => {
    const config = parsePaymentProvidersConfig(validConfig);
    expect(config.activeProvider).toBe("fake");
    expect(config.providers[0].id).toBe("fake");
    expect(config.providers[1].id).toBe("stripe");
  });

  it("allows a provider definition without a webhookSecretEnv", () => {
    const config = parsePaymentProvidersConfig({
      activeProvider: "fake",
      providers: [
        { id: "fake", displayName: "Mock Checkout", protocol: "mock", baseUrl: "", apiKeyEnv: "" }
      ]
    });
    expect(config.providers[0].webhookSecretEnv).toBeUndefined();
  });

  it("throws when the value is not an object", () => {
    expect(() => parsePaymentProvidersConfig(null)).toThrow(
      "Invalid payment-providers config: not an object"
    );
    expect(() => parsePaymentProvidersConfig("nope")).toThrow(
      "Invalid payment-providers config: not an object"
    );
  });

  it("throws when providers is missing", () => {
    expect(() => parsePaymentProvidersConfig({ activeProvider: "fake" })).toThrow(
      "Invalid payment-providers config: bad shape"
    );
  });

  it("throws when activeProvider is not a string", () => {
    expect(() =>
      parsePaymentProvidersConfig({ activeProvider: 1, providers: [] })
    ).toThrow("Invalid payment-providers config: bad shape");
  });

  it("throws when a provider definition is malformed", () => {
    expect(() =>
      parsePaymentProvidersConfig({
        activeProvider: "fake",
        providers: [{ id: "fake" }]
      })
    ).toThrow("Invalid payment-providers config: bad shape");
  });
});

describe("loadPaymentProvidersConfig", () => {
  it("reads and parses the repository payment-providers config", () => {
    const config = loadPaymentProvidersConfig(resolveConfigPath("config/payment-providers.json"));
    expect(config.activeProvider).toBe("fake");
    expect(config.providers.map((provider) => provider.id)).toEqual(["fake", "stripe"]);
  });
});
