import { describe, expect, it } from "vitest";
import { AuthError, InMemoryAuthService } from "../authService";

const fixedNow = new Date("2026-06-19T12:00:00.000Z");

function createService() {
  return new InMemoryAuthService({
    clock: { now: () => fixedNow },
    codeGenerator: () => "123456",
    tokenGenerator: () => "session-token-1",
    challengeIdGenerator: () => "challenge-1",
    devCodesEnabled: true
  });
}

describe("InMemoryAuthService", () => {
  it("starts a login challenge with masked destination and dev code", () => {
    const service = createService();

    expect(service.startLogin({ destination: "creator@example.com" })).toEqual({
      challengeId: "challenge-1",
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: "2026-06-19T12:05:00.000Z",
      devCode: "123456"
    });
  });

  it("verifies a challenge and returns a session", () => {
    const service = createService();
    service.startLogin({ destination: "creator@example.com" });

    expect(service.verifyLogin({ challengeId: "challenge-1", code: "123456" })).toEqual({
      token: "session-token-1",
      user: {
        id: "user_email_creator_example_com",
        displayName: "creator",
        destination: "creator@example.com",
        channel: "email",
        plan: "free",
        createdAt: "2026-06-19T12:00:00.000Z"
      },
      expiresAt: "2026-06-26T12:00:00.000Z"
    });
  });

  it("returns active session details for a valid token", () => {
    const service = createService();
    service.startLogin({ destination: "creator@example.com" });
    service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    expect(service.getSession("session-token-1")).toMatchObject({
      authenticated: true,
      expiresAt: "2026-06-26T12:00:00.000Z",
      user: {
        id: "user_email_creator_example_com",
        displayName: "creator"
      }
    });
  });

  it("returns an anonymous session for a missing token", () => {
    const service = createService();

    expect(service.getSession(undefined)).toEqual({
      authenticated: false,
      user: null,
      expiresAt: null
    });
  });

  it("rejects an invalid verification code", () => {
    const service = createService();
    service.startLogin({ destination: "creator@example.com" });

    expect(() =>
      service.verifyLogin({ challengeId: "challenge-1", code: "000000" })
    ).toThrow(new AuthError("Invalid verification code", 401));
  });

  it("logs out a session token", () => {
    const service = createService();
    service.startLogin({ destination: "creator@example.com" });
    service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    expect(service.logout("session-token-1")).toBe(true);
    expect(service.getSession("session-token-1")).toEqual({
      authenticated: false,
      user: null,
      expiresAt: null
    });
  });
});
