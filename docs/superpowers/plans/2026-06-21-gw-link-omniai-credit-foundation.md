# GW-LINK OmniAI Credit Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side per-user credit ledger: deduct credits when a generation succeeds, reject generations with insufficient balance (402), grant initial credits on signup, and expose `GET /v1/credits/balance`.

**Architecture:** An append-only `credit_transactions` table (balance = `SUM(amount)`, grants positive / deductions negative) behind a `CreditTransactionRepository` (in-memory + Drizzle, locked by the cross-backend contract test). A `CreditService` wraps it (`getBalance` / `grantInitial` / `deduct`). The generation service gains an optional `creditService`: it pre-checks balance against the model's `creditUnitCost` before calling the provider (throws `GenerationTaskError(402)`), and deducts after a `succeeded` provider result. The auth service grants initial credits on user creation via an injected granter hook. Backend-only; no `packages/shared` change (balance reuses `CreditAmount`).

**Tech Stack:** TypeScript (strict, ESM), Fastify 4, Drizzle ORM + postgres, `@electric-sql/pglite` (tests), Vitest, pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-21-gw-link-omniai-credit-foundation-design.md` (approved).

## Global Constraints (apply to every task)

1. **No `packages/shared` change.** Balance reuses the existing `CreditAmount { credits: number; unit: "credit" }`. `GET /v1/credits/balance` returns `{ balance: CreditAmount }`.
2. **Charge basis is server-authoritative:** `cost = modelReference.product.creditUnitCost` (text=1 / image=2 / video=3 from the catalog). Never trust client-sent `preset.creditEstimate`.
3. **Deduction timing:** pre-check `balance.credits >= cost` BEFORE the provider call → on failure throw `GenerationTaskError("Insufficient credits", 402)` (no provider call, no task persisted, no ledger write). Deduct `cost` only after `providerResult.status === "succeeded"` (after the task is inserted). `queued`/other statuses do NOT deduct.
4. **Ledger amounts are signed integers:** grant = `+initialCredits`, deduct = `-cost`. Balance = `SUM(amount)`.
5. **`credit_transactions.owner_user_id` FK → `users(id)` ON DELETE CASCADE** (unlike tasks/assets' SET NULL).
6. **Initial grant:** `initialCredits` default 100, from `GW_LINK_INITIAL_CREDITS`. Granted once, only when a NEW user is created. `initialCredits <= 0` → no grant row.
7. **Optional dependency / backward compatibility:** `GenerationServiceOptions.creditService` and `AuthServiceOptions.creditGranter` are OPTIONAL; when absent the service behaves exactly as today (existing unit tests inject neither and must stay green).
8. **Conventions:** services clone what they return; time/IDs come from injected `clock`/`idGenerator` (no inline `Date.now()`/random). Routes stay thin; the generation route already maps `GenerationTaskError` by `statusCode`, so the 402 needs no route change.
9. Each task ends green: `pnpm --filter @gw-link-omniai/api test` + `pnpm --filter @gw-link-omniai/api typecheck` before committing. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- `apps/api/src/db/schema.ts` — add `creditTransactions` table (Task 1).
- `apps/api/drizzle/0002_*.sql` + `meta/` — generated migration (Task 1).
- `apps/api/src/repositories/types.ts` — `CreditTransactionRecord` + `CreditTransactionRepository` (Task 1).
- `apps/api/src/repositories/memory.ts` / `drizzle.ts` — repository impls (Task 1).
- `apps/api/src/repositories/__tests__/repositoryContract.test.ts` — credit cases (Task 1).
- `apps/api/src/services/creditService.ts` (+ `__tests__/creditService.test.ts`) — the service (Task 2).
- `apps/api/src/config.ts` (+ `__tests__/config.test.ts`) — `initialCredits` (Task 3).
- `apps/api/src/routes/credits.ts` — balance route (Task 4).
- `apps/api/src/server.ts` — wire creditService + register route (Tasks 4–6).
- `apps/api/src/services/authService.ts` — granter hook + grant on create (Task 5).
- `apps/api/src/services/appServices.ts` — wire creditService into the composition root (Tasks 5–6).
- `apps/api/src/services/generationService.ts` — pre-check + deduct (Task 6).
- `apps/api/src/__tests__/server.test.ts`, `dbPersistence.test.ts`, `services/__tests__/appServices.test.ts` — updated as noted per task.
- `README.md`, `docs/architecture/mvp-skeleton.md` — docs (Task 7).

---

## Task 1: Credit ledger persistence (schema + migration + repository + contract test)

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/repositories/types.ts`
- Modify: `apps/api/src/repositories/memory.ts`
- Modify: `apps/api/src/repositories/drizzle.ts`
- Generate: `apps/api/drizzle/0002_*.sql` (+ `meta/_journal.json`, `meta/0002_snapshot.json`)
- Test: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CreditTransactionRecord {
    id: string;
    amount: number;       // signed
    reason: string;
    reference: string | null;
    createdAt: string;    // ISO
  }
  export interface CreditTransactionRepository {
    insert(record: CreditTransactionRecord, ownerUserId: string): Promise<void>;
    balance(ownerUserId: string): Promise<number>;
  }
  ```
  and `InMemoryCreditTransactionRepository`, `DrizzleCreditTransactionRepository`.

- [ ] **Step 1: Add the schema table** — in `apps/api/src/db/schema.ts`, after the `assets` table, add (`integer`, `index`, `text`, `timestamp` are already imported):
  ```ts
  export const creditTransactions = pgTable(
    "credit_transactions",
    {
      id: text("id").primaryKey(),
      ownerUserId: text("owner_user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      amount: integer("amount").notNull(),
      reason: text("reason").notNull(),
      reference: text("reference"),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull()
    },
    (table) => ({
      ownerIdx: index("credit_transactions_owner_idx").on(table.ownerUserId)
    })
  );
  ```

- [ ] **Step 2: Generate the migration**

  Run: `pnpm --filter @gw-link-omniai/api db:generate`
  Expected: drizzle-kit writes `apps/api/drizzle/0002_<name>.sql` (a `CREATE TABLE "credit_transactions" ...` with the FK + index), appends idx 2 to `apps/api/drizzle/meta/_journal.json`, and writes `meta/0002_snapshot.json`. Commit whatever it generates verbatim.

- [ ] **Step 3: Add the repository interface + record type** — in `apps/api/src/repositories/types.ts`, append:
  ```ts
  export interface CreditTransactionRecord {
    id: string;
    amount: number;
    reason: string;
    reference: string | null;
    createdAt: string;
  }

  export interface CreditTransactionRepository {
    insert(record: CreditTransactionRecord, ownerUserId: string): Promise<void>;
    balance(ownerUserId: string): Promise<number>;
  }
  ```

- [ ] **Step 4: Write the failing contract tests** — in `apps/api/src/repositories/__tests__/repositoryContract.test.ts`:
  - Add to the imports from `../memory`: `InMemoryCreditTransactionRepository`.
  - Add to the imports from `../types`: `CreditTransactionRepository`.
  - Add to the imports from `../drizzle`: `DrizzleCreditTransactionRepository`.
  - Add `credits: CreditTransactionRepository;` to the local `RepositoryBundle` interface (around line 28).
  - In `setupMemory`'s bundle add: `credits: new InMemoryCreditTransactionRepository()`.
  - In `setupPglite`'s bundle add: `credits: new DrizzleCreditTransactionRepository(db)`.
  - Add these test cases inside the `describe.each` block:
  ```ts
  it("starts a credit balance at zero", async () => {
    const { users, credits } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    expect(await credits.balance("owner-a")).toBe(0);
  });

  it("sums credit transactions into a balance scoped to the owner", async () => {
    const { users, credits } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));

    await credits.insert(
      { id: "tx-1", amount: 100, reason: "signup_grant", reference: null, createdAt: "2026-06-20T00:00:00.000Z" },
      "owner-a"
    );
    await credits.insert(
      { id: "tx-2", amount: -2, reason: "generation", reference: "task-1", createdAt: "2026-06-20T00:00:01.000Z" },
      "owner-a"
    );

    expect(await credits.balance("owner-a")).toBe(98);
    expect(await credits.balance("owner-b")).toBe(0);
  });
  ```

- [ ] **Step 5: Run the contract tests to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
  Expected: FAIL (the `InMemory*`/`Drizzle*` credit repos don't exist yet).

- [ ] **Step 6: Implement the in-memory repository** — in `apps/api/src/repositories/memory.ts`:
  - Add `CreditTransactionRecord`, `CreditTransactionRepository` to the import from `./types`.
  - Append:
  ```ts
  export class InMemoryCreditTransactionRepository implements CreditTransactionRepository {
    private readonly rows: Array<{ ownerUserId: string; record: CreditTransactionRecord }> = [];

    async insert(record: CreditTransactionRecord, ownerUserId: string): Promise<void> {
      this.rows.push({ ownerUserId, record: structuredClone(record) });
    }

    async balance(ownerUserId: string): Promise<number> {
      return this.rows
        .filter((row) => row.ownerUserId === ownerUserId)
        .reduce((sum, row) => sum + row.record.amount, 0);
    }
  }
  ```

- [ ] **Step 7: Implement the Drizzle repository** — in `apps/api/src/repositories/drizzle.ts`:
  - Add `creditTransactions` to the import from `../db/schema`.
  - Add `CreditTransactionRecord`, `CreditTransactionRepository` to the import from `./types`.
  - Append:
  ```ts
  export class DrizzleCreditTransactionRepository implements CreditTransactionRepository {
    constructor(private readonly db: AppDatabase) {}

    async insert(record: CreditTransactionRecord, ownerUserId: string): Promise<void> {
      await this.db.insert(creditTransactions).values({
        id: record.id,
        ownerUserId,
        amount: record.amount,
        reason: record.reason,
        reference: record.reference,
        createdAt: new Date(record.createdAt)
      });
    }

    async balance(ownerUserId: string): Promise<number> {
      const rows = await this.db
        .select({ amount: creditTransactions.amount })
        .from(creditTransactions)
        .where(eq(creditTransactions.ownerUserId, ownerUserId));
      return rows.reduce((sum, row) => sum + row.amount, 0);
    }
  }
  ```

- [ ] **Step 8: Run the contract tests to verify they pass**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/repositories/__tests__/repositoryContract.test.ts`
  Expected: PASS for both `memory` and `pglite` backends (pglite proves the migration applies).

