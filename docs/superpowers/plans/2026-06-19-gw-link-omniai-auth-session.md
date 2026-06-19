# GW-LINK OmniAI Auth Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable account login and session foundation for GW-LINK OmniAI across shared contracts, product API, and the app shells.

**Architecture:** Add shared auth contracts for passwordless login, implement an in-memory API auth service for MVP development, expose `/v1/auth/*` routes with bearer sessions, and surface sign-in/session entry points in desktop, mobile, and admin shells. This slice does not send real SMS/email or persist users to a database; it creates the boundary that later providers and storage will plug into.

**Tech Stack:** TypeScript, Vitest, Fastify, React, React Native, pnpm workspaces.

---

## Scope Check

The PRD calls for registration, login, multi-device session state, and account synchronization. This plan implements the first independent slice: passwordless email/phone verification and bearer sessions. It intentionally excludes payment, quotas, persistent databases, real SMS/email providers, OAuth, password reset, and device management.

## File Structure

- Create: `packages/shared/src/auth.ts` - shared auth request/response contracts and destination helpers.
- Create: `packages/shared/src/__tests__/auth.test.ts` - shared auth helper tests.
- Modify: `packages/shared/src/index.ts` - export auth contracts and helpers.
- Create: `apps/api/src/services/authService.ts` - in-memory challenge, user, and session service.
- Create: `apps/api/src/services/__tests__/authService.test.ts` - auth service unit tests.
- Create: `apps/api/src/routes/auth.ts` - Fastify auth routes.
- Create: `apps/api/src/routes/__tests__/auth.test.ts` - API auth route tests.
- Modify: `apps/api/src/server.ts` - register auth routes and allow auth service injection for tests.
- Create: `apps/desktop/src/sessionModel.ts` - desktop session CTA model.
- Modify: `apps/desktop/src/App.tsx` - render sign-in entry point.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` - assert sign-in entry point.
- Create: `apps/mobile/src/sessionModel.ts` - mobile session CTA model.
- Modify: `apps/mobile/src/homeModel.ts` - include sign-in action.
- Modify: `apps/mobile/src/__tests__/homeModel.test.ts` - assert mobile auth action.
- Create: `apps/admin/src/sessionModel.ts` - admin session banner model.
- Modify: `apps/admin/src/appShell.tsx` - render admin auth banner.
- Modify: `apps/admin/src/__tests__/appShell.test.tsx` - assert admin auth banner.
- Modify: `docs/architecture/mvp-skeleton.md` - document auth/session boundary.
- Modify: `README.md` - document auth verification commands and local auth behavior.

## Task 1: Shared Auth Contracts

**Files:**
- Create: `packages/shared/src/auth.ts`
- Create: `packages/shared/src/__tests__/auth.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing shared auth tests**

Create `packages/shared/src/__tests__/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inferLoginChannel, maskLoginDestination } from "../auth";

describe("auth helpers", () => {
  it("infers email channel when destination contains an at sign", () => {
    expect(inferLoginChannel("creator@example.com")).toBe("email");
  });

  it("infers phone channel for non-email destinations", () => {
    expect(inferLoginChannel("+86 138 0013 8000")).toBe("phone");
  });

  it("masks email destinations without hiding the domain", () => {
    expect(maskLoginDestination("creator@example.com")).toBe("c***@example.com");
  });

  it("masks phone destinations while preserving the final four digits", () => {
    expect(maskLoginDestination("+86 138 0013 8000")).toBe("*********8000");
  });
});
```

- [ ] **Step 2: Run the shared auth test to verify it fails**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test -- auth.test.ts
```

Expected: FAIL with an import error because `packages/shared/src/auth.ts` does not exist.

- [ ] **Step 3: Implement shared auth contracts and helpers**

Create `packages/shared/src/auth.ts`:

```ts
import type { PlanCode } from "./models";

export type LoginChannel = "email" | "phone";

export interface LoginStartRequest {
  destination: string;
  channel?: LoginChannel;
}

export interface LoginStartResponse {
  challengeId: string;
  channel: LoginChannel;
  maskedDestination: string;
  expiresAt: string;
  devCode?: string;
}

