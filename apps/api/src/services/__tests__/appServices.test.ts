import { describe, expect, it } from "vitest";
import type { ApiConfig } from "../../config";
import { createServices } from "../appServices";
import { InMemoryAssetService } from "../assetService";
import { InMemoryAuthService } from "../authService";
import { InMemoryGenerationService } from "../generationService";

function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    port: 8787,
    gatewayBaseUrl: "https://gateway.gw-link.local",
    authDevCodesEnabled: true,
    modelConfigPath: "config/models.json",
    initialCredits: 100,
    publicBaseUrl: "http://localhost:8787",
    ...overrides
  };
}

describe("createServices", () => {
  it("builds in-memory services when DATABASE_URL is absent", async () => {
    const services = createServices(baseConfig());

    expect(services.authService).toBeInstanceOf(InMemoryAuthService);
    expect(services.generationService).toBeInstanceOf(InMemoryGenerationService);
    expect(services.assetService).toBeInstanceOf(InMemoryAssetService);
    await expect(services.verifyConnectivity()).resolves.toBeUndefined();
    await expect(services.closeDb()).resolves.toBeUndefined();
  });

  it("builds database-backed services when DATABASE_URL is present", async () => {
    const services = createServices(baseConfig({ databaseUrl: "postgres://localhost:5432/omni" }));

    // postgres.js connects lazily, so construction does not open a socket.
    expect(services.authService).not.toBeInstanceOf(InMemoryAuthService);
    expect(services.generationService).not.toBeInstanceOf(InMemoryGenerationService);
    expect(services.assetService).not.toBeInstanceOf(InMemoryAssetService);
    expect(typeof services.verifyConnectivity).toBe("function");

    await services.closeDb();
  });
});