- [ ] **Step 9: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/src/repositories
  git commit -m "feat(api): add credit_transactions ledger repository

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: CreditService

**Files:**
- Create: `apps/api/src/services/creditService.ts`
- Test: `apps/api/src/services/__tests__/creditService.test.ts`

**Interfaces:**
- Consumes: `CreditTransactionRepository`, `CreditTransactionRecord` (Task 1); `InMemoryCreditTransactionRepository` (Task 1).
- Produces:
  ```ts
  export const DEFAULT_INITIAL_CREDITS = 100;
  export interface CreditService {
    getBalance(userId: string): Promise<CreditAmount>;
    grantInitial(userId: string): Promise<void>;
    deduct(userId: string, amount: number, reference: string): Promise<void>;
  }
  export class CreditServiceImpl implements CreditService { /* ... */ }
  export class InMemoryCreditService extends CreditServiceImpl { /* ... */ }
  export interface CreditServiceOptions {
    initialCredits?: number;
    idGenerator?: () => string;
    clock?: { now(): Date };
  }
  ```

- [ ] **Step 1: Write the failing test** — create `apps/api/src/services/__tests__/creditService.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { InMemoryCreditService } from "../creditService";

  function createService(initialCredits = 100) {
    let counter = 0;
    return new InMemoryCreditService({
      initialCredits,
      idGenerator: () => `credit_transaction_${(counter += 1)}`,
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") }
    });
  }

  describe("InMemoryCreditService", () => {
    it("starts at a zero balance", async () => {
      expect(await createService().getBalance("user-a")).toEqual({ credits: 0, unit: "credit" });
    });

    it("grants the initial credits once", async () => {
      const service = createService(100);
      await service.grantInitial("user-a");
      expect(await service.getBalance("user-a")).toEqual({ credits: 100, unit: "credit" });
    });

    it("deducts from the balance", async () => {
      const service = createService(100);
      await service.grantInitial("user-a");
      await service.deduct("user-a", 2, "generation_task_1");
      expect((await service.getBalance("user-a")).credits).toBe(98);
    });

    it("scopes balances to each user", async () => {
      const service = createService(100);
      await service.grantInitial("user-a");
      expect((await service.getBalance("user-b")).credits).toBe(0);
    });

    it("skips the grant when initial credits is zero", async () => {
      const service = createService(0);
      await service.grantInitial("user-a");
      expect((await service.getBalance("user-a")).credits).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/creditService.test.ts`
  Expected: FAIL (`creditService` module does not exist).

