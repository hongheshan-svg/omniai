import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { AuthService } from "../../services/authService";
import { createAuthGuard } from "../authGuard";

function fakeAuthService(): AuthService {
  return {
    startLogin: () => {
      throw new Error("not implemented");
    },
    verifyLogin: () => {
      throw new Error("not implemented");
    },
    getSession: (token) =>
      token === "good-token"
        ? {
            authenticated: true,
            user: {
              id: "user-1",
              displayName: "creator",
              destination: "creator@example.com",
              channel: "email",
              plan: "free",
              createdAt: "2026-06-20T00:00:00.000Z"
            },
            expiresAt: "2026-06-27T00:00:00.000Z"
          }
        : { authenticated: false, user: null, expiresAt: null },
    logout: () => false
  } satisfies AuthService;
}

function buildGuardedServer(authService: AuthService) {
  const server = Fastify({ logger: false });
  server.get("/protected", { preHandler: createAuthGuard(authService) }, async (request) => ({
    userId: request.userId
  }));
  return server;
}

describe("createAuthGuard", () => {
  it("passes through and attaches userId for a valid bearer token", async () => {
    const server = buildGuardedServer(fakeAuthService());
    const response = await server.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer good-token" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: "user-1" });
  });

  it("rejects missing, non-bearer, and invalid tokens with 401", async () => {
    const server = buildGuardedServer(fakeAuthService());

    for (const headers of [
      undefined,
      { authorization: "Basic good-token" },
      { authorization: "Bearer wrong-token" }
    ] as const) {
      const response = await server.inject({ method: "GET", url: "/protected", headers });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Authentication required" });
    }
  });
});
