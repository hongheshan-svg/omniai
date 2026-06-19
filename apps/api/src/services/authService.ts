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
}

interface LoginChallengeRecord {
  id: string;
  destination: string;
  channel: "email" | "phone";
  codeHash: string;
  expiresAtMs: number;
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
  private readonly challenges = new Map<string, LoginChallengeRecord>();
  private readonly usersBySubject = new Map<string, UserProfile>();
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(options: AuthServiceOptions = {}) {
    this.challengeTtlMs = options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.clock = options.clock ?? { now: () => new Date() };
    this.codeGenerator = options.codeGenerator ?? generateNumericCode;
    this.tokenGenerator = options.tokenGenerator ?? randomUUID;
    this.challengeIdGenerator = options.challengeIdGenerator ?? randomUUID;
    this.devCodesEnabled = options.devCodesEnabled ?? true;
  }

  startLogin(request: LoginStartRequest): LoginStartResponse {
    const destination = normalizeDestination(request.destination);
    const channel = request.channel ?? inferLoginChannel(destination);
    const code = this.codeGenerator();
    const challengeId = this.challengeIdGenerator();
    const expiresAtMs = this.clock.now().getTime() + this.challengeTtlMs;

    this.challenges.set(challengeId, {
      id: challengeId,
      destination,
      channel,
      codeHash: hashCode(code),
      expiresAtMs
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
    const challenge = this.challenges.get(request.challengeId);

    if (!challenge) {
      throw new AuthError("Login challenge was not found", 404);
    }

    if (challenge.expiresAtMs <= this.clock.now().getTime()) {
      this.challenges.delete(request.challengeId);
      throw new AuthError("Login challenge expired", 410);
    }

    if (challenge.codeHash !== hashCode(request.code)) {
      throw new AuthError("Invalid verification code", 401);
    }

    this.challenges.delete(request.challengeId);
    const user = this.findOrCreateUser(challenge);
    const token = this.tokenGenerator();
    const expiresAtMs = this.clock.now().getTime() + this.sessionTtlMs;

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
    if (!token) {
      return anonymousSession();
    }

    const session = this.sessions.get(token);

    if (!session || session.expiresAtMs <= this.clock.now().getTime()) {
      if (session) {
        this.sessions.delete(token);
      }
      return anonymousSession();
    }

    const user = [...this.usersBySubject.values()].find((entry) => entry.id === session.userId);

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
    const subject = `${challenge.channel}:${challenge.destination}`;
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
    return user;
  }
}

function normalizeDestination(destination: string): string {
  const normalized = destination.trim();

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
  const safeDestination = destination.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `user_${channel}_${safeDestination}`;
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