- [ ] **Step 3: Implement the service** — create `apps/api/src/services/creditService.ts`:
  ```ts
  import { randomUUID } from "node:crypto";
  import type { CreditAmount } from "@gw-link-omniai/shared";
  import type { CreditTransactionRepository } from "../repositories/types";
  import { InMemoryCreditTransactionRepository } from "../repositories/memory";

  export const DEFAULT_INITIAL_CREDITS = 100;

  export interface CreditServiceClock {
    now(): Date;
  }

  export interface CreditServiceOptions {
    initialCredits?: number;
    idGenerator?: () => string;
    clock?: CreditServiceClock;
  }

  export interface CreditService {
    getBalance(userId: string): Promise<CreditAmount>;
    grantInitial(userId: string): Promise<void>;
    deduct(userId: string, amount: number, reference: string): Promise<void>;
  }

  export class CreditServiceImpl implements CreditService {
    private readonly initialCredits: number;
    private readonly idGenerator: () => string;
    private readonly clock: CreditServiceClock;
    private readonly transactions: CreditTransactionRepository;

    constructor(transactionRepository: CreditTransactionRepository, options: CreditServiceOptions = {}) {
      this.transactions = transactionRepository;
      this.initialCredits = options.initialCredits ?? DEFAULT_INITIAL_CREDITS;
      this.idGenerator = options.idGenerator ?? (() => `credit_transaction_${randomUUID()}`);
      this.clock = options.clock ?? { now: () => new Date() };
    }

    async getBalance(userId: string): Promise<CreditAmount> {
      return { credits: await this.transactions.balance(userId), unit: "credit" };
    }

    async grantInitial(userId: string): Promise<void> {
      if (this.initialCredits <= 0) {
        return;
      }
      await this.transactions.insert(
        {
          id: this.idGenerator(),
          amount: this.initialCredits,
          reason: "signup_grant",
          reference: null,
          createdAt: this.clock.now().toISOString()
        },
        userId
      );
    }

    async deduct(userId: string, amount: number, reference: string): Promise<void> {
      await this.transactions.insert(
        {
          id: this.idGenerator(),
          amount: -amount,
          reason: "generation",
          reference,
          createdAt: this.clock.now().toISOString()
        },
        userId
      );
    }
  }

  export class InMemoryCreditService extends CreditServiceImpl {
    constructor(options: CreditServiceOptions = {}) {
      super(new InMemoryCreditTransactionRepository(), options);
    }
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/creditService.test.ts`
  Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/services/creditService.ts apps/api/src/services/__tests__/creditService.test.ts
  git commit -m "feat(api): add CreditService over the ledger repository

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: Config `initialCredits`

