import { describe, expect, it } from "vitest";
import { buildServer } from "../../server";
import { InMemoryAuthService } from "../../services/authService";

const fixedNow = new Date("2026-06-19T12:00:00.000Z");

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
        id: "user_email_creator_example_com",
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
        id: "user_email_creator_example_com"
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
});
