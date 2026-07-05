import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

describe("loadConfig", () => {
  it("returns default API configuration", () => {
    expect(loadConfig({})).toEqual({
      port: 8787,
      gatewayBaseUrl: "https://gateway.gw-link.local",
      authDevCodesEnabled: true,
      modelConfigPath: "config/models.json",
      packagesConfigPath: "config/credit-packages.json",
      paymentProvidersConfigPath: "config/payment-providers.json",
      initialCredits: 100,
      publicBaseUrl: "http://localhost:8787",
      devTopupEnabled: true,
      devPaymentsEnabled: true,
      devAdminEnabled: true,
      adminEmails: []
    });
  });

  it("returns supplied API configuration", () => {
    expect(
      loadConfig({
        PORT: "9000",
        GW_LINK_GATEWAY_BASE_URL: "https://gateway.example",
        GW_LINK_AUTH_DEV_CODES_ENABLED: "false",
        GW_LINK_MODEL_CONFIG_PATH: "/tmp/custom-models.json",
        GW_LINK_INITIAL_CREDITS: "250"
      })
    ).toEqual({
      port: 9000,
      gatewayBaseUrl: "https://gateway.example",
      authDevCodesEnabled: false,
      modelConfigPath: "/tmp/custom-models.json",
      packagesConfigPath: "config/credit-packages.json",
      paymentProvidersConfigPath: "config/payment-providers.json",
      initialCredits: 250,
      publicBaseUrl: "http://localhost:9000",
      devTopupEnabled: true,
      devPaymentsEnabled: true,
      devAdminEnabled: true,
      adminEmails: []
    });
  });

  it("returns the supplied model config path", () => {
    expect(loadConfig({ GW_LINK_MODEL_CONFIG_PATH: "fixtures/models.json" })).toMatchObject({
      modelConfigPath: "fixtures/models.json"
    });
  });

  it("defaults the packages config path", () => {
    expect(loadConfig({}).packagesConfigPath).toBe("config/credit-packages.json");
  });

  it("returns the supplied packages config path", () => {
    expect(loadConfig({ GW_LINK_PACKAGES_CONFIG_PATH: "fixtures/credit-packages.json" })).toMatchObject({
      packagesConfigPath: "fixtures/credit-packages.json"
    });
  });

  it("defaults the payment providers config path", () => {
    expect(loadConfig({}).paymentProvidersConfigPath).toBe("config/payment-providers.json");
  });

  it("returns the supplied payment providers config path", () => {
    expect(
      loadConfig({ GW_LINK_PAYMENT_PROVIDERS_CONFIG_PATH: "fixtures/payment-providers.json" })
    ).toMatchObject({
      paymentProvidersConfigPath: "fixtures/payment-providers.json"
    });
  });

  it("omits the payment provider override when not provided", () => {
    expect(loadConfig({}).paymentProvider).toBeUndefined();
  });

  it("returns the supplied payment provider override", () => {
    expect(loadConfig({ GW_LINK_PAYMENT_PROVIDER: "stripe" }).paymentProvider).toBe("stripe");
  });

  it("disables auth dev codes by default in production", () => {
    expect(loadConfig({ NODE_ENV: "production" })).toMatchObject({
      authDevCodesEnabled: false
    });
  });

  it("allows auth dev codes to be explicitly enabled in production", () => {
    expect(
      loadConfig({
        NODE_ENV: "production",
        GW_LINK_AUTH_DEV_CODES_ENABLED: "true"
      })
    ).toMatchObject({
      authDevCodesEnabled: true
    });
  });

  it("allows auth dev codes to be explicitly disabled outside production", () => {
    expect(loadConfig({ GW_LINK_AUTH_DEV_CODES_ENABLED: "false" })).toMatchObject({
      authDevCodesEnabled: false
    });
  });

  it("rejects invalid auth dev code configuration values", () => {
    expect(() => loadConfig({ GW_LINK_AUTH_DEV_CODES_ENABLED: "yes" })).toThrow(
      'GW_LINK_AUTH_DEV_CODES_ENABLED must be "true" or "false"'
    );
  });

  it("rejects non-numeric PORT values", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(
      "PORT must be an integer between 1 and 65535"
    );
  });

  it("rejects out-of-range PORT values", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow(
      "PORT must be an integer between 1 and 65535"
    );
  });

  it("includes the database URL when provided", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://localhost:5432/omni" })).toMatchObject({
      databaseUrl: "postgres://localhost:5432/omni"
    });
  });

  it("omits the database URL when not provided", () => {
    expect(loadConfig({}).databaseUrl).toBeUndefined();
  });

  it("includes the payment webhook secret when provided", () => {
    expect(loadConfig({ GW_LINK_PAYMENT_WEBHOOK_SECRET: "whsec_x" })).toMatchObject({
      paymentWebhookSecret: "whsec_x"
    });
  });

  it("omits the payment webhook secret when not provided", () => {
    expect(loadConfig({}).paymentWebhookSecret).toBeUndefined();
  });

  it("parses comma-separated CORS origins", () => {
    expect(
      loadConfig({ GW_LINK_CORS_ORIGINS: "http://localhost:1420, tauri://localhost" }).corsOrigins
    ).toEqual(["http://localhost:1420", "tauri://localhost"]);
  });

  it("omits CORS origins when not provided", () => {
    expect(loadConfig({}).corsOrigins).toBeUndefined();
  });

  it("defaults initial credits to 100", () => {
    expect(loadConfig({}).initialCredits).toBe(100);
  });

  it("parses a custom initial credit grant", () => {
    expect(loadConfig({ GW_LINK_INITIAL_CREDITS: "20" }).initialCredits).toBe(20);
  });

  it("allows a zero initial credit grant", () => {
    expect(loadConfig({ GW_LINK_INITIAL_CREDITS: "0" }).initialCredits).toBe(0);
  });

  it("rejects negative or non-integer initial credit values", () => {
    expect(() => loadConfig({ GW_LINK_INITIAL_CREDITS: "-5" })).toThrow(
      "GW_LINK_INITIAL_CREDITS must be a non-negative integer"
    );
    expect(() => loadConfig({ GW_LINK_INITIAL_CREDITS: "1.5" })).toThrow(
      "GW_LINK_INITIAL_CREDITS must be a non-negative integer"
    );
  });

  it("defaults the public base URL to localhost on the configured port", () => {
    expect(loadConfig({ PORT: "9000" }).publicBaseUrl).toBe("http://localhost:9000");
  });

  it("uses an explicit public base URL", () => {
    expect(loadConfig({ GW_LINK_PUBLIC_BASE_URL: "https://api.example.com" }).publicBaseUrl).toBe(
      "https://api.example.com"
    );
  });

  it("includes the object store dir when provided", () => {
    expect(loadConfig({ GW_LINK_OBJECT_STORE_DIR: "/var/data/objects" }).objectStoreDir).toBe(
      "/var/data/objects"
    );
  });

  it("omits the object store dir when not provided", () => {
    expect(loadConfig({}).objectStoreDir).toBeUndefined();
  });

  it("disables dev top-up by default in production", () => {
    expect(loadConfig({ NODE_ENV: "production" }).devTopupEnabled).toBe(false);
  });

  it("allows dev top-up to be explicitly enabled in production", () => {
    expect(loadConfig({ NODE_ENV: "production", GW_LINK_DEV_TOPUP_ENABLED: "true" }).devTopupEnabled).toBe(true);
  });

  it("rejects invalid dev top-up configuration values", () => {
    expect(() => loadConfig({ GW_LINK_DEV_TOPUP_ENABLED: "yes" })).toThrow(
      'GW_LINK_DEV_TOPUP_ENABLED must be "true" or "false"'
    );
  });

  it("disables dev payment completion by default in production", () => {
    expect(loadConfig({ NODE_ENV: "production" }).devPaymentsEnabled).toBe(false);
  });

  it("enables dev admin by default outside production", () => {
    expect(loadConfig({}).devAdminEnabled).toBe(true);
  });

  it("disables dev admin by default in production", () => {
    expect(loadConfig({ NODE_ENV: "production" }).devAdminEnabled).toBe(false);
  });

  it("refuses to enable dev admin in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", GW_LINK_DEV_ADMIN_ENABLED: "true" })).toThrow(
      "GW_LINK_DEV_ADMIN_ENABLED must not be true in production"
    );
  });

  it("allows dev admin to be explicitly disabled outside production", () => {
    expect(loadConfig({ GW_LINK_DEV_ADMIN_ENABLED: "false" }).devAdminEnabled).toBe(false);
  });

  it("rejects invalid dev admin configuration values", () => {
    expect(() => loadConfig({ GW_LINK_DEV_ADMIN_ENABLED: "yes" })).toThrow(
      "Invalid GW_LINK_DEV_ADMIN_ENABLED value: yes"
    );
  });

  it("defaults admin emails to an empty list", () => {
    expect(loadConfig({}).adminEmails).toEqual([]);
  });

  it("parses comma-separated admin emails", () => {
    expect(loadConfig({ GW_LINK_ADMIN_EMAILS: "a@x.com,b@y.com" }).adminEmails).toEqual(["a@x.com", "b@y.com"]);
  });

  it("trims whitespace and drops empty entries in admin emails", () => {
    expect(loadConfig({ GW_LINK_ADMIN_EMAILS: " a@x.com , , b@y.com " }).adminEmails).toEqual(["a@x.com", "b@y.com"]);
  });
});