**Files:**
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/__tests__/config.test.ts`
- Modify (keep typecheck green): `apps/api/src/__tests__/server.test.ts`, `apps/api/src/__tests__/dbPersistence.test.ts`, `apps/api/src/services/__tests__/appServices.test.ts`

**Interfaces:**
- Produces: `ApiConfig.initialCredits: number` (required), set by `loadConfig` from `GW_LINK_INITIAL_CREDITS` (default 100).

- [ ] **Step 1: Write the failing tests** — in `apps/api/src/__tests__/config.test.ts`:
  - Update the two exact-match (`toEqual`) tests to include the new field:
    - In "returns default API configuration", add `initialCredits: 100,` to the expected object.
    - In "returns supplied API configuration", add `GW_LINK_INITIAL_CREDITS: "250"` to the input env and `initialCredits: 250,` to the expected object.
  - Add new tests:
  ```ts
  it("defaults initial credits to 100", () => {
    expect(loadConfig({}).initialCredits).toBe(100);
  });

  it("parses a custom initial credit grant", () => {
    expect(loadConfig({ GW_LINK_INITIAL_CREDITS: "20" }).initialCredits).toBe(20);
  });

  it("allows a zero initial credit grant", () => {
    expect(loadConfig({ GW_LINK_INITIAL_CREDITS: "0" }).initialCredits).toBe(0);
  });

  it("rejects negative or non-integer initial credit values", () => {
    expect(() => loadConfig({ GW_LINK_INITIAL_CREDITS: "-5" })).toThrow(
      "GW_LINK_INITIAL_CREDITS must be a non-negative integer"
    );
    expect(() => loadConfig({ GW_LINK_INITIAL_CREDITS: "1.5" })).toThrow(
      "GW_LINK_INITIAL_CREDITS must be a non-negative integer"
    );
  });
  ```

- [ ] **Step 2: Run config tests to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/config.test.ts`
  Expected: FAIL (`initialCredits` not on the config object / parser missing).

- [ ] **Step 3: Implement the config field** — in `apps/api/src/config.ts`:
  - Add `initialCredits: number;` to the `ApiConfig` interface.
  - Add the parser:
  ```ts
  function parseInitialCredits(value: string | undefined): number {
    if (value === undefined) {
      return 100;
    }

    const credits = Number(value);

    if (!Number.isInteger(credits) || credits < 0) {
      throw new Error("GW_LINK_INITIAL_CREDITS must be a non-negative integer");
    }

    return credits;
  }
  ```
  - In `loadConfig`'s returned object, add: `initialCredits: parseInitialCredits(env.GW_LINK_INITIAL_CREDITS),`.

- [ ] **Step 4: Keep the other `ApiConfig` literals compiling** — add `initialCredits: 100,` to each of these object literals (they construct an `ApiConfig` directly):
  - `apps/api/src/services/__tests__/appServices.test.ts` — the `baseConfig()` return object.
  - `apps/api/src/__tests__/dbPersistence.test.ts` — the `smokeConfig()` return object.
  - `apps/api/src/__tests__/server.test.ts` — BOTH inline `config: { ... }` objects (the "includes auth dev codes …" and "omits auth dev codes …" tests).

- [ ] **Step 5: Run config tests + full api suite to verify green**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/config.test.ts` then `pnpm --filter @gw-link-omniai/api test`
  Expected: PASS (config tests pass; no other suite broke from the added field).

- [ ] **Step 6: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/config.ts apps/api/src/__tests__/config.test.ts apps/api/src/__tests__/server.test.ts apps/api/src/__tests__/dbPersistence.test.ts apps/api/src/services/__tests__/appServices.test.ts
  git commit -m "feat(api): add GW_LINK_INITIAL_CREDITS config (default 100)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Credit balance route

**Files:**
- Create: `apps/api/src/routes/credits.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `CreditService`, `InMemoryCreditService` (Task 2); `createAuthGuard` (existing).
- Produces: `registerCreditRoutes(server, creditService, authService)` → `GET /v1/credits/balance` returning `{ balance: CreditAmount }`.

> Note: at this task the auth service does NOT yet grant credits (Task 5), so a freshly-signed-up user has balance 0. The balance test below asserts 0; **Task 5 updates it to 100** once the signup grant is wired.

