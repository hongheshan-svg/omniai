import { describe, expect, it } from "vitest";
import { AuthError, InMemoryAuthService } from "../authService";

const fixedNow = new Date("2026-06-19T12:00:00.000Z");
const hashedEmailUserId = /^user_email_[a-f0-9]{16}$/;
const hashedPhoneUserId = /^user_phone_[a-f0-9]{16}$/;

function createService() {
  return new InMemoryAuthService({
    clock: { now: () => fixedNow },
    codeGenerator: () => "123456",
    tokenGenerator: () => "session-token-1",
    challengeIdGenerator: () => "challenge-1",
    devCodesEnabled: true
  });
}

function createSequenceGenerator(values: string[]): () => string {
  let index = 0;

  return () => {
    const value = values[index];
    index += 1;

    if (value === undefined) {
      throw new Error("Sequence generator exhausted");
    }

    return value;
  };
}

function createMutableClock(initialNow: Date) {
  let now = initialNow;

  return {
    clock: { now: () => now },
    setNow: (nextNow: Date) => {
      now = nextNow;
    }
  };
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
        id: expect.stringMatching(hashedEmailUserId),
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
        id: expect.stringMatching(hashedEmailUserId),
        displayName: "creator"
      }
    });
  });

  it("keeps active sessions isolated when email destinations collide under slug ids", () => {
    const service = new InMemoryAuthService({
      clock: { now: () => fixedNow },
      codeGenerator: () => "123456",
      tokenGenerator: createSequenceGenerator(["token-1", "token-2"]),
      challengeIdGenerator: createSequenceGenerator(["challenge-1", "challenge-2"]),
      devCodesEnabled: true
    });

    service.startLogin({ destination: "a+b@example.com" });
    const firstSession = service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    service.startLogin({ destination: "a.b@example.com" });
    const secondSession = service.verifyLogin({ challengeId: "challenge-2", code: "123456" });

    expect(firstSession.user.id).toMatch(hashedEmailUserId);
    expect(secondSession.user.id).toMatch(hashedEmailUserId);
    expect(firstSession.user.id).not.toBe(secondSession.user.id);
    expect(service.getSession("token-1")).toMatchObject({
      authenticated: true,
      user: {
        id: firstSession.user.id,
        destination: "a+b@example.com",
        displayName: "a+b"
      }
    });
    expect(service.getSession("token-2")).toMatchObject({
      authenticated: true,
      user: {
        id: secondSession.user.id,
        destination: "a.b@example.com",
        displayName: "a.b"
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
      id: expect.stringMatching(hashedEmailUserId),
      displayName: "creator",
      destination: "creator@example.com"
    });
  });

  it("normalizes phone destinations before creating users", () => {
    const service = createService();
    service.startLogin({ destination: "+86 138 0013 8000" });

    expect(service.verifyLogin({ challengeId: "challenge-1", code: "123456" }).user).toMatchObject({
      id: expect.stringMatching(hashedPhoneUserId),
      displayName: "User 8000",
      destination: "8613800138000"
    });
  });

  it("sweeps expired challenges before starting another login", () => {
    const { clock, setNow } = createMutableClock(fixedNow);
    const service = new InMemoryAuthService({
      challengeTtlMs: 1_000,
      clock,
      codeGenerator: () => "123456",
      tokenGenerator: () => "active-token",
      challengeIdGenerator: createSequenceGenerator(["expired-challenge", "active-challenge"]),
      devCodesEnabled: true
    });

    service.startLogin({ destination: "expired@example.com" });
    setNow(new Date(fixedNow.getTime() + 1_001));
    service.startLogin({ destination: "active@example.com" });

    expect(() =>
      service.verifyLogin({ challengeId: "expired-challenge", code: "123456" })
    ).toThrow(new AuthError("Login challenge was not found", 404));
    expect(service.verifyLogin({ challengeId: "active-challenge", code: "123456" }).user).toMatchObject({
      destination: "active@example.com"
    });
  });

  it("sweeps expired sessions before creating another session", () => {
    const { clock, setNow } = createMutableClock(fixedNow);
    const service = new InMemoryAuthService({
      challengeTtlMs: 10_000,
      sessionTtlMs: 1_000,
      clock,
      codeGenerator: () => "123456",
      tokenGenerator: createSequenceGenerator(["expired-token", "active-token"]),
      challengeIdGenerator: createSequenceGenerator(["challenge-1", "challenge-2"]),
      devCodesEnabled: true
    });

    service.startLogin({ destination: "expired@example.com" });
    service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    setNow(new Date(fixedNow.getTime() + 1_001));
    service.startLogin({ destination: "active@example.com" });
    service.verifyLogin({ challengeId: "challenge-2", code: "123456" });

    expect(service.logout("expired-token")).toBe(false);
    expect(service.getSession("active-token")).toMatchObject({
      authenticated: true,
      user: {
        destination: "active@example.com"
      }
    });
  });

  it("sweeps expired sessions during session lookup without dropping active sessions", () => {
    const { clock, setNow } = createMutableClock(fixedNow);
    const service = new InMemoryAuthService({
      challengeTtlMs: 10_000,
      sessionTtlMs: 1_000,
      clock,
      codeGenerator: () => "123456",
      tokenGenerator: createSequenceGenerator(["expired-token", "active-token"]),
      challengeIdGenerator: createSequenceGenerator(["challenge-1", "challenge-2"]),
      devCodesEnabled: true
    });

    service.startLogin({ destination: "expired@example.com" });
    service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    setNow(new Date(fixedNow.getTime() + 500));
    service.startLogin({ destination: "active@example.com" });
    service.verifyLogin({ challengeId: "challenge-2", code: "123456" });

    setNow(new Date(fixedNow.getTime() + 1_001));

    expect(service.getSession("active-token")).toMatchObject({
      authenticated: true,
      user: {
        destination: "active@example.com"
      }
    });
    expect(service.logout("expired-token")).toBe(false);
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