export interface LoginVerifyRequest {
  challengeId: string;
  code: string;
}

export interface UserProfile {
  id: string;
  displayName: string;
  destination: string;
  channel: LoginChannel;
  plan: PlanCode;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
  expiresAt: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user: UserProfile | null;
  expiresAt: string | null;
}

export function inferLoginChannel(destination: string): LoginChannel {
  return destination.includes("@") ? "email" : "phone";
}

export function maskLoginDestination(
  destination: string,
  channel: LoginChannel = inferLoginChannel(destination)
): string {
  if (channel === "email") {
    const [localPart, domain] = destination.split("@");
    const visible = localPart.at(0) ?? "*";
    return `${visible}***@${domain ?? ""}`;
  }

  const digits = destination.replace(/\D/g, "");
  const suffix = digits.slice(-4);
  const hiddenCount = Math.max(4, digits.length - suffix.length);
  return `${"*".repeat(hiddenCount)}${suffix}`;
}
```

Modify `packages/shared/src/index.ts`:

```ts
export type {
  AuthSession,
  LoginChannel,
  LoginStartRequest,
  LoginStartResponse,
  LoginVerifyRequest,
  SessionResponse,
  UserProfile
} from "./auth";
export { inferLoginChannel, maskLoginDestination } from "./auth";
export type {
  CreditAmount,
  GenerationTask,
  GenerationTaskStatus,
  ModelCapability,
  ModelVisibility,
  PlanCode,
  ProductModel
} from "./models";
export { estimateCreditCost } from "./credits";
export type { CreditEstimateInput } from "./credits";
```

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test
pnpm --filter @gw-link-omniai/shared typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/auth.ts packages/shared/src/__tests__/auth.test.ts packages/shared/src/index.ts
git commit -m "feat: add shared auth contracts"
```

## Task 2: API Auth Service

**Files:**
- Create: `apps/api/src/services/authService.ts`
- Create: `apps/api/src/services/__tests__/authService.test.ts`

- [ ] **Step 1: Write the failing auth service tests**

Create `apps/api/src/services/__tests__/authService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the auth service tests to verify failure**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- authService.test.ts
```

Expected: FAIL because `apps/api/src/services/authService.ts` does not exist.

- [ ] **Step 3: Implement the in-memory auth service**

Create `apps/api/src/services/authService.ts`:

```ts
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
```

- [ ] **Step 4: Run API service tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- authService.test.ts
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/authService.ts apps/api/src/services/__tests__/authService.test.ts
git commit -m "feat: add in-memory auth service"
```

## Task 3: API Auth Routes

**Files:**
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/__tests__/auth.test.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Write the failing auth route tests**

Create `apps/api/src/routes/__tests__/auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the auth route test to verify failure**

Run:

```bash
pnpm --filter @gw-link-omniai/api test -- routes/__tests__/auth.test.ts
```

Expected: FAIL because `apps/api/src/routes/auth.ts` does not exist and `buildServer` does not accept an auth service.

- [ ] **Step 3: Implement auth routes and register them**

Create `apps/api/src/routes/auth.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { LoginStartRequest, LoginVerifyRequest } from "@gw-link-omniai/shared";
import { AuthError, type AuthService } from "../services/authService";

export function registerAuthRoutes(server: FastifyInstance, authService: AuthService): void {
  server.post("/v1/auth/start-login", async (request, reply) => {
    try {
      return authService.startLogin(request.body as LoginStartRequest);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  server.post("/v1/auth/verify-login", async (request, reply) => {
    try {
      return authService.verifyLogin(request.body as LoginVerifyRequest);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  server.get("/v1/auth/session", async (request) => {
    return authService.getSession(readBearerToken(request.headers.authorization));
  });

  server.post("/v1/auth/logout", async (request) => {
    authService.logout(readBearerToken(request.headers.authorization));
    return { ok: true };
  });
}

function readBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }

  return header.slice("Bearer ".length).trim() || undefined;
}

function sendAuthError(reply: { status: (code: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({
      error: error.message
    });
  }

  return reply.status(500).send({
    error: "Unexpected authentication error"
  });
}
```

Modify `apps/api/src/server.ts`:

```ts
import Fastify from "fastify";
import { loadConfig } from "./config";
import { registerAuthRoutes } from "./routes/auth";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { InMemoryAuthService, type AuthService } from "./services/authService";

export interface BuildServerOptions {
  authService?: AuthService;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: false
  });
  const authService = options.authService ?? new InMemoryAuthService();

  registerHealthRoute(server);
  registerModelRoutes(server);
  registerAuthRoutes(server, authService);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const server = buildServer();

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });

  console.log(`GW-LINK OmniAI API listening on ${config.port}`);
}
```

- [ ] **Step 4: Run API tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/src/routes/__tests__/auth.test.ts apps/api/src/server.ts
git commit -m "feat: expose auth session routes"
```

## Task 4: App Shell Session Entry Points

**Files:**
- Create: `apps/desktop/src/sessionModel.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/__tests__/App.test.tsx`
- Create: `apps/mobile/src/sessionModel.ts`
- Modify: `apps/mobile/src/homeModel.ts`
- Modify: `apps/mobile/src/__tests__/homeModel.test.ts`
- Create: `apps/admin/src/sessionModel.ts`
- Modify: `apps/admin/src/appShell.tsx`
- Modify: `apps/admin/src/__tests__/appShell.test.tsx`

- [ ] **Step 1: Write failing shell session tests**

Replace `apps/desktop/src/__tests__/App.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { getDesktopSessionCta } from "../sessionModel";