- [ ] **Step 1: Write the failing tests** — in `apps/api/src/__tests__/server.test.ts`, add two tests inside the `describe("product API", ...)` block (the file already has the `authenticate(server)` helper):
  ```ts
  it("returns the authenticated user's credit balance", async () => {
    const server = buildServer();
    const token = await authenticate(server);
    const response = await server.inject({
      method: "GET",
      url: "/v1/credits/balance",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ balance: { credits: 0, unit: "credit" } });
  });

  it("rejects unauthenticated credit balance requests", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/v1/credits/balance" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  });
  ```

- [ ] **Step 2: Run to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/server.test.ts -t "credit balance"`
  Expected: FAIL (route 404 → not `{ balance }`; and the 401 path 404s).

- [ ] **Step 3: Create the route** — create `apps/api/src/routes/credits.ts`:
  ```ts
  import type { FastifyInstance } from "fastify";
  import type { CreditService } from "../services/creditService";
  import type { AuthService } from "../services/authService";
  import { createAuthGuard } from "./authGuard";

  export function registerCreditRoutes(
    server: FastifyInstance,
    creditService: CreditService,
    authService: AuthService
  ): void {
    const preHandler = createAuthGuard(authService);

    server.get("/v1/credits/balance", { preHandler }, async (request) => ({
      balance: await creditService.getBalance(request.userId!)
    }));
  }
  ```

- [ ] **Step 4: Wire it in `buildServer`** — in `apps/api/src/server.ts`:
  - Add imports:
    ```ts
    import { registerCreditRoutes } from "./routes/credits";
    import { InMemoryCreditService, type CreditService } from "./services/creditService";
    ```
  - Add `creditService?: CreditService;` to `BuildServerOptions`.
  - Construct the default config-free (so it never triggers `loadConfig`) and place this line **immediately before the `const authService = ...` line** — Task 5 wires this same instance into the default auth service, so it must be declared first:
    ```ts
    const creditService = options.creditService ?? new InMemoryCreditService();
    ```
  - Register the route alongside the others:
    ```ts
    registerCreditRoutes(server, creditService, authService);
    ```

- [ ] **Step 5: Run to verify they pass**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/server.test.ts`
  Expected: PASS (balance returns `{ credits: 0, unit: "credit" }`; unauth → 401). The "does not load environment config when an auth service is injected" test still passes because the default `creditService` does not read config.

- [ ] **Step 6: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/routes/credits.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
  git commit -m "feat(api): add GET /v1/credits/balance route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: Initial credit grant on signup

**Files:**
- Modify: `apps/api/src/services/authService.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/services/appServices.ts`
- Test: `apps/api/src/services/__tests__/authService.test.ts`, `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `CreditService` (Task 2).
- Produces: `AuthServiceOptions.creditGranter?: { grantInitial(userId: string): Promise<void> | void }`; `AppServices.creditService: CreditService`; `createDbServices(...)` now requires `initialCredits` in its options and returns `creditService`.

- [ ] **Step 1: Write the failing auth-service test** — in `apps/api/src/services/__tests__/authService.test.ts`, add a test that a brand-new user triggers the granter exactly once and an existing user does not. Use the existing test helpers/patterns in that file to drive a full start→verify login twice for the same destination; assert a captured `grantInitial` spy was called once with the created user id. Concretely add:
  ```ts
  it("grants initial credits only when a new user is created", async () => {
    const granted: string[] = [];
    const service = new InMemoryAuthService({
      devCodesEnabled: true,
      creditGranter: { grantInitial: async (userId: string) => { granted.push(userId); } }
    });

    const first = await service.startLogin({ destination: "grantee@example.com" });
    const firstSession = await service.verifyLogin({ challengeId: first.challengeId, code: first.devCode! });
    const second = await service.startLogin({ destination: "grantee@example.com" });
    await service.verifyLogin({ challengeId: second.challengeId, code: second.devCode! });

    expect(granted).toEqual([firstSession.user.id]);
  });
  ```
  (Match the file's existing import of `InMemoryAuthService`; if the file constructs the service differently, follow that local pattern but keep the assertion.)

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/authService.test.ts -t "grants initial credits"`
  Expected: FAIL (`creditGranter` option is ignored; `granted` is empty).

- [ ] **Step 3: Implement the granter hook** — in `apps/api/src/services/authService.ts`:
  - Add an interface and option:
    ```ts
    export interface CreditGranter {
      grantInitial(userId: string): Promise<void> | void;
    }
    ```
    Add `creditGranter?: CreditGranter;` to `AuthServiceOptions`.
  - Add a private field `private readonly creditGranter?: CreditGranter;` and in the constructor `this.creditGranter = options.creditGranter;`.
  - In `findOrCreateUser`, after `await this.users.insert(user);` and before `return user;`, add:
    ```ts
    if (this.creditGranter) {
      await this.creditGranter.grantInitial(user.id);
    }
    ```
  - `InMemoryAuthService` already forwards `options` to `super(...)`, so `creditGranter` flows through unchanged.

