import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { AuthError, InMemoryAuthService, type AuthService } from "../../services/authService";

const fixedNow = new Date("2026-06-19T12:00:00.000Z");
const hashedEmailUserId = /^user_email_[a-f0-9]{16}$/;

function buildAuthTestServer() {
  return buildServer({
    authService: new InMemoryAuthService({
      clock: { now: () => fixedNow },
      codeGenerator: () => "123456",
      tokenGenerator: () => "session-token-1",
      challengeIdGenerator: () => "challenge-1",
      devCodesEnabled: true
    })
  });
}

function anonymousSessionResponse() {
  return {
    authenticated: false,
    user: null,
    expiresAt: null
  };
}

describe("auth routes", () => {
  it("starts passwordless login", async () => {
    const server = buildAuthTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: {
        destination: "creator@example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      challengeId: "challenge-1",
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: "2026-06-19T12:05:00.000Z",
      devCode: "123456"
    });
  });

  it("verifies login and returns the current session", async () => {
    const server = buildAuthTestServer();
    await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: { destination: "creator@example.com" }
    });

    const verifyResponse = await server.inject({
      method: "POST",
      url: "/v1/auth/verify-login",
      payload: {
        challengeId: "challenge-1",
        code: "123456"
      }
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json()).toMatchObject({
      token: "session-token-1",
      user: {
        id: expect.stringMatching(hashedEmailUserId),
        displayName: "creator",
        plan: "free"
      },
      expiresAt: "2026-06-26T12:00:00.000Z"
    });

    const sessionResponse = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        authorization: "Bearer session-token-1"
      }
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toMatchObject({
      authenticated: true,
      user: {
        id: expect.stringMatching(hashedEmailUserId)
      },
      expiresAt: "2026-06-26T12:00:00.000Z"
    });
  });

  it("logs out a bearer session", async () => {
    const server = buildAuthTestServer();
    await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: { destination: "creator@example.com" }
    });
    await server.inject({
      method: "POST",
      url: "/v1/auth/verify-login",
      payload: { challengeId: "challenge-1", code: "123456" }
    });

    const logoutResponse = await server.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        authorization: "Bearer session-token-1"
      }
    });

    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({ ok: true });

    const sessionResponse = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        authorization: "Bearer session-token-1"
      }
    });

    expect(sessionResponse.json()).toEqual({
      authenticated: false,
      user: null,
      expiresAt: null
    });
  });

  it("maps auth errors to response status codes", async () => {
    const server = buildAuthTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/verify-login",
      payload: {
        challengeId: "missing",
        code: "123456"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Login challenge was not found"
    });
  });

  it("rejects malformed login start requests before reaching the auth service", async () => {
    const server = buildAuthTestServer();
    const invalidRequests = [
      {},
      { destination: 123 },
      { destination: "creator@example.com", channel: "sms" },
      ["creator@example.com"]
    ];

    for (const payload of invalidRequests) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/auth/start-login",
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invalid login start request"
      });
    }
  });

  it("rejects missing login start request bodies", async () => {
    const server = buildAuthTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/start-login"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid login start request"
    });
  });

  it("rejects malformed login verification requests before reaching the auth service", async () => {
    const server = buildAuthTestServer();
    await server.inject({
      method: "POST",
      url: "/v1/auth/start-login",
      payload: { destination: "creator@example.com" }
    });

    const invalidRequests = [
      {},
      { code: "123456" },
      { challengeId: "challenge-1" },
      { challengeId: 123, code: "123456" },
      ["challenge-1", "123456"]
    ];

    for (const payload of invalidRequests) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/auth/verify-login",
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "Invalid login verification request"
      });
    }
  });

  it("rejects missing login verification request bodies", async () => {
    const server = buildAuthTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/verify-login"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid login verification request"
    });
  });

  it("maps auth errors thrown by session routes to response status codes", async () => {
    const server = buildServer({
      authService: buildThrowingAuthService({
        getSession: () => {
          throw new AuthError("Session lookup failed", 409);
        }
      })
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        authorization: "Bearer session-token-1"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Session lookup failed"
    });
  });

  it("maps auth errors thrown by logout routes to response status codes", async () => {
    const server = buildServer({
      authService: buildThrowingAuthService({
        logout: () => {
          throw new AuthError("Logout failed", 409);
        }
      })
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        authorization: "Bearer session-token-1"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Logout failed"
    });
  });

  it("treats missing and non-bearer authorization headers as anonymous sessions", async () => {
    const server = buildAuthTestServer();

    for (const authorization of [undefined, "Basic session-token-1", "Bearer"] as const) {
      const response = await server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: authorization ? { authorization } : undefined
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(anonymousSessionResponse());
    }
  });

  it("returns ok when logout receives missing and non-bearer authorization headers", async () => {
    const server = buildAuthTestServer();

    for (const authorization of [undefined, "Basic session-token-1", "Bearer"] as const) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: authorization ? { authorization } : undefined
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    }
  });
});

function buildThrowingAuthService(overrides: Partial<AuthService>): AuthService {
  return {
    startLogin: () => {
      throw new Error("Unexpected startLogin call");
    },
    verifyLogin: () => {
      throw new Error("Unexpected verifyLogin call");
    },
    getSession: () => anonymousSessionResponse(),
    logout: () => false,
    ...overrides
  };
}
