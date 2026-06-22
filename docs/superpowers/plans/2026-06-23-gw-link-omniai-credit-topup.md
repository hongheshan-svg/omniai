# GW-LINK OmniAI Credit Top-up Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users top up credits via a dev-gated `POST /v1/credits/topup` (direct ledger credit, no real payment yet) and a desktop "充值" button.

**Architecture:** `CreditService.topUp` records a positive `topup` ledger entry. `POST /v1/credits/topup` (auth-guarded + gated by `GW_LINK_DEV_TOPUP_ENABLED`, default off in production) credits directly and returns the new balance. The route's gate flag is passed into `registerCreditRoutes` at build time from `config?.devTopupEnabled` (never triggering `loadConfig`). The desktop adds a fixed-amount "充值" button. Real payment channels later drive `topUp` via webhooks. No `packages/shared` change.

**Tech Stack:** TypeScript (strict, ESM), Fastify 4, React 18, Vitest, pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-23-gw-link-omniai-credit-topup-design.md` (approved).

## Global Constraints (apply to every task)

1. No `packages/shared` change — balance reuses `CreditAmount`.
2. `GW_LINK_DEV_TOPUP_ENABLED` defaults on outside production and off when `NODE_ENV=production` (same semantics as `GW_LINK_AUTH_DEV_CODES_ENABLED`).
3. `POST /v1/credits/topup`: gated off → `403 { error: "Top-up is disabled" }`; non-positive-integer `amount` → `400 { error: "Invalid top-up amount" }`; unauthenticated → `401`; success → credits the amount and returns `{ balance: CreditAmount }`.
4. `CreditService.topUp` records `{ amount: +amount, reason: "topup", reference: reference ?? null }` (positive ledger entry); top-up is never charged.
5. The route gate flag comes from `options.config?.devTopupEnabled ?? false` in `buildServer` — do NOT call `getConfig()` for it (keeps the "does not load env config when an auth service is injected" test green).
6. Each task ends green: `pnpm --filter @gw-link-omniai/<pkg> test` + `... typecheck` before committing. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- Modify: `apps/api/src/config.ts` (+ `__tests__/config.test.ts` + ApiConfig literal sites) (Task 1).
- Modify: `apps/api/src/services/creditService.ts` (+ `__tests__/creditService.test.ts`) (Task 2).
- Modify: `apps/api/src/routes/credits.ts`, `apps/api/src/server.ts` (+ `__tests__/server.test.ts`) (Task 3).
- Modify: `apps/desktop/src/apiClient.ts`, `App.tsx` (+ tests) (Task 4).
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md`, `.env.example` (Task 5).

---

## Task 1: Config `devTopupEnabled`