- [ ] **Step 4: Run the auth-service test to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/authService.test.ts`
  Expected: PASS (granter called once for the new user, not for the returning user).

- [ ] **Step 5: Wire the shared creditService into the composition root** — in `apps/api/src/services/appServices.ts`:
  - Add imports:
    ```ts
    import { CreditServiceImpl, InMemoryCreditService, type CreditService } from "./creditService";
    import { DrizzleCreditTransactionRepository } from "../repositories/drizzle";
    ```
  - Add `creditService: CreditService;` to the `AppServices` interface.
  - Change `createDbServices` to accept `initialCredits` and build + wire + return the creditService:
    ```ts
    export function createDbServices(
      db: AppDatabase,
      modelCatalog: ModelCatalog,
      options: { authDevCodesEnabled: boolean; initialCredits: number; providerAdapter?: ProviderAdapter }
    ): {
      authService: AuthService;
      generationService: GenerationService;
      assetService: AssetService;
      creditService: CreditService;
    } {
      const creditService = new CreditServiceImpl(new DrizzleCreditTransactionRepository(db), {
        initialCredits: options.initialCredits,
        idGenerator: () => `credit_transaction_${randomUUID()}`
      });

      const authService = new AuthServiceImpl(
        {
          users: new DrizzleUserRepository(db),
          sessions: new DrizzleSessionRepository(db),
          challenges: new DrizzleChallengeRepository(db)
        },
        { devCodesEnabled: options.authDevCodesEnabled, creditGranter: creditService }
      );

      const generationService = new GenerationServiceImpl(new DrizzleGenerationTaskRepository(db), {
        modelCatalog,
        idGenerator: () => `generation_task_${randomUUID()}`,
        providerAdapter: options.providerAdapter ?? new OpenAiCompatibleTextProvider()
      });

      const assetService = new AssetServiceImpl(new DrizzleAssetRepository(db), {
        idGenerator: () => `creation_asset_${randomUUID()}`
      });

      return { authService, generationService, assetService, creditService };
    }
    ```
    (The generationService's `creditService` wiring is added in Task 6; here it stays as today.)
  - In `createServices`, the in-memory branch:
    ```ts
    if (!config.databaseUrl) {
      const creditService = new InMemoryCreditService({ initialCredits: config.initialCredits });
      return {
        authService: new InMemoryAuthService({
          devCodesEnabled: config.authDevCodesEnabled,
          creditGranter: creditService
        }),
        generationService: new InMemoryGenerationService({
          modelCatalog,
          providerAdapter: new OpenAiCompatibleTextProvider()
        }),
        assetService: new InMemoryAssetService(),
        creditService,
        modelCatalog,
        async verifyConnectivity() {},
        async closeDb() {}
      };
    }
    ```
  - In `createServices`, the DB branch — pass `initialCredits` and surface `creditService`:
    ```ts
    const services = createDbServices(client.db, modelCatalog, {
      authDevCodesEnabled: config.authDevCodesEnabled,
      initialCredits: config.initialCredits
    });

    return {
      ...services,
      modelCatalog,
      verifyConnectivity: () => client.verifyConnectivity(),
      closeDb: () => client.close()
    };
    ```
    (`services` already includes `creditService`, so the spread carries it.)

- [ ] **Step 6: Wire the granter into `buildServer`'s default auth service + pass creditService through in production** — in `apps/api/src/server.ts`:
  - Change the default auth-service construction to share the `creditService` already created in Task 4:
    ```ts
    const authService =
      options.authService ??
      new InMemoryAuthService({
        devCodesEnabled: getConfig().authDevCodesEnabled,
        creditGranter: creditService
      });
    ```
  - In the production entry block (`if (import.meta.url === ...)`), pass the credit service so the route shares the granted ledger:
    ```ts
    const server = buildServer({
      config,
      modelCatalog: services.modelCatalog,
      authService: services.authService,
      generationService: services.generationService,
      assetService: services.assetService,
      creditService: services.creditService
    });
    ```

- [ ] **Step 7: Update the Task-4 balance test for the new grant** — in `apps/api/src/__tests__/server.test.ts`, the "returns the authenticated user's credit balance" test now sees the signup grant. Change its expectation from `credits: 0` to `credits: 100`:
  ```ts
  expect(response.json()).toEqual({ balance: { credits: 100, unit: "credit" } });
  ```
  (Update the `createDbServices(...)` call in `dbPersistence.test.ts`'s `buildServerForDb` to pass `initialCredits: 100` in its options bag so it compiles and the DB-backed users are funded.)

- [ ] **Step 8: Run the api suite to verify green**

  Run: `pnpm --filter @gw-link-omniai/api test`
  Expected: PASS. The balance e2e now shows 100; generation e2e tests still pass (generation does not yet check credits — Task 6 — and the user now has a 100-credit grant); `appServices.test` still passes (the added `creditService` field doesn't break its instance assertions).

- [ ] **Step 9: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/services/authService.ts apps/api/src/server.ts apps/api/src/services/appServices.ts apps/api/src/services/__tests__/authService.test.ts apps/api/src/__tests__/server.test.ts apps/api/src/__tests__/dbPersistence.test.ts
  git commit -m "feat(api): grant initial credits on user creation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 6: Generation balance pre-check + deduction

**Files:**
- Modify: `apps/api/src/services/generationService.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/services/appServices.ts`
- Test: `apps/api/src/services/__tests__/generationService.test.ts`

**Interfaces:**
- Consumes: `CreditService` (Task 2).
- Produces: `GenerationServiceOptions.creditService?: CreditService`; pre-check throws `GenerationTaskError("Insufficient credits", 402)`; deduct `modelReference.product.creditUnitCost` after a `succeeded` result.

- [ ] **Step 1: Write the failing tests** — in `apps/api/src/services/__tests__/generationService.test.ts`, add a small in-test credit stub and three tests. Add near the top (after imports):
  Add `CreditService` import and extend the existing `@gw-link-omniai/shared` import to also include `CreationMode` (the file already imports `GenerationTaskRequest` from it — add `CreationMode` to that line, don't add a second import from the same module):
  ```ts
  import type { CreditService } from "../creditService";

  class StubCreditService implements CreditService {
    public readonly deductions: Array<{ userId: string; amount: number; reference: string }> = [];
    constructor(private creditsByUser: Record<string, number> = {}) {}
    async getBalance(userId: string) {
      return { credits: this.creditsByUser[userId] ?? 0, unit: "credit" as const };
    }
    async grantInitial() {}
    async deduct(userId: string, amount: number, reference: string) {
      this.deductions.push({ userId, amount, reference });
      this.creditsByUser[userId] = (this.creditsByUser[userId] ?? 0) - amount;
    }
  }

  function createTextRequest(modelId = "gw-text-balanced") {
    return {
      mode: "text" as CreationMode,
      prompt: "帮我写一个新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: {
        modelId,
        parameters: { outputFormat: "markdown", tone: "clear" },
        creditEstimate: { credits: 1, unit: "credit" as const }
      }
    };
  }
  ```
  Then add the tests:
  ```ts
  it("rejects generation when the balance is below the model cost", async () => {
    const credit = new StubCreditService({ "user-a": 0 });
    const providerAdapter = new FakeProviderAdapter();
    let submitted = false;
    const spyAdapter: ProviderAdapter = {
      async submitGeneration(req) {
        submitted = true;
        return providerAdapter.submitGeneration(req);
      }
    };
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter: spyAdapter,
      creditService: credit
    });

    await expect(service.createTask(createImageRequest(), "user-a")).rejects.toMatchObject({
      message: "Insufficient credits",
      statusCode: 402
    });
    expect(submitted).toBe(false);
    expect(await service.listTasks("user-a")).toEqual([]);
    expect(credit.deductions).toEqual([]);
  });

  it("deducts the model credit cost after a succeeded generation", async () => {
    const credit = new StubCreditService({ "user-a": 100 });
    const providerAdapter: ProviderAdapter = {
      async submitGeneration() {
        return {
          status: "succeeded",
          providerId: "openai-main",
          providerProtocol: "openai-compatible",
          providerModelId: "gpt-4.1-mini",
          submittedAt: "2026-06-20T00:00:00.000Z",
          result: { kind: "text", text: "生成的文案", format: "markdown" }
        };
      }
    };
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter,
      creditService: credit
    });

    const task = await service.createTask(createTextRequest(), "user-a");

    expect(task.status).toBe("succeeded");
    expect(credit.deductions).toEqual([{ userId: "user-a", amount: 1, reference: "generation_task_000001" }]);
    expect((await credit.getBalance("user-a")).credits).toBe(99);
  });

  it("does not deduct when the provider keeps the task queued", async () => {
    const credit = new StubCreditService({ "user-a": 100 });
    const service = new InMemoryGenerationService({
      clock: { now: () => fixedNow },
      idGenerator: () => "generation_task_000001",
      modelCatalog: new ConfigModelCatalog(createModelConfig()),
      providerAdapter: new FakeProviderAdapter(),
      creditService: credit
    });

    const task = await service.createTask(createImageRequest(), "user-a");

    expect(task.status).toBe("queued");
    expect(credit.deductions).toEqual([]);
    expect((await credit.getBalance("user-a")).credits).toBe(100);
  });
  ```

- [ ] **Step 2: Run to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/generationService.test.ts -t "credit"`
  Expected: FAIL — without the pre-check the 402 test would create a task / call the provider; without deduction the succeeded test's `credit.deductions` is empty.