describe("Desktop App", () => {
  it("renders the three core creation modes and sign-in entry", () => {
    render(<App />);

    expect(screen.getByText("GW-LINK OmniAI")).toBeTruthy();
    expect(screen.getByText("Text Chat")).toBeTruthy();
    expect(screen.getByText("Image Generation")).toBeTruthy();
    expect(screen.getByText("Video Generation")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("summarizes authenticated desktop sessions", () => {
    expect(
      getDesktopSessionCta({
        authenticated: true,
        expiresAt: "2026-06-26T12:00:00.000Z",
        user: {
          id: "user_email_creator_example_com",
          displayName: "creator",
          destination: "creator@example.com",
          channel: "email",
          plan: "free",
          createdAt: "2026-06-19T12:00:00.000Z"
        }
      })
    ).toBe("Signed in as creator");
  });
});
```

Replace `apps/mobile/src/__tests__/homeModel.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { getMobileHomeActions } from "../homeModel";
import { getMobileSessionCta } from "../sessionModel";

describe("getMobileHomeActions", () => {
  it("returns the mobile-first creation, auth, and history actions", () => {
    expect(getMobileHomeActions()).toEqual([
      "Sign In",
      "Text Chat",
      "Image Generation",
      "Video Generation",
      "Creation History",
      "Task Notifications"
    ]);
  });

  it("returns a concise mobile session label", () => {
    expect(
      getMobileSessionCta({
        authenticated: false,
        user: null,
        expiresAt: null
      })
    ).toBe("Sign In");
  });
});
```

Replace `apps/admin/src/__tests__/appShell.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminAppShell } from "../appShell";
import { getAdminSessionBanner } from "../sessionModel";

describe("AdminAppShell", () => {
  it("renders the operations modules required by the PRD and auth banner", () => {
    render(<AdminAppShell />);

    expect(screen.getByText("GW-LINK OmniAI Admin")).toBeTruthy();
    expect(screen.getByText("Admin login required")).toBeTruthy();
    expect(screen.getByText("Users")).toBeTruthy();
    expect(screen.getByText("Plans & Credits")).toBeTruthy();
    expect(screen.getByText("Model Display")).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Usage Metrics")).toBeTruthy();
  });

  it("summarizes an authenticated admin session", () => {
    expect(
      getAdminSessionBanner({
        authenticated: true,
        expiresAt: "2026-06-26T12:00:00.000Z",
        user: {
          id: "user_email_admin_example_com",
          displayName: "admin",
          destination: "admin@example.com",
          channel: "email",
          plan: "studio",
          createdAt: "2026-06-19T12:00:00.000Z"
        }
      })
    ).toBe("Admin session active: admin");
  });
});
```

- [ ] **Step 2: Run shell tests to verify failure**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test
pnpm --filter @gw-link-omniai/mobile test
pnpm --filter @gw-link-omniai/admin test
```

Expected: FAIL because the `sessionModel` files and new UI text do not exist.

- [ ] **Step 3: Implement desktop, mobile, and admin session models**

Create `apps/desktop/src/sessionModel.ts`:

```ts
import type { SessionResponse } from "@gw-link-omniai/shared";

export function getDesktopSessionCta(session: SessionResponse): string {
  if (session.authenticated && session.user) {
    return `Signed in as ${session.user.displayName}`;
  }

  return "Sign in";
}
```

Modify `apps/desktop/src/App.tsx`:

```tsx
import { getDesktopSessionCta } from "./sessionModel";

const creationModes = [
  "Text Chat",
  "Image Generation",
  "Video Generation"
];

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function App() {
  return (
    <main>
      <header>
        <h1>GW-LINK OmniAI</h1>
        <button type="button">{getDesktopSessionCta(anonymousSession)}</button>
      </header>
      <p>One workspace for text, image, and video AI creation.</p>
      <nav aria-label="Creation modes">
        {creationModes.map((mode) => (
          <button key={mode} type="button">
            {mode}
          </button>
        ))}
      </nav>
    </main>
  );
}
```

Create `apps/mobile/src/sessionModel.ts`:

```ts
import type { SessionResponse } from "@gw-link-omniai/shared";

export function getMobileSessionCta(session: SessionResponse): string {
  if (session.authenticated && session.user) {
    return session.user.displayName;
  }

  return "Sign In";
}
```

Modify `apps/mobile/src/homeModel.ts`:

```ts
export function getMobileHomeActions(): string[] {
  return [
    "Sign In",
    "Text Chat",
    "Image Generation",
    "Video Generation",
    "Creation History",
    "Task Notifications"
  ];
}
```

Create `apps/admin/src/sessionModel.ts`:

```ts
import type { SessionResponse } from "@gw-link-omniai/shared";

export function getAdminSessionBanner(session: SessionResponse): string {
  if (session.authenticated && session.user) {
    return `Admin session active: ${session.user.displayName}`;
  }

  return "Admin login required";
}
```

Modify `apps/admin/src/appShell.tsx`:

```tsx
import { getAdminSessionBanner } from "./sessionModel";

const modules = [
  "Users",
  "Plans & Credits",
  "Model Display",
  "Orders",
  "Usage Metrics"
];

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function AdminAppShell() {
  return (
    <main>
      <h1>GW-LINK OmniAI Admin</h1>
      <p>{getAdminSessionBanner(anonymousSession)}</p>
      <p>Operations console for the commercial AI creation product.</p>
      <section aria-label="Operations modules">
        {modules.map((module) => (
          <article key={module}>
            <h2>{module}</h2>
          </article>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run shell tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test
pnpm --filter @gw-link-omniai/mobile test
pnpm --filter @gw-link-omniai/admin test
pnpm --filter @gw-link-omniai/desktop typecheck
pnpm --filter @gw-link-omniai/mobile typecheck
pnpm --filter @gw-link-omniai/admin typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/sessionModel.ts apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx apps/mobile/src/sessionModel.ts apps/mobile/src/homeModel.ts apps/mobile/src/__tests__/homeModel.test.ts apps/admin/src/sessionModel.ts apps/admin/src/appShell.tsx apps/admin/src/__tests__/appShell.test.tsx
git commit -m "feat: add app session entry points"
```

## Task 5: Documentation and Full Validation

**Files:**
- Modify: `docs/architecture/mvp-skeleton.md`
- Modify: `README.md`

- [ ] **Step 1: Update architecture notes**

Replace `docs/architecture/mvp-skeleton.md` with:

```md
# GW-LINK OmniAI MVP Skeleton Architecture

## Product Boundary

The MVP skeleton separates product experience from AI provider integration. Client apps call the product API. The product API owns user-facing model catalog rules, credit estimation, auth sessions, task records, and the adapter boundary to the existing GW-LINK AI gateway.

## Workspace Packages

- `packages/shared` contains stable product contracts used by all apps.
- `apps/api` exposes product API routes and adapts requests to product services and the GW-LINK AI gateway.
- `apps/admin` is the internal operations console for users, plans, credits, model display, orders, and usage metrics.
- `apps/desktop` is the primary creation workspace for Windows, macOS, and Linux.
- `apps/mobile` is the iOS and Android companion app for light generation, history, sharing, and notifications.

## Auth Session Slice

The first auth slice uses passwordless email/phone verification. It provides shared contracts, an in-memory API auth service, bearer session routes, and app shell session entry points. The service returns `devCode` for local development so tests and demos can complete without real SMS or email providers.

Production-ready auth follow-up work should replace the in-memory service with persistent storage, add real SMS/email delivery, disable `devCode`, add refresh-token rotation, and introduce device/session management.

## First Implementation Slice

This skeleton proves that the repository can host all planned product surfaces, share contracts safely, and run tests per package. Business features should be added in thin vertical slices: authentication, model catalog, text generation, image generation, video task submission, assets, credits, and orders.
```

- [ ] **Step 2: Update README with auth endpoints**

Replace `README.md` with:

```md
# GW-LINK OmniAI

GW-LINK OmniAI is a multi-platform AI creation product for text chat, image generation, and video generation.

## Repository Layout

- `apps/api` - product API and GW-LINK AI gateway adapter boundary
- `apps/admin` - internal operations admin web app
- `apps/desktop` - Windows, macOS, and Linux desktop app shell
- `apps/mobile` - iOS and Android app shell
- `packages/shared` - shared product contracts and helpers
- `docs/architecture` - architecture notes
- `docs/superpowers/specs` - approved product specs
- `docs/superpowers/plans` - implementation plans

## First-Time Setup

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

## Development Commands

```bash
pnpm dev:api
pnpm dev:admin
pnpm dev:desktop
pnpm dev:mobile
```

## Auth Session API

Local development auth uses passwordless email or phone verification. The in-memory service returns a `devCode` in the start-login response so the verification flow can be completed without a real SMS or email provider.

```bash
curl -X POST http://localhost:8787/v1/auth/start-login \
  -H "content-type: application/json" \
  -d '{"destination":"creator@example.com"}'

curl -X POST http://localhost:8787/v1/auth/verify-login \
  -H "content-type: application/json" \
  -d '{"challengeId":"<challengeId>","code":"<devCode>"}'

curl http://localhost:8787/v1/auth/session \
  -H "authorization: Bearer <token>"
```

## Validation

```bash
node --test tests/workspace.test.mjs
pnpm --filter @gw-link-omniai/shared test
pnpm --filter @gw-link-omniai/api test
pnpm --filter @gw-link-omniai/admin test
pnpm --filter @gw-link-omniai/desktop test
pnpm --filter @gw-link-omniai/mobile test
pnpm typecheck
```
```

- [ ] **Step 3: Run full validation**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/mvp-skeleton.md README.md
git commit -m "docs: document auth session slice"
```

## Task 6: Completion Check

**Files:**
- Modify: no source files

- [ ] **Step 1: Inspect git status**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Inspect recent commit history**

Run:

```bash
git log --oneline -8
```

Expected: includes:

```text
docs: document auth session slice
feat: add app session entry points
feat: expose auth session routes
feat: add in-memory auth service
feat: add shared auth contracts
```

- [ ] **Step 3: Record next implementation slices**

After this plan is complete, create separate plans for:

1. Persistent auth storage and device/session management.
2. Real SMS/email verification provider integration.
3. Model catalog and GW-LINK gateway real adapter integration.
4. Credits and free-trial allowance enforcement.
5. Text chat generation flow behind authenticated sessions.

## Self-Review

- Spec coverage: This plan covers PRD login, account session, and multi-end session entry foundations. It intentionally leaves real SMS/email delivery, passwords, OAuth, persistent database storage, device management, and paid quotas to future vertical slices.
- Placeholder scan: The plan uses concrete file paths, complete code snippets, exact commands, expected results, and commit messages. It does not include unresolved placeholder markers.
- Type consistency: Shared auth types use `LoginChannel`, `UserProfile`, `AuthSession`, and `SessionResponse`; API services, routes, and client session models reference those exact names consistently.
