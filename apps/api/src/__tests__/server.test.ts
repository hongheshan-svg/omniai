import { describe, expect, it } from "vitest";
import { buildServer } from "../server";
import type { AuthService } from "../services/authService";

describe("product API", () => {
  it("returns service health", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "gw-link-omniai-api",
      status: "ok"
    });
  });

  it("returns product-facing model catalog", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/v1/models" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      models: [
        {
          id: "gw-text-balanced",
          displayName: "OmniAI Text Balanced",
          capability: "text",
          tags: ["recommended", "balanced"],
          visibility: "visible",
          minimumPlan: "free",
          creditUnitCost: 1
        },
        {
          id: "gw-image-creative",
          displayName: "OmniAI Image Creative",
          capability: "image",
          tags: ["creative", "high-quality"],
          visibility: "visible",
          minimumPlan: "pro",
          creditUnitCost: 2
        },
        {
          id: "gw-video-motion",
          displayName: "OmniAI Video Motion",
          capability: "video",
          tags: ["motion", "async-task"],
          visibility: "visible",
          minimumPlan: "studio",
          creditUnitCost: 3
        }
      ]
    });
  });

  it("registers the prompt optimization route", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/prompt/optimize",
      payload: {
        mode: "text",
        prompt: "帮我写一个新品发布文案"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      optimization: {
        mode: "text",
        originalPrompt: "帮我写一个新品发布文案",
        preset: {
          modelId: "recommended-text",
          creditEstimate: { credits: 1, unit: "credit" }
        }
      }
    });
  });

  it("does not load environment config when an auth service is injected", () => {
    const originalPort = process.env.PORT;
    const fakeAuthService = {
      startLogin: () => ({
        challengeId: "challenge_1",
        channel: "email",
        maskedDestination: "c***@example.com",
        expiresAt: "2026-06-20T00:00:00.000Z"
      }),
      verifyLogin: () => {
        throw new Error("not implemented");
      },
      getSession: () => ({
        authenticated: false,
        user: null,
        expiresAt: null
      }),
      logout: () => false
    } satisfies AuthService;

    try {
      process.env.PORT = "abc";

      expect(() => buildServer({ authService: fakeAuthService })).not.toThrow();
    } finally {
      if (originalPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = originalPort;
      }
    }
  });

  it("includes auth dev codes when the default auth service is configured for local development", async () => {
    const server = buildServer({
      config: {
        port: 8787,
        gatewayBaseUrl: "https://gateway.gw-link.local",
        authDevCodesEnabled: true
      }
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: {
        destination: "creator@example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      challengeId: expect.any(String),
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: expect.any(String),
      devCode: expect.stringMatching(/^\d{6}$/)
    });
  });

  it("omits auth dev codes when the default auth service is configured for production", async () => {
    const server = buildServer({
      config: {
        port: 8787,
        gatewayBaseUrl: "https://gateway.gw-link.local",
        authDevCodesEnabled: false
      }
    });
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: {
        destination: "creator@example.com"
      }
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      challengeId: expect.any(String),
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: expect.any(String)
    });
    expect(body).not.toHaveProperty("devCode");
  });
});
