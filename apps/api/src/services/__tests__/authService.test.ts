import { describe, expect, it } from "vitest";
import { AuthError, InMemoryAuthService } from "../authService";

describe("AuthService initial credit grant", () => {
  it("grants initial credits only when a new user is created", async () => {
    const granted: string[] = [];
    const service = new InMemoryAuthService({
      devCodesEnabled: true,
      creditGranter: {
        grantInitial: async (userId: string) => {
          granted.push(userId);
        }
      }
    });

    const first = await service.startLogin({ destination: "grantee@example.com" });
    const firstSession = await service.verifyLogin({ challengeId: first.challengeId, code: first.devCode! });
    const second = await service.startLogin({ destination: "grantee@example.com" });
    await service.verifyLogin({ challengeId: second.challengeId, code: second.devCode! });

    expect(granted).toEqual([firstSession.user.id]);
  });
});

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
  it("starts a login challenge with masked destination and dev code", async () => {
    const service = createService();

    expect(await service.startLogin({ destination: "creator@example.com" })).toEqual({
      challengeId: "challenge-1",
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: "2026-06-19T12:05:00.000Z",
      devCode: "123456"
    });
  });

  it("does not include dev codes by default", async () => {
    const service = new InMemoryAuthService({
      clock: { now: () => fixedNow },
      codeGenerator: () => "123456",
      challengeIdGenerator: () => "challenge-1"
    });

    expect(await service.startLogin({ destination: "creator@example.com" })).toEqual({
      challengeId: "challenge-1",
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: "2026-06-19T12:05:00.000Z"
    });
  });

  it("verifies a challenge and returns a session", async () => {
    const service = createService();
    await service.startLogin({ destination: "creator@example.com" });

    expect(await service.verifyLogin({ challengeId: "challenge-1", code: "123456" })).toEqual({
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

  it("returns active session details for a valid token", async () => {
    const service = createService();
    await service.startLogin({ destination: "creator@example.com" });
    await service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    expect(await service.getSession("session-token-1")).toMatchObject({
      authenticated: true,
      expiresAt: "2026-06-26T12:00:00.000Z",
      user: {
        id: expect.stringMatching(hashedEmailUserId),
        displayName: "creator"
      }
    });
  });

  it("keeps active sessions isolated when email destinations collide under slug ids", async () => {
    const service = new InMemoryAuthService({
      clock: { now: () => fixedNow },
      codeGenerator: () => "123456",
      tokenGenerator: createSequenceGenerator(["token-1", "token-2"]),
      challengeIdGenerator: createSequenceGenerator(["challenge-1", "challenge-2"]),
      devCodesEnabled: true
    });

    await service.startLogin({ destination: "a+b@example.com" });
    const firstSession = await service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    await service.startLogin({ destination: "a.b@example.com" });
    const secondSession = await service.verifyLogin({ challengeId: "challenge-2", code: "123456" });

    expect(firstSession.user.id).toMatch(hashedEmailUserId);
    expect(secondSession.user.id).toMatch(hashedEmailUserId);
    expect(firstSession.user.id).not.toBe(secondSession.user.id);
    expect(await service.getSession("token-1")).toMatchObject({
      authenticated: true,
      user: {
        id: firstSession.user.id,
        destination: "a+b@example.com",
        displayName: "a+b"
      }
    });
    expect(await service.getSession("token-2")).toMatchObject({
      authenticated: true,
      user: {
        id: secondSession.user.id,
        destination: "a.b@example.com",
        displayName: "a.b"
      }
    });
  });

  it("returns an anonymous session for a missing token", async () => {
    const service = createService();

    expect(await service.getSession(undefined)).toEqual({
      authenticated: false,
      user: null,
      expiresAt: null
    });
  });

  it("rejects an invalid verification code", async () => {
    const service = createService();
    await service.startLogin({ destination: "creator@example.com" });

    await expect(
      service.verifyLogin({ challengeId: "challenge-1", code: "000000" })
    ).rejects.toThrow(new AuthError("Invalid verification code", 401));
  });

  it("deletes a challenge after too many invalid verification attempts", async () => {
    const service = new InMemoryAuthService({
      clock: { now: () => fixedNow },
      codeGenerator: () => "123456",
      tokenGenerator: () => "session-token-1",
      challengeIdGenerator: () => "challenge-1",
      devCodesEnabled: true,
      maxFailedAttempts: 2
    });
    await service.startLogin({ destination: "creator@example.com" });

    await expect(
      service.verifyLogin({ challengeId: "challenge-1", code: "000000" })
    ).rejects.toThrow(new AuthError("Invalid verification code", 401));
    await expect(
      service.verifyLogin({ challengeId: "challenge-1", code: "111111" })
    ).rejects.toThrow(new AuthError("Too many invalid verification attempts", 429));
    await expect(
      service.verifyLogin({ challengeId: "challenge-1", code: "123456" })
    ).rejects.toThrow(new AuthError("Login challenge was not found", 404));
  });

  it("normalizes email destinations before creating users", async () => {
    const service = createService();
    await service.startLogin({ destination: " Creator@Example.COM " });

    expect((await service.verifyLogin({ challengeId: "challenge-1", code: "123456" })).user).toMatchObject({
      id: expect.stringMatching(hashedEmailUserId),
      displayName: "creator",
      destination: "creator@example.com"
    });
  });

  it("normalizes phone destinations before creating users", async () => {
    const service = createService();
    await service.startLogin({ destination: "+86 138 0013 8000" });

    expect((await service.verifyLogin({ challengeId: "challenge-1", code: "123456" })).user).toMatchObject({
      id: expect.stringMatching(hashedPhoneUserId),
      displayName: "User 8000",
      destination: "8613800138000"
    });
  });

  it("sweeps expired challenges before starting another login", async () => {
    const { clock, setNow } = createMutableClock(fixedNow);
    const service = new InMemoryAuthService({
      challengeTtlMs: 1_000,
      clock,
      codeGenerator: () => "123456",
      tokenGenerator: () => "active-token",
      challengeIdGenerator: createSequenceGenerator(["expired-challenge", "active-challenge"]),
      devCodesEnabled: true
    });

    await service.startLogin({ destination: "expired@example.com" });
    setNow(new Date(fixedNow.getTime() + 1_001));
    await service.startLogin({ destination: "active@example.com" });

    await expect(
      service.verifyLogin({ challengeId: "expired-challenge", code: "123456" })
    ).rejects.toThrow(new AuthError("Login challenge was not found", 404));
    expect((await service.verifyLogin({ challengeId: "active-challenge", code: "123456" })).user).toMatchObject({
      destination: "active@example.com"
    });
  });

  it("sweeps expired sessions before creating another session", async () => {
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

    await service.startLogin({ destination: "expired@example.com" });
    await service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    setNow(new Date(fixedNow.getTime() + 1_001));
    await service.startLogin({ destination: "active@example.com" });
    await service.verifyLogin({ challengeId: "challenge-2", code: "123456" });

    expect(await service.logout("expired-token")).toBe(false);
    expect(await service.getSession("active-token")).toMatchObject({
      authenticated: true,
      user: {
        destination: "active@example.com"
      }
    });
  });

  it("sweeps expired sessions during session lookup without dropping active sessions", async () => {
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

    await service.startLogin({ destination: "expired@example.com" });
    await service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    setNow(new Date(fixedNow.getTime() + 500));
    await service.startLogin({ destination: "active@example.com" });
    await service.verifyLogin({ challengeId: "challenge-2", code: "123456" });

    setNow(new Date(fixedNow.getTime() + 1_001));

    expect(await service.getSession("active-token")).toMatchObject({
      authenticated: true,
      user: {
        destination: "active@example.com"
      }
    });
    expect(await service.logout("expired-token")).toBe(false);
  });

  it("logs out a session token", async () => {
    const service = createService();
    await service.startLogin({ destination: "creator@example.com" });
    await service.verifyLogin({ challengeId: "challenge-1", code: "123456" });

    expect(await service.logout("session-token-1")).toBe(true);
    expect(await service.getSession("session-token-1")).toEqual({
      authenticated: false,
      user: null,
      expiresAt: null
    });
  });
});
