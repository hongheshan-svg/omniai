import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

describe("loadConfig", () => {
  it("returns default API configuration", () => {
    expect(loadConfig({})).toEqual({
      port: 8787,
      gatewayBaseUrl: "https://gateway.gw-link.local",
      authDevCodesEnabled: true,
      modelConfigPath: "config/models.json"
    });
  });

  it("returns supplied API configuration", () => {
    expect(
      loadConfig({
        PORT: "9000",
        GW_LINK_GATEWAY_BASE_URL: "https://gateway.example",
        GW_LINK_AUTH_DEV_CODES_ENABLED: "false",
        GW_LINK_MODEL_CONFIG_PATH: "/tmp/custom-models.json"
      })
    ).toEqual({
      port: 9000,
      gatewayBaseUrl: "https://gateway.example",
      authDevCodesEnabled: false,
      modelConfigPath: "/tmp/custom-models.json"
    });
  });

  it("returns the supplied model config path", () => {
    expect(loadConfig({ GW_LINK_MODEL_CONFIG_PATH: "fixtures/models.json" })).toMatchObject({
      modelConfigPath: "fixtures/models.json"
    });
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
});