**Files:**
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/__tests__/config.test.ts`
- Modify (compile): `apps/api/src/__tests__/server.test.ts`, `apps/api/src/__tests__/dbPersistence.test.ts`, `apps/api/src/services/__tests__/appServices.test.ts`, `apps/api/src/routes/__tests__/assets.test.ts`, `apps/api/src/routes/__tests__/generations.test.ts`

**Interfaces:**
- Produces: `ApiConfig.devTopupEnabled: boolean`.

- [ ] **Step 1: Write the failing config tests** — in `apps/api/src/__tests__/config.test.ts`:
  - In "returns default API configuration" (`loadConfig({})`), add `devTopupEnabled: true` to the expected object (test env is not production → default on).
  - In "returns supplied API configuration", add `devTopupEnabled: true` to the expected object (no `NODE_ENV`, no override → default on).
  - Add:
    ```ts
    it("disables dev top-up by default in production", () => {
      expect(loadConfig({ NODE_ENV: "production" }).devTopupEnabled).toBe(false);
    });

    it("allows dev top-up to be explicitly enabled in production", () => {
      expect(loadConfig({ NODE_ENV: "production", GW_LINK_DEV_TOPUP_ENABLED: "true" }).devTopupEnabled).toBe(true);
    });

    it("rejects invalid dev top-up configuration values", () => {
      expect(() => loadConfig({ GW_LINK_DEV_TOPUP_ENABLED: "yes" })).toThrow(
        'GW_LINK_DEV_TOPUP_ENABLED must be "true" or "false"'
      );
    });
    ```

- [ ] **Step 2: Run config tests to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/config.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement the config field** — in `apps/api/src/config.ts`:
  - Add `devTopupEnabled: boolean;` to `ApiConfig`.
  - Add a parser (mirroring `parseAuthDevCodesEnabled`):
    ```ts
    function parseDevTopupEnabled(env: NodeJS.ProcessEnv): boolean {
      const value = env.GW_LINK_DEV_TOPUP_ENABLED;

      if (value === undefined) {
        return env.NODE_ENV === "production" ? false : true;
      }

      if (value === "true") {
        return true;
      }

      if (value === "false") {
        return false;
      }

      throw new Error('GW_LINK_DEV_TOPUP_ENABLED must be "true" or "false"');
    }
    ```
  - In `loadConfig`'s returned object, add: `devTopupEnabled: parseDevTopupEnabled(env),`.

- [ ] **Step 4: Keep other `ApiConfig` literals compiling** — add `devTopupEnabled: true,` to each object literal constructing an `ApiConfig` (all use `authDevCodesEnabled: true`):
  - `apps/api/src/services/__tests__/appServices.test.ts` — `baseConfig()` return.
  - `apps/api/src/__tests__/dbPersistence.test.ts` — `smokeConfig()` return.
  - `apps/api/src/__tests__/server.test.ts` — BOTH inline `config: { ... }` objects (in the "includes auth dev codes …" and "omits auth dev codes …" tests). Note: the "omits" test sets `authDevCodesEnabled: false`; still add `devTopupEnabled: true` (the test only asserts the devCode behavior, not top-up).
  - `apps/api/src/routes/__tests__/assets.test.ts` — `testConfig`.
  - `apps/api/src/routes/__tests__/generations.test.ts` — all THREE inline `config: { ... }` objects.

- [ ] **Step 5: Run config tests + full api suite**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/config.test.ts` then `pnpm --filter @gw-link-omniai/api test`
  Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/config.ts apps/api/src/__tests__/config.test.ts apps/api/src/__tests__/server.test.ts apps/api/src/__tests__/dbPersistence.test.ts apps/api/src/services/__tests__/appServices.test.ts apps/api/src/routes/__tests__/assets.test.ts apps/api/src/routes/__tests__/generations.test.ts
  git commit -m "feat(api): add GW_LINK_DEV_TOPUP_ENABLED config (default off in production)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: `CreditService.topUp`

**Files:**
- Modify: `apps/api/src/services/creditService.ts`
- Test: `apps/api/src/services/__tests__/creditService.test.ts`

**Interfaces:**
- Produces: `CreditService.topUp(userId: string, amount: number, reference?: string): Promise<void>`.

- [ ] **Step 1: Write the failing test** — in `apps/api/src/services/__tests__/creditService.test.ts`, add (the file has a `createService(initialCredits)` helper returning `InMemoryCreditService`):
  ```ts
  it("tops up the balance", async () => {
    const service = createService(100);
    await service.grantInitial("user-a");
    await service.topUp("user-a", 50);
    expect((await service.getBalance("user-a")).credits).toBe(150);
  });

  it("sums multiple top-ups and deductions", async () => {
    const service = createService(0);
    await service.topUp("user-a", 100);
    await service.topUp("user-a", 25);
    await service.deduct("user-a", 10, "task-1");
    expect((await service.getBalance("user-a")).credits).toBe(115);
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/creditService.test.ts -t "tops up"`
  Expected: FAIL (`topUp` not a function).

- [ ] **Step 3: Implement it** — in `apps/api/src/services/creditService.ts`:
  - Add to the `CreditService` interface (after `deduct`): `topUp(userId: string, amount: number, reference?: string): Promise<void>;`.
  - Add the method to `CreditServiceImpl` (after `deduct`):
    ```ts
    async topUp(userId: string, amount: number, reference?: string): Promise<void> {
      await this.transactions.insert(
        {
          id: this.idGenerator(),
          amount,
          reason: "topup",
          reference: reference ?? null,
          createdAt: this.clock.now().toISOString()
        },
        userId
      );
    }
    ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/creditService.test.ts`
  Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/services/creditService.ts apps/api/src/services/__tests__/creditService.test.ts
  git commit -m "feat(api): add CreditService.topUp

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: `POST /v1/credits/topup` route + wiring

