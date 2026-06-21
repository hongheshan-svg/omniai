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
import type {
  ChallengeRepository,
  LoginChallengeRecord,
  SessionRecord,
  SessionRepository,
  UserRepository
} from "../repositories/types";
import {
  InMemoryChallengeRepository,
  InMemorySessionRepository,
  InMemoryUserRepository
} from "../repositories/memory";

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

export interface AuthService {
  startLogin(request: LoginStartRequest): LoginStartResponse | Promise<LoginStartResponse>;
  verifyLogin(request: LoginVerifyRequest): AuthSession | Promise<AuthSession>;
  getSession(token: string | undefined): SessionResponse | Promise<SessionResponse>;
  logout(token: string | undefined): boolean | Promise<boolean>;
}

export interface AuthRepositories {
  users: UserRepository;
  sessions: SessionRepository;
  challenges: ChallengeRepository;
}

export class AuthServiceImpl implements AuthService {
  private readonly challengeTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly clock: AuthClock;
  private readonly codeGenerator: () => string;
  private readonly tokenGenerator: () => string;
  private readonly challengeIdGenerator: () => string;
  private readonly devCodesEnabled: boolean;
  private readonly maxFailedAttempts: number;
  private readonly users: UserRepository;
  private readonly sessions: SessionRepository;
  private readonly challenges: ChallengeRepository;

  constructor(repositories: AuthRepositories, options: AuthServiceOptions = {}) {
    this.users = repositories.users;
    this.sessions = repositories.sessions;
    this.challenges = repositories.challenges;
    this.challengeTtlMs = options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.clock = options.clock ?? { now: () => new Date() };
    this.codeGenerator = options.codeGenerator ?? generateNumericCode;
    this.tokenGenerator = options.tokenGenerator ?? randomUUID;
    this.challengeIdGenerator = options.challengeIdGenerator ?? randomUUID;
    this.devCodesEnabled = options.devCodesEnabled ?? false;
    this.maxFailedAttempts = options.maxFailedAttempts ?? DEFAULT_MAX_FAILED_ATTEMPTS;
  }

  async startLogin(request: LoginStartRequest): Promise<LoginStartResponse> {
    const channel = request.channel ?? inferLoginChannel(request.destination.trim());
    const destination = normalizeDestination(request.destination, channel);
    const nowMs = this.clock.now().getTime();
    await this.challenges.deleteExpired(nowMs);

    const code = this.codeGenerator();
    const challengeId = this.challengeIdGenerator();
    const expiresAtMs = nowMs + this.challengeTtlMs;

    await this.challenges.save({
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

  async verifyLogin(request: LoginVerifyRequest): Promise<AuthSession> {
    const nowMs = this.clock.now().getTime();
    await this.sessions.deleteExpired(nowMs);

    const challenge = await this.challenges.findById(request.challengeId);

    if (!challenge) {
      throw new AuthError("Login challenge was not found", 404);
    }

    if (challenge.expiresAtMs <= nowMs) {
      await this.challenges.delete(request.challengeId);
      throw new AuthError("Login challenge expired", 410);
    }

    if (challenge.codeHash !== hashCode(request.code)) {
      challenge.failedAttempts += 1;

      if (challenge.failedAttempts >= this.maxFailedAttempts) {
        await this.challenges.delete(request.challengeId);
        throw new AuthError("Too many invalid verification attempts", 429);
      }

      await this.challenges.update(challenge);
      throw new AuthError("Invalid verification code", 401);
    }

    await this.challenges.delete(request.challengeId);
    const user = await this.findOrCreateUser(challenge);
    const token = this.tokenGenerator();
    const expiresAtMs = nowMs + this.sessionTtlMs;

    await this.sessions.save({ token, userId: user.id, expiresAtMs });

    return {
      token,
      user,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  async getSession(token: string | undefined): Promise<SessionResponse> {
    const nowMs = this.clock.now().getTime();
    await this.sessions.deleteExpired(nowMs);

    if (!token) {
      return anonymousSession();
    }

    const session = await this.sessions.findByToken(token);

    if (!session) {
      return anonymousSession();
    }

    const user = await this.users.findById(session.userId);

    if (!user) {
      return anonymousSession();
    }

    return {
      authenticated: true,
      user,
      expiresAt: new Date(session.expiresAtMs).toISOString()
    };
  }

  async logout(token: string | undefined): Promise<boolean> {
    if (!token) {
      return false;
    }

    return this.sessions.delete(token);
  }

  private async findOrCreateUser(challenge: LoginChallengeRecord): Promise<UserProfile> {
    const existing = await this.users.findBySubject(challenge.channel, challenge.destination);

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

    await this.users.insert(user);
    return user;
  }
}

export class InMemoryAuthService extends AuthServiceImpl {
  constructor(options: AuthServiceOptions = {}) {
    super(
      {
        users: new InMemoryUserRepository(),
        sessions: new InMemorySessionRepository(),
        challenges: new InMemoryChallengeRepository()
      },
      options
    );
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
