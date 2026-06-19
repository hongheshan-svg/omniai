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

  it("does not include dev codes by default", () => {
    const service = new InMemoryAuthService({
      clock: { now: () => fixedNow },
      codeGenerator: () => "123456",
      challengeIdGenerator: () => "challenge-1"
    });

    expect(service.startLogin({ destination: "creator@example.com" })).toEqual({
      challengeId: "challenge-1",
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: "2026-06-19T12:05:00.000Z"
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

  it("deletes a challenge after too many invalid verification attempts", () => {
    const service = new InMemoryAuthService({
      clock: { now: () => fixedNow },
      codeGenerator: () => "123456",
      tokenGenerator: () => "session-token-1",
      challengeIdGenerator: () => "challenge-1",
      devCodesEnabled: true,
      maxFailedAttempts: 2
    });
    service.startLogin({ destination: "creator@example.com" });

    expect(() =>
      service.verifyLogin({ challengeId: "challenge-1", code: "000000" })
    ).toThrow(new AuthError("Invalid verification code", 401));
    expect(() =>
      service.verifyLogin({ challengeId: "challenge-1", code: "111111" })
    ).toThrow(new AuthError("Too many invalid verification attempts", 429));
    expect(() =>
      service.verifyLogin({ challengeId: "challenge-1", code: "123456" })
    ).toThrow(new AuthError("Login challenge was not found", 404));
  });

  it("normalizes email destinations before creating users", () => {
    const service = createService();
    service.startLogin({ destination: " Creator@Example.COM " });

    expect(service.verifyLogin({ challengeId: "challenge-1", code: "123456" }).user).toMatchObject({
      id: "user_email_creator_example_com",
      displayName: "creator",
      destination: "creator@example.com"
    });
  });

  it("normalizes phone destinations before creating users", () => {
    const service = createService();
    service.startLogin({ destination: "+86 138 0013 8000" });

    expect(service.verifyLogin({ challengeId: "challenge-1", code: "123456" }).user).toMatchObject({
      id: "user_phone_8613800138000",
      displayName: "User 8000",
      destination: "8613800138000"
    });
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