**Files:**
- Modify: `apps/api/src/routes/credits.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `CreditService.topUp` (Task 2), `ApiConfig.devTopupEnabled` (Task 1).
- Produces: `registerCreditRoutes(server, creditService, authService, options: { devTopupEnabled: boolean })`.

- [ ] **Step 1: Write the failing route tests** — in `apps/api/src/__tests__/server.test.ts`, add a helper near the top of the `describe` (after the `authenticate` helper) and four tests:
  ```ts
  function topupConfig(devTopupEnabled: boolean): ApiConfig {
    return {
      port: 8787,
      gatewayBaseUrl: "https://gateway.gw-link.local",
      authDevCodesEnabled: true,
      modelConfigPath: "config/models.json",
      initialCredits: 100,
      publicBaseUrl: "http://localhost:8787",
      devTopupEnabled
    };
  }

  it("tops up credits when dev top-up is enabled", async () => {
    const server = buildServer({ config: topupConfig(true) });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/credits/topup",
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 50 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ balance: { credits: 150, unit: "credit" } });
  });

  it("rejects top-up when dev top-up is disabled", async () => {
    const server = buildServer({ config: topupConfig(false) });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/credits/topup",
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 50 }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Top-up is disabled" });
  });

  it("rejects a non-positive-integer top-up amount", async () => {
    const server = buildServer({ config: topupConfig(true) });
    const token = await authenticate(server);
    const response = await server.inject({
      method: "POST",
      url: "/v1/credits/topup",
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: -5 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid top-up amount" });
  });

  it("rejects unauthenticated top-up", async () => {
    const server = buildServer({ config: topupConfig(true) });
    const response = await server.inject({ method: "POST", url: "/v1/credits/topup", payload: { amount: 50 } });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });
  ```
  (`ApiConfig` is already imported in `server.test.ts`? If not, add `import type { ApiConfig } from "../config";`.)

- [ ] **Step 2: Run them to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/server.test.ts -t "top-up"`
  Expected: FAIL (route 404 / no gating).

- [ ] **Step 3: Add the route** — replace `apps/api/src/routes/credits.ts` with:
  ```ts
  import type { FastifyInstance } from "fastify";
  import type { CreditService } from "../services/creditService";
  import type { AuthService } from "../services/authService";
  import { createAuthGuard } from "./authGuard";

  export function registerCreditRoutes(
    server: FastifyInstance,
    creditService: CreditService,
    authService: AuthService,
    options: { devTopupEnabled: boolean }
  ): void {
    const preHandler = createAuthGuard(authService);

    server.get("/v1/credits/balance", { preHandler }, async (request) => ({
      balance: await creditService.getBalance(request.userId!)
    }));

    server.post("/v1/credits/topup", { preHandler }, async (request, reply) => {
      if (!options.devTopupEnabled) {
        return reply.status(403).send({ error: "Top-up is disabled" });
      }

      const amount = readAmount(request.body);
      if (amount === undefined) {
        return reply.status(400).send({ error: "Invalid top-up amount" });
      }

      await creditService.topUp(request.userId!, amount);
      return { balance: await creditService.getBalance(request.userId!) };
    });
  }

  function readAmount(body: unknown): number | undefined {
    if (typeof body !== "object" || body === null) {
      return undefined;
    }
    const amount = (body as { amount?: unknown }).amount;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      return undefined;
    }
    return amount;
  }
  ```
  (`reply` is auto-typed by the Fastify route handler — no `FastifyReply` import needed; `readAmount` rejects non-object bodies, non-numbers, non-integers, and `<= 0`.)

- [ ] **Step 4: Wire the gate flag in `buildServer`** — in `apps/api/src/server.ts`, change the `registerCreditRoutes` call to pass the flag:
  ```ts
  const devTopupEnabled = options.config?.devTopupEnabled ?? false;
  ...
  registerCreditRoutes(server, creditService, authService, { devTopupEnabled });
  ```
  (Add the `const devTopupEnabled = ...` line near the other service setup, before the route registrations; do NOT call `getConfig()` for it.)

- [ ] **Step 5: Run the api suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (the existing balance-route tests use `buildServer()` with no config → `devTopupEnabled` false, but they don't call top-up; the "does not load env config" test still passes — no `getConfig()` added).

- [ ] **Step 6: Commit**
  ```bash
  git add apps/api/src/routes/credits.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
  git commit -m "feat(api): add dev-gated POST /v1/credits/topup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Desktop top-up button

**Files:**
- Modify: `apps/desktop/src/apiClient.ts`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/apiClient.test.ts`, `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: `ApiClient.topUpCredits(amount: number, token: string): Promise<CreditAmount>`.

- [ ] **Step 1: Add `topUpCredits` to the client** — in `apps/desktop/src/apiClient.ts`:
  - Add to the `ApiClient` interface (after `getGeneration`): `topUpCredits(amount: number, token: string): Promise<CreditAmount>;`.
  - Add the implementation (after `getGeneration`):
    ```ts
    async topUpCredits(amount, token) {
      const { balance } = await send<{ balance: CreditAmount }>("/v1/credits/topup", {
        method: "POST",
        body: { amount },
        token
      });
      return balance;
    }
    ```

- [ ] **Step 2: Add the client test** — in `apps/desktop/src/__tests__/apiClient.test.ts`, add:
  ```ts
  it("posts a top-up with the bearer token and unwraps the balance", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balance: { credits: 150, unit: "credit" } }));
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const result = await client.topUpCredits(50, "tok-1");

    expect(result).toEqual({ credits: 150, unit: "credit" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/v1/credits/topup");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ amount: 50 });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });
  ```

- [ ] **Step 3: Wire the button in `App.tsx`:**
  - Add `handleTopUp` (after `handleRefreshTask`):
    ```ts
    async function handleTopUp() {
      if (!token) {
        return;
      }
      setActionError(undefined);
      try {
        setBalance(await api.topUpCredits(100, token));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleSignedOut("登录已失效，请重新登录");
          return;
        }
        setActionError(errorMessage(error));
      }
    }
    ```
  - In the signed-in `<header>`, after the balance `<p>`, add the button:
    ```tsx
    {balance ? (
      <button type="button" onClick={handleTopUp}>
        充值
      </button>
    ) : null}
    ```

- [ ] **Step 4: Update the fake client + add the App test** — in `apps/desktop/src/__tests__/App.test.tsx`:
  - Add `topUpCredits` to the `base` fake (after `getGeneration`), using the existing stateful `balance` variable:
    ```ts
    topUpCredits: async (amount: number) => {
      balance += amount;
      return { credits: balance, unit: "credit" as const };
    }
    ```
  - Add a test (after the balance tests):
    ```ts
    it("tops up the balance from the header", async () => {
      const client = createFakeClient();
      await signIn(client);
      await screen.findByText("积分：100");

      fireEvent.click(screen.getByRole("button", { name: "充值" }));

      expect(await screen.findByText("积分：200")).toBeTruthy();
    });
    ```

- [ ] **Step 5: Run the desktop suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`. Both green.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/desktop/src/apiClient.ts apps/desktop/src/App.tsx apps/desktop/src/__tests__/apiClient.test.ts apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): add a credit top-up button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`** — add after the `GW_LINK_AUTH_DEV_CODES_ENABLED` block:
  ```bash
  # Dev-only credit top-up endpoint (POST /v1/credits/topup grants credits
  # directly, no real payment). Defaults on outside production, off when
  # NODE_ENV=production. NEVER enable in production: it lets any authenticated
  # user mint free credits. Real payment will drive top-ups via webhooks.
  # GW_LINK_DEV_TOPUP_ENABLED=true
  ```

- [ ] **Step 2: Update `README.md`** — in the "Credit Foundation" section, add a bullet:
  ```markdown
  - Dev-only top-up: `POST /v1/credits/topup` (gated by `GW_LINK_DEV_TOPUP_ENABLED`,
    off in production) credits the account directly and returns the new balance;
    the desktop has a "充值" button. Real payment channels (driving `topUp` via
    webhooks) are a later slice.
  ```

- [ ] **Step 3: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
  ## Credit Top-up Foundation Slice

  `CreditService.topUp` records a positive `topup` ledger entry. `POST
  /v1/credits/topup` (auth-guarded, gated by `GW_LINK_DEV_TOPUP_ENABLED` — default
  off in production) credits the account directly and returns the new balance; the
  gate flag is passed into `registerCreditRoutes` from the injected config at build
  time (never triggering `loadConfig`). The desktop adds a fixed-amount "充值"
  button. This is a dev-only direct credit; real payment channels (Stripe / Alipay
  / WeChat) will drive `topUp` via webhooks, and a package catalog / custom amounts
  / minimumPlan enforcement remain later work.
  ```

- [ ] **Step 4: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 5: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md .env.example
  git commit -m "docs: document the credit top-up foundation slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] No `packages/shared` change.
- [ ] `POST /v1/credits/topup`: enabled → credits + new balance; disabled → 403; non-positive-integer → 400; unauthenticated → 401.
- [ ] `GW_LINK_DEV_TOPUP_ENABLED` defaults off in production; the "does not load env config when an auth service is injected" test still passes.
- [ ] Desktop "充值" button increases the displayed balance.