- [ ] **Step 3: Implement the pre-check + deduction** — in `apps/api/src/services/generationService.ts`:
  - Add `import type { CreditService } from "./creditService";`.
  - Add `creditService?: CreditService;` to `GenerationServiceOptions`.
  - Add a private field `private readonly creditService?: CreditService;` and in the constructor `this.creditService = options.creditService;`.
  - After the maintenance check (`if (modelReference.product.visibility === "maintenance") { ... }`) and BEFORE the provider call, add:
    ```ts
    const creditCost = modelReference.product.creditUnitCost;
    if (this.creditService) {
      const balance = await this.creditService.getBalance(userId);
      if (balance.credits < creditCost) {
        throw new GenerationTaskError("Insufficient credits", 402);
      }
    }
    ```
  - After `await this.tasks.insert(task, userId);` and before `return cloneGenerationTask(task);`, add:
    ```ts
    if (this.creditService && providerResult.status === "succeeded") {
      await this.creditService.deduct(userId, creditCost, task.id);
    }
    ```

- [ ] **Step 4: Wire the shared creditService into the generation services** — pass `creditService` where the generation service is constructed in the composition root:
  - In `apps/api/src/services/appServices.ts` `createDbServices`, add `creditService` to the `GenerationServiceImpl` options:
    ```ts
    const generationService = new GenerationServiceImpl(new DrizzleGenerationTaskRepository(db), {
      modelCatalog,
      idGenerator: () => `generation_task_${randomUUID()}`,
      providerAdapter: options.providerAdapter ?? new OpenAiCompatibleTextProvider(),
      creditService
    });
    ```
  - In `apps/api/src/services/appServices.ts` `createServices` in-memory branch, add `creditService` to the `InMemoryGenerationService` options:
    ```ts
    generationService: new InMemoryGenerationService({
      modelCatalog,
      providerAdapter: new OpenAiCompatibleTextProvider(),
      creditService
    }),
    ```
  - In `apps/api/src/server.ts`, add `creditService` to the default generation-service construction:
    ```ts
    const generationService =
      options.generationService ??
      new InMemoryGenerationService({
        modelCatalog: getModelCatalog(),
        providerAdapter,
        creditService
      });
    ```

