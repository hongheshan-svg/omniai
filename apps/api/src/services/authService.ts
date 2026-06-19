import { createHash, randomInt, randomUUID } from "node:crypto";
import type {
  AuthSession,
  LoginStartRequest,
  LoginStartResponse,
  LoginVerifyRequest,
  SessionResponse,
  UserProfile
} from "@gw-link-omniai/shared";
import { inferLoginChannel, maskLoginDestination } from "@gw-link-omniai/shared";

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthClock {
  now(): Date;
}

export interface AuthServiceOptions {
  challengeTtlMs?: number;
  sessionTtlMs?: number;
  clock?: AuthClock;
  codeGenerator?: () => string;
  tokenGenerator?: () => string;
  challengeIdGenerator?: () => string;
  devCodesEnabled?: boolean;
  maxFailedAttempts?: number;
}

interface LoginChallengeRecord {
  id: string;
  destination: string;
  channel: "email" | "phone";
  codeHash: string;
  expiresAtMs: number;
  failedAttempts: number;
}

interface SessionRecord {
  token: string;
  userId: string;
  expiresAtMs: number;
}

export interface AuthService {
  startLogin(request: LoginStartRequest): LoginStartResponse;
  verifyLogin(request: LoginVerifyRequest): AuthSession;
  getSession(token: string | undefined): SessionResponse;
  logout(token: string | undefined): boolean;
}

export class InMemoryAuthService implements AuthService {
  private readonly challengeTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly clock: AuthClock;
  private readonly codeGenerator: () => string;
  private readonly tokenGenerator: () => string;
  private readonly challengeIdGenerator: () => string;
  private readonly devCodesEnabled: boolean;
  private readonly maxFailedAttempts: number;
  private readonly challenges = new Map<string, LoginChallengeRecord>();
  private readonly usersBySubject = new Map<string, UserProfile>();
  private readonly usersById = new Map<string, UserProfile>();
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(options: AuthServiceOptions = {}) {
    this.challengeTtlMs = options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.clock = options.clock ?? { now: () => new Date() };
    this.codeGenerator = options.codeGenerator ?? generateNumericCode;
    this.tokenGenerator = options.tokenGenerator ?? randomUUID;
    this.challengeIdGenerator = options.challengeIdGenerator ?? randomUUID;
    this.devCodesEnabled = options.devCodesEnabled ?? false;
    this.maxFailedAttempts = options.maxFailedAttempts ?? DEFAULT_MAX_FAILED_ATTEMPTS;
  }

  startLogin(request: LoginStartRequest): LoginStartResponse {
    const channel = request.channel ?? inferLoginChannel(request.destination.trim());
    const destination = normalizeDestination(request.destination, channel);
    const nowMs = this.clock.now().getTime();
    this.sweepExpiredChallenges(nowMs);

    const code = this.codeGenerator();
    const challengeId = this.challengeIdGenerator();
    const expiresAtMs = nowMs + this.challengeTtlMs;

    this.challenges.set(challengeId, {
      id: challengeId,
      destination,
      channel,
      codeHash: hashCode(code),
      expiresAtMs,
      failedAttempts: 0
    });

    return {
      challengeId,
      channel,
      maskedDestination: maskLoginDestination(destination, channel),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ...(this.devCodesEnabled ? { devCode: code } : {})
    };
  }

  verifyLogin(request: LoginVerifyRequest): AuthSession {
    const nowMs = this.clock.now().getTime();
    this.sweepExpiredSessions(nowMs);

    const challenge = this.challenges.get(request.challengeId);

    if (!challenge) {
      throw new AuthError("Login challenge was not found", 404);
    }

    if (challenge.expiresAtMs <= nowMs) {
      this.challenges.delete(request.challengeId);
      throw new AuthError("Login challenge expired", 410);
    }

    if (challenge.codeHash !== hashCode(request.code)) {
      challenge.failedAttempts += 1;

      if (challenge.failedAttempts >= this.maxFailedAttempts) {
        this.challenges.delete(request.challengeId);
        throw new AuthError("Too many invalid verification attempts", 429);
      }

      throw new AuthError("Invalid verification code", 401);
    }

    this.challenges.delete(request.challengeId);
    const user = this.findOrCreateUser(challenge);
    const token = this.tokenGenerator();
    const expiresAtMs = nowMs + this.sessionTtlMs;

    this.sessions.set(token, {
      token,
      userId: user.id,
      expiresAtMs
    });

    return {
      token,
      user,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  getSession(token: string | undefined): SessionResponse {
    const nowMs = this.clock.now().getTime();
    this.sweepExpiredSessions(nowMs);

    if (!token) {
      return anonymousSession();
    }

    const session = this.sessions.get(token);

    if (!session) {
      return anonymousSession();
    }

    const user = this.usersById.get(session.userId);

    if (!user) {
      return anonymousSession();
    }

    return {
      authenticated: true,
      user,
      expiresAt: new Date(session.expiresAtMs).toISOString()
    };
  }

  logout(token: string | undefined): boolean {
    if (!token) {
      return false;
    }

    return this.sessions.delete(token);
  }

  private findOrCreateUser(challenge: LoginChallengeRecord): UserProfile {
    const subject = createUserSubject(challenge.channel, challenge.destination);
    const existing = this.usersBySubject.get(subject);

    if (existing) {
      return existing;
    }

    const user: UserProfile = {
      id: createUserId(challenge.channel, challenge.destination),
      displayName: createDisplayName(challenge.destination, challenge.channel),
      destination: challenge.destination,
      channel: challenge.channel,
      plan: "free",
      createdAt: this.clock.now().toISOString()
    };

    this.usersBySubject.set(subject, user);
    this.usersById.set(user.id, user);
    return user;
  }

  private sweepExpiredChallenges(nowMs: number): void {
    for (const [challengeId, challenge] of this.challenges) {
      if (challenge.expiresAtMs <= nowMs) {
        this.challenges.delete(challengeId);
      }
    }
  }

  private sweepExpiredSessions(nowMs: number): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAtMs <= nowMs) {
        this.sessions.delete(token);
      }
    }
  }
}

function normalizeDestination(destination: string, channel: "email" | "phone"): string {
  const normalized = channel === "email" ? destination.trim().toLowerCase() : destination.trim().replace(/\D/g, "");

  if (!normalized) {
    throw new AuthError("Login destination is required", 400);
  }

  return normalized;
}

function generateNumericCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function createUserId(channel: "email" | "phone", destination: string): string {
  const subjectHash = createHash("sha256").update(createUserSubject(channel, destination)).digest("hex").slice(0, 16);
  return `user_${channel}_${subjectHash}`;
}

function createUserSubject(channel: "email" | "phone", destination: string): string {
  return `${channel}:${destination}`;
}

function createDisplayName(destination: string, channel: "email" | "phone"): string {
  if (channel === "email") {
    return destination.split("@")[0] || "OmniAI User";
  }

  return `User ${destination.replace(/\D/g, "").slice(-4)}`;
}

function anonymousSession(): SessionResponse {
  return {
    authenticated: false,
    user: null,
    expiresAt: null
  };
}
