import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

describe("loadConfig", () => {
  it("returns default API configuration", () => {
    expect(loadConfig({})).toEqual({
      port: 8787,
      gatewayBaseUrl: "https://gateway.gw-link.local"
    });
  });

  it("returns supplied API configuration", () => {
    expect(
      loadConfig({
        PORT: "9000",
        GW_LINK_GATEWAY_BASE_URL: "https://gateway.example"
      })
    ).toEqual({
      port: 9000,
      gatewayBaseUrl: "https://gateway.example"
    });
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
});