- [ ] **Step 5: Run the api suite to verify green**

  Run: `pnpm --filter @gw-link-omniai/api test`
  Expected: PASS. New credit tests pass; the existing generationService tests (which inject NO `creditService`) are unaffected; the e2e generation tests in `server.test.ts`/`dbPersistence.test.ts` pass because the signup grant (Task 5) funds the user above the cost.

- [ ] **Step 6: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/services/generationService.ts apps/api/src/server.ts apps/api/src/services/appServices.ts apps/api/src/services/__tests__/generationService.test.ts
  git commit -m "feat(api): pre-check and deduct credits on generation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 7: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`
- Modify: `.env.example`

- [ ] **Step 1: Document the env var** — in `.env.example`, add (near the other `GW_LINK_*` entries):
  ```bash
  # Initial credit grant for newly created users (default 100). Balance is a
  # server-side ledger; generations deduct the model's creditUnitCost on success.
  # GW_LINK_INITIAL_CREDITS=100
  ```

- [ ] **Step 2: Update `README.md`** — add a section after the "Real Text Generation" section:
  ```markdown
  ### Credit Foundation

  The ninth product-first slice adds a server-side credit ledger.

  - New users receive an initial credit grant (`GW_LINK_INITIAL_CREDITS`, default
    100) recorded in an append-only `credit_transactions` ledger; balance is the
    sum of transactions.
  - `POST /v1/generations` pre-checks the balance against the model's
    `creditUnitCost` (text=1 / image=2 / video=3) and returns `402` without calling
    the provider or persisting a task when the balance is insufficient. A
    `succeeded` generation deducts the cost; a `queued` one does not.
  - `GET /v1/credits/balance` returns the authenticated user's balance
    (`{ balance: { credits, unit } }`).
  - Concurrent deduction is not yet atomic, and the desktop balance display / 402
    handling are later slices.
  ```

- [ ] **Step 3: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
  ## Credit Foundation Slice

  A server-side credit ledger (`credit_transactions`, append-only, balance =
  `SUM(amount)`) backs billing. A `CreditService` (`getBalance` / `grantInitial` /
  `deduct`) wraps a `CreditTransactionRepository` (in-memory + Drizzle, locked by
  the cross-backend contract test). The auth service grants `initialCredits`
  (config `GW_LINK_INITIAL_CREDITS`, default 100) once on user creation via an
  injected granter. The generation service pre-checks balance against the model's
  `creditUnitCost` before calling the provider (`402` on insufficient funds, no
  task persisted) and deducts the cost after a `succeeded` result; `queued`
  generations are not charged. `GET /v1/credits/balance` exposes the balance.
  Charge basis is the server-side `creditUnitCost` (client `creditEstimate` is not
  trusted). Atomic concurrent deduction, real payment/top-up, and desktop balance
  UI / 402 handling remain later slices.
  ```

- [ ] **Step 4: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 5: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md .env.example
  git commit -m "docs: document the credit foundation slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] No edits under `packages/shared/`.
- [ ] `GET /v1/credits/balance` returns the granted balance after signup; unauth → 401.
- [ ] Insufficient balance → 402 with no task persisted and no provider call (verified by `generationService.test.ts`).
- [ ] `succeeded` deducts `creditUnitCost`; `queued` does not.
- [ ] pglite contract test green (migration `0002` applies).
- [ ] Manual check (optional): `GW_LINK_INITIAL_CREDITS=3 pnpm dev:api`; sign up, submit 3 text generations with a provider key (each succeeds + deducts 1), the 4th returns 402.
