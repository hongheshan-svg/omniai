# GW-LINK OmniAI Persistence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-process storage of the three core API services (auth, generation, asset) with a durable Postgres-backed persistence layer, accessed through Drizzle ORM behind a repository seam, so users, sessions, generation tasks, and assets survive a process restart — without changing product contracts, `/v1/*` routes, or HTTP behavior.

**Architecture:** Introduce a repository seam (`apps/api/src/repositories/*`) with two implementations per repository — in-memory (for fast unit tests and zero-config local dev) and Drizzle (for real Postgres). The three services keep their `interface`, business logic, validation, hashing, sweep, and defensive-copy semantics; only their storage access becomes an injected repository. A `createServices(config)` factory selects the implementation by the presence of `DATABASE_URL`. Tests use `@electric-sql/pglite` (in-process WASM Postgres) so the suite stays fast and Docker-free. This slice deliberately keeps the fake provider adapter, placeholder asset URLs, dev-code auth, and global (non-per-user) list semantics; it only changes the storage medium.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Fastify, Drizzle ORM, `postgres` (postgres.js) driver, drizzle-kit (migrations), `@electric-sql/pglite` (test Postgres), pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-21-gw-link-omniai-persistence-foundation-design.md` (approved).

---

## Scope Check

The publishable-v1 roadmap calls for real auth, billing, object storage, real provider calls, per-user isolation, and frontend HTTP integration. This plan implements only the **first** slice: durable storage behind the existing product contracts. It intentionally excludes:

- Real SMS/email delivery and production auth hardening (refresh tokens, login rate limiting). Dev-code behavior is unchanged.
- Supabase Auth and Supabase Storage. We use Supabase **Postgres only**.
- Object storage; image/video assets remain placeholder URLs.
- Real provider HTTP calls, streaming, async worker queues, task status transitions.
- Per-user access control, auth guard middleware, Postgres RLS. We add a nullable `owner_user_id` column for the future, but do not populate or filter on it. `listTasks`/`listAssets` still return everything (same as today).
- Credit mutation, orders, plan enforcement.
- Frontend (desktop/admin/mobile) HTTP integration.
- Any change to `packages/shared` contracts, `/v1/*` routes, or HTTP response shapes.

## Global Constraints (apply to every task)

1. **Contracts frozen:** Do not edit `packages/shared`. Do not change route paths, request shapes, or response shapes. The HTTP-level tests (`server.test.ts`, `routes/__tests__/auth.test.ts`) must pass **unchanged**.
2. **Service interfaces use union return types** so existing synchronous fakes in `server.test.ts` and `routes/__tests__/auth.test.ts` stay type-valid. Methods return `T | Promise<T>`; routes `await` them. Only the three in-memory service **unit** tests convert to async.
3. **Defensive copy preserved:** In-memory repositories clone at the storage boundary with `structuredClone` (Node 20 global). Drizzle reads produce fresh objects from rows, so no extra clone is needed there. The services keep their existing build-time clone helpers untouched.
4. **Injectable side effects preserved:** Time and IDs still come from options (`clock.now()`, `idGenerator`, `tokenGenerator`, `challengeIdGenerator`, `codeGenerator`). Never call `Date.now()`/random inline in new logic except inside the existing default generators.
5. **Product boundary intact:** No provider internals (`providerModelId`/`baseUrl`/`apiKeyEnv`) leak into product surfaces. No DB connection strings, SQL, or driver details leak to clients.
6. **TDD:** For each task, write/adjust the failing test first, then implement until green. Run the package test + typecheck before committing. Commit after each task.
7. **Backward-compatible constructors:** `InMemoryAuthService` / `InMemoryGenerationService` / `InMemoryAssetService` keep their exact existing constructor signatures (`(options = {})`), so `server.ts` and existing tests need no constructor changes.
8. **Verification commands** (run from repo root unless noted):
   - `pnpm --filter @gw-link-omniai/api test`
   - `pnpm --filter @gw-link-omniai/api typecheck`
   - Final: `pnpm test` and `pnpm typecheck`.

## File Structure

- Create: `apps/api/drizzle.config.ts` — drizzle-kit config (schema path, out dir, dialect).
- Create: `apps/api/src/db/schema.ts` — Drizzle table definitions for the 5 tables.
- Create: `apps/api/src/db/client.ts` — `createDbClient(url)` → `{ db, verifyConnectivity, close }`; exports `AppDatabase`.
- Create: `apps/api/src/db/migrate.ts` — `runMigrations(url)` + CLI guard for `db:migrate`.
- Create: `apps/api/src/db/__tests__/schema.test.ts` — pglite migration + jsonb/timestamptz round-trip test.
- Create: `apps/api/src/testSupport/pglite.ts` — `createPgliteDatabase()` test helper (migrate a fresh pglite).
- Create: `apps/api/drizzle/` — generated migration SQL + `meta/` (produced by `drizzle-kit generate`).
- Create: `apps/api/src/repositories/types.ts` — 5 repository interfaces + internal `SessionRecord`/`LoginChallengeRecord`.
- Create: `apps/api/src/repositories/memory.ts` — in-memory repository implementations.
- Create: `apps/api/src/repositories/drizzle.ts` — Drizzle repository implementations.
- Create: `apps/api/src/repositories/__tests__/repositoryContract.test.ts` — parametrized contract tests (memory + pglite).
- Create: `apps/api/src/services/appServices.ts` — `createServices(config)` + `createDbServices(db, catalog, opts)`.
- Create: `apps/api/src/services/__tests__/appServices.test.ts` — factory selection tests.
- Create: `apps/api/src/__tests__/dbPersistence.test.ts` — DB end-to-end "survives restart" smoke test.
- Create: `.env.example` — documents `DATABASE_URL` (and existing env vars).
- Modify: `apps/api/package.json` — add deps + `db:generate`/`db:migrate` scripts.
- Modify: `apps/api/src/config.ts` — add optional `databaseUrl`.
- Modify: `apps/api/src/__tests__/config.test.ts` — add `databaseUrl` cases.
- Modify: `apps/api/src/services/modelConfig.ts` — host `resolveConfigPath` (moved from `server.ts`).
- Modify: `apps/api/src/services/authService.ts` — `AuthServiceImpl` + repos; async methods; `InMemoryAuthService extends`.
- Modify: `apps/api/src/services/__tests__/authService.test.ts` — async conversion.
- Modify: `apps/api/src/services/generationService.ts` — `GenerationServiceImpl` + repo; `listTasks` async; `InMemoryGenerationService extends`.
- Modify: `apps/api/src/services/__tests__/generationService.test.ts` — `await` `listTasks()` call sites.
- Modify: `apps/api/src/services/assetService.ts` — `AssetServiceImpl` + repo; async methods; `InMemoryAssetService extends`.
- Modify: `apps/api/src/services/__tests__/assetService.test.ts` — async conversion.
- Modify: `apps/api/src/routes/auth.ts` — `await` the four auth service calls.
- Modify: `apps/api/src/routes/generations.ts` — `await generationService.listTasks()` in GET.
- Modify: `apps/api/src/server.ts` — import `resolveConfigPath` from modelConfig; rewrite the `import.meta.url` main block to use `createServices` + connectivity check + graceful shutdown.
- Modify: `README.md` — add a Persistence section.
- Modify: `CLAUDE.md` — document repository seam + pglite testing convention.
- Modify: `docs/architecture/mvp-skeleton.md` — add Persistence Foundation Slice section.

Note: `apps/api/src/routes/assets.ts` already `await`s `createAsset`/`listAssets`; no change needed there.

---

## Task 1: Database scaffolding (schema, client, migrations, pglite test support)

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/testSupport/pglite.ts`
- Create: `apps/api/src/db/__tests__/schema.test.ts`
- Create: `apps/api/drizzle/**` (generated)

**Steps:**

- [ ] Install dependencies (let the lockfile resolve versions; do not hand-pin):
  ```bash
  pnpm --filter @gw-link-omniai/api add drizzle-orm postgres
  pnpm --filter @gw-link-omniai/api add -D drizzle-kit @electric-sql/pglite
  ```
- [ ] Add scripts to `apps/api/package.json` (keep existing `dev`/`test`/`typecheck`):
  ```json
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx src/db/migrate.ts"
  ```
- [ ] Create `apps/api/drizzle.config.ts`:
  ```ts
  import { defineConfig } from "drizzle-kit";

  export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql"
  });
  ```
- [ ] Create `apps/api/src/db/schema.ts`:
  ```ts
  import {
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uniqueIndex
  } from "drizzle-orm/pg-core";
  import type {
    CreationAssetContent,
    CreationAssetPreview,
    CreationAssetSource,
    GenerationTaskResultPreview,
    PresetSuggestion
  } from "@gw-link-omniai/shared";

  export const users = pgTable(
    "users",
    {
      id: text("id").primaryKey(),
      displayName: text("display_name").notNull(),
      destination: text("destination").notNull(),
      channel: text("channel").notNull(),
      plan: text("plan").notNull().default("free"),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull()
    },
    (table) => ({
      subjectUnique: uniqueIndex("users_channel_destination_key").on(table.channel, table.destination)
    })
  );

  export const loginChallenges = pgTable(
    "login_challenges",
    {
      id: text("id").primaryKey(),
      destination: text("destination").notNull(),
      channel: text("channel").notNull(),
      codeHash: text("code_hash").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
      failedAttempts: integer("failed_attempts").notNull().default(0)
    },
    (table) => ({
      expiresAtIdx: index("login_challenges_expires_at_idx").on(table.expiresAt)
    })
  );

  export const sessions = pgTable(
    "sessions",
    {
      token: text("token").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull()
    },
    (table) => ({
      userIdIdx: index("sessions_user_id_idx").on(table.userId),
      expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt)
    })
  );

  export const generationTasks = pgTable(
    "generation_tasks",
    {
      id: text("id").primaryKey(),
      ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
      mode: text("mode").notNull(),
      status: text("status").notNull(),
      prompt: text("prompt").notNull(),
      optimizedPrompt: text("optimized_prompt").notNull(),
      preset: jsonb("preset").$type<PresetSuggestion>().notNull(),
      resultPreview: jsonb("result_preview").$type<GenerationTaskResultPreview>().notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull()
    },
    (table) => ({
      ownerCreatedIdx: index("generation_tasks_owner_created_idx").on(
        table.ownerUserId,
        table.createdAt
      )
    })
  );

  export const assets = pgTable(
    "assets",
    {
      id: text("id").primaryKey(),
      ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
      mode: text("mode").notNull(),
      title: text("title").notNull(),
      content: jsonb("content").$type<CreationAssetContent>().notNull(),
      preview: jsonb("preview").$type<CreationAssetPreview>().notNull(),
      source: jsonb("source").$type<CreationAssetSource>().notNull(),
      prompt: text("prompt").notNull(),
      optimizedPrompt: text("optimized_prompt").notNull(),
      preset: jsonb("preset").$type<PresetSuggestion>().notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull()
    },
    (table) => ({
      ownerCreatedIdx: index("assets_owner_created_idx").on(table.ownerUserId, table.createdAt)
    })
  );
  ```
- [ ] Create `apps/api/src/db/client.ts`:
  ```ts
  import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
  import postgres from "postgres";
  import * as schema from "./schema";

  export type AppDatabase = PostgresJsDatabase<typeof schema>;

  export interface DbClient {
    db: AppDatabase;
    verifyConnectivity(): Promise<void>;
    close(): Promise<void>;
  }

  // `prepare: false` is required when connecting through the Supabase transaction
  // pooler (port 6543); it is harmless on a direct connection (port 5432).
  export function createDbClient(databaseUrl: string): DbClient {
    const sql = postgres(databaseUrl, { prepare: false });
    const db = drizzle(sql, { schema });

    return {
      db,
      async verifyConnectivity() {
        await sql`select 1`;
      },
      async close() {
        await sql.end({ timeout: 5 });
      }
    };
  }
  ```
- [ ] Create `apps/api/src/db/migrate.ts`:
  ```ts
  import { fileURLToPath } from "node:url";
  import { drizzle } from "drizzle-orm/postgres-js";
  import { migrate } from "drizzle-orm/postgres-js/migrator";
  import postgres from "postgres";

  const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

  export async function runMigrations(databaseUrl: string): Promise<void> {
    const sql = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      const db = drizzle(sql);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  if (import.meta.url === `file://${process.argv[1]}`) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error("DATABASE_URL is required to run migrations");
      process.exit(1);
    }
    await runMigrations(databaseUrl);
    console.log("Migrations applied");
  }
  ```
- [ ] Create `apps/api/src/testSupport/pglite.ts`:
  ```ts
  import { fileURLToPath } from "node:url";
  import { PGlite } from "@electric-sql/pglite";
  import { drizzle } from "drizzle-orm/pglite";
  import { migrate } from "drizzle-orm/pglite/migrator";
  import type { AppDatabase } from "../db/client";
  import * as schema from "../db/schema";

  const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

  export interface PgliteDatabase {
    db: AppDatabase;
    close(): Promise<void>;
  }

  export async function createPgliteDatabase(): Promise<PgliteDatabase> {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    return {
      // The pglite and postgres-js drizzle instances expose the same query API at
      // runtime; the cast lets repositories type against a single AppDatabase.
      db: db as unknown as AppDatabase,
      async close() {
        await client.close();
      }
    };
  }
  ```
- [ ] Generate the initial migration (produces `apps/api/drizzle/0000_*.sql` + `apps/api/drizzle/meta/`):
  ```bash
  pnpm --filter @gw-link-omniai/api db:generate
  ```
  Verify the generated SQL creates all five tables (`users`, `login_challenges`, `sessions`, `generation_tasks`, `assets`) with: `users` unique index on `(channel, destination)`; `sessions.user_id` FK → `users(id)` `ON DELETE CASCADE`; `generation_tasks.owner_user_id` and `assets.owner_user_id` FKs → `users(id)` `ON DELETE SET NULL`; `preset`/`result_preview`/`content`/`preview`/`source` as `jsonb`; timestamps as `timestamp with time zone`. The filename suffix is auto-generated — commit the file and `meta/` exactly as produced.
- [ ] Write `apps/api/src/db/__tests__/schema.test.ts` (gate: migration applies on pglite; jsonb + timestamptz round-trip):
  ```ts
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { eq } from "drizzle-orm";
  import { generationTasks } from "../schema";
  import { createPgliteDatabase, type PgliteDatabase } from "../../testSupport/pglite";

  describe("database schema", () => {
    let database: PgliteDatabase;

    beforeEach(async () => {
      database = await createPgliteDatabase();
    });

    afterEach(async () => {
      await database.close();
    });

    it("round-trips jsonb and timestamptz columns through migrations", async () => {
      const createdAt = new Date("2026-06-20T00:00:00.000Z");
      await database.db.insert(generationTasks).values({
        id: "generation_task_roundtrip",
        ownerUserId: null,
        mode: "image",
        status: "queued",
        prompt: "做一张海报",
        optimizedPrompt: "制作一张商业海报。",
        preset: {
          modelId: "gw-image-creative",
          parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
          creditEstimate: { credits: 2, unit: "credit" }
        },
        resultPreview: { title: "图片生成任务", description: "任务已排队。" },
        createdAt,
        updatedAt: createdAt
      });

      const rows = await database.db
        .select()
        .from(generationTasks)
        .where(eq(generationTasks.id, "generation_task_roundtrip"));

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "generation_task_roundtrip",
        ownerUserId: null,
        preset: {
          modelId: "gw-image-creative",
          parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
          creditEstimate: { credits: 2, unit: "credit" }
        },
        resultPreview: { title: "图片生成任务", description: "任务已排队。" }
      });
      expect(rows[0]!.createdAt.toISOString()).toBe("2026-06-20T00:00:00.000Z");
    });
  });
  ```
- [ ] Run `pnpm --filter @gw-link-omniai/api test` and `pnpm --filter @gw-link-omniai/api typecheck`. Both green.
- [ ] Commit: `feat(api): add drizzle schema, db client, and pglite test support`.

---

## Task 2: Repository interfaces + in-memory implementations

**Files:**
- Create: `apps/api/src/repositories/types.ts`
- Create: `apps/api/src/repositories/memory.ts`
- Create: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Steps:**

- [ ] Create `apps/api/src/repositories/types.ts`:
  ```ts
  import type {
    CreationAsset,
    GenerationTask,
    LoginChannel,
    UserProfile
  } from "@gw-link-omniai/shared";

  export interface SessionRecord {
    token: string;
    userId: string;
    expiresAtMs: number;
  }

  export interface LoginChallengeRecord {
    id: string;
    destination: string;
    channel: LoginChannel;
    codeHash: string;
    expiresAtMs: number;
    failedAttempts: number;
  }

  export interface UserRepository {
    findBySubject(channel: LoginChannel, destination: string): Promise<UserProfile | undefined>;
    findById(id: string): Promise<UserProfile | undefined>;
    insert(user: UserProfile): Promise<void>;
  }

  export interface SessionRepository {
    save(session: SessionRecord): Promise<void>;
    findByToken(token: string): Promise<SessionRecord | undefined>;
    delete(token: string): Promise<boolean>;
    deleteExpired(nowMs: number): Promise<void>;
  }

  export interface ChallengeRepository {
    save(challenge: LoginChallengeRecord): Promise<void>;
    findById(id: string): Promise<LoginChallengeRecord | undefined>;
    update(challenge: LoginChallengeRecord): Promise<void>;
    delete(id: string): Promise<boolean>;
    deleteExpired(nowMs: number): Promise<void>;
  }

  export interface GenerationTaskRepository {
    insert(task: GenerationTask): Promise<void>;
    list(): Promise<GenerationTask[]>;
  }

  export interface AssetRepository {
    insert(asset: CreationAsset): Promise<void>;
    list(): Promise<CreationAsset[]>;
  }
  ```
- [ ] Create `apps/api/src/repositories/memory.ts` (clones at the storage boundary with `structuredClone`):
  ```ts
  import type {
    CreationAsset,
    GenerationTask,
    LoginChannel,
    UserProfile
  } from "@gw-link-omniai/shared";
  import type {
    AssetRepository,
    ChallengeRepository,
    GenerationTaskRepository,
    LoginChallengeRecord,
    SessionRecord,
    SessionRepository,
    UserRepository
  } from "./types";

  function subjectKey(channel: LoginChannel, destination: string): string {
    return `${channel}:${destination}`;
  }

  export class InMemoryUserRepository implements UserRepository {
    private readonly byId = new Map<string, UserProfile>();
    private readonly subjectToId = new Map<string, string>();

    async findBySubject(channel: LoginChannel, destination: string): Promise<UserProfile | undefined> {
      const id = this.subjectToId.get(subjectKey(channel, destination));
      if (id === undefined) {
        return undefined;
      }
      const user = this.byId.get(id);
      return user ? structuredClone(user) : undefined;
    }

    async findById(id: string): Promise<UserProfile | undefined> {
      const user = this.byId.get(id);
      return user ? structuredClone(user) : undefined;
    }

    async insert(user: UserProfile): Promise<void> {
      this.byId.set(user.id, structuredClone(user));
      this.subjectToId.set(subjectKey(user.channel, user.destination), user.id);
    }
  }

  export class InMemorySessionRepository implements SessionRepository {
    private readonly sessions = new Map<string, SessionRecord>();

    async save(session: SessionRecord): Promise<void> {
      this.sessions.set(session.token, structuredClone(session));
    }

    async findByToken(token: string): Promise<SessionRecord | undefined> {
      const session = this.sessions.get(token);
      return session ? structuredClone(session) : undefined;
    }

    async delete(token: string): Promise<boolean> {
      return this.sessions.delete(token);
    }

    async deleteExpired(nowMs: number): Promise<void> {
      for (const [token, session] of this.sessions) {
        if (session.expiresAtMs <= nowMs) {
          this.sessions.delete(token);
        }
      }
    }
  }

  export class InMemoryChallengeRepository implements ChallengeRepository {
    private readonly challenges = new Map<string, LoginChallengeRecord>();

    async save(challenge: LoginChallengeRecord): Promise<void> {
      this.challenges.set(challenge.id, structuredClone(challenge));
    }

    async findById(id: string): Promise<LoginChallengeRecord | undefined> {
      const challenge = this.challenges.get(id);
      return challenge ? structuredClone(challenge) : undefined;
    }

    async update(challenge: LoginChallengeRecord): Promise<void> {
      this.challenges.set(challenge.id, structuredClone(challenge));
    }

    async delete(id: string): Promise<boolean> {
      return this.challenges.delete(id);
    }

    async deleteExpired(nowMs: number): Promise<void> {
      for (const [id, challenge] of this.challenges) {
        if (challenge.expiresAtMs <= nowMs) {
          this.challenges.delete(id);
        }
      }
    }
  }

  export class InMemoryGenerationTaskRepository implements GenerationTaskRepository {
    private readonly tasks: GenerationTask[] = [];

    async insert(task: GenerationTask): Promise<void> {
      this.tasks.push(structuredClone(task));
    }

    async list(): Promise<GenerationTask[]> {
      return this.tasks.map((task) => structuredClone(task));
    }
  }

  export class InMemoryAssetRepository implements AssetRepository {
    private readonly assets: CreationAsset[] = [];

    async insert(asset: CreationAsset): Promise<void> {
      this.assets.push(structuredClone(asset));
    }

    async list(): Promise<CreationAsset[]> {
      return this.assets.map((asset) => structuredClone(asset));
    }
  }
  ```
- [ ] Create `apps/api/src/repositories/__tests__/repositoryContract.test.ts` with a **memory-only** backend for now (Task 3 adds the pglite backend to the same `describe.each`):
  ```ts
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import type { CreationAsset, GenerationTask, UserProfile } from "@gw-link-omniai/shared";
  import {
    InMemoryAssetRepository,
    InMemoryChallengeRepository,
    InMemoryGenerationTaskRepository,
    InMemorySessionRepository,
    InMemoryUserRepository
  } from "../memory";
  import type {
    AssetRepository,
    ChallengeRepository,
    GenerationTaskRepository,
    LoginChallengeRecord,
    SessionRecord,
    SessionRepository,
    UserRepository
  } from "../types";

  interface RepositoryBundle {
    users: UserRepository;
    sessions: SessionRepository;
    challenges: ChallengeRepository;
    tasks: GenerationTaskRepository;
    assets: AssetRepository;
  }

  interface BackendContext {
    bundle: RepositoryBundle;
    close(): Promise<void>;
  }

  async function setupMemory(): Promise<BackendContext> {
    return {
      bundle: {
        users: new InMemoryUserRepository(),
        sessions: new InMemorySessionRepository(),
        challenges: new InMemoryChallengeRepository(),
        tasks: new InMemoryGenerationTaskRepository(),
        assets: new InMemoryAssetRepository()
      },
      async close() {}
    };
  }

  function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
      id: "user_email_0000000000000000",
      displayName: "creator",
      destination: "creator@example.com",
      channel: "email",
      plan: "free",
      createdAt: "2026-06-20T00:00:00.000Z",
      ...overrides
    };
  }

  function makeChallenge(overrides: Partial<LoginChallengeRecord> = {}): LoginChallengeRecord {
    return {
      id: "challenge-1",
      destination: "creator@example.com",
      channel: "email",
      codeHash: "hash-1",
      expiresAtMs: 1_000,
      failedAttempts: 0,
      ...overrides
    };
  }

  function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
    return {
      token: "session-token-1",
      userId: "user_email_0000000000000000",
      expiresAtMs: 1_000,
      ...overrides
    };
  }

  function makeTask(overrides: Partial<GenerationTask> = {}): GenerationTask {
    return {
      id: "generation_task_1",
      mode: "image",
      status: "queued",
      prompt: "做一张海报",
      optimizedPrompt: "制作一张商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: { title: "图片生成任务", description: "任务已排队。" },
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      ...overrides
    };
  }

  function makeAsset(overrides: Partial<CreationAsset> = {}): CreationAsset {
    return {
      id: "creation_asset_1",
      mode: "image",
      title: "图片资产",
      content: {
        kind: "image",
        url: "https://assets.gw-link.local/placeholders/image-generation.png",
        alt: "占位图"
      },
      preview: { title: "图片资产", description: "占位图片资产。" },
      source: { taskId: "generation_task_1", taskStatus: "succeeded" },
      prompt: "做一张海报",
      optimizedPrompt: "制作一张商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      createdAt: "2026-06-20T00:00:00.000Z",
      ...overrides
    };
  }

  const backends = [{ name: "memory", setup: setupMemory }];

  describe.each(backends)("$name repositories", ({ setup }) => {
    let context: BackendContext;

    beforeEach(async () => {
      context = await setup();
    });

    afterEach(async () => {
      await context.close();
    });

    it("inserts and finds users by subject and id", async () => {
      const { users } = context.bundle;
      const user = makeUser();
      await users.insert(user);

      expect(await users.findBySubject("email", "creator@example.com")).toEqual(user);
      expect(await users.findById(user.id)).toEqual(user);
      expect(await users.findBySubject("phone", "creator@example.com")).toBeUndefined();
      expect(await users.findById("missing")).toBeUndefined();
    });

    it("saves, finds, and deletes sessions", async () => {
      const { users, sessions } = context.bundle;
      await users.insert(makeUser());
      const session = makeSession();
      await sessions.save(session);

      expect(await sessions.findByToken(session.token)).toEqual(session);
      expect(await sessions.delete(session.token)).toBe(true);
      expect(await sessions.delete(session.token)).toBe(false);
      expect(await sessions.findByToken(session.token)).toBeUndefined();
    });

    it("deletes expired sessions only", async () => {
      const { users, sessions } = context.bundle;
      await users.insert(makeUser());
      await sessions.save(makeSession({ token: "expired", expiresAtMs: 1_000 }));
      await sessions.save(makeSession({ token: "active", expiresAtMs: 5_000 }));

      await sessions.deleteExpired(1_000);

      expect(await sessions.findByToken("expired")).toBeUndefined();
      expect(await sessions.findByToken("active")).toBeDefined();
    });

    it("saves, updates failed attempts, and deletes challenges", async () => {
      const { challenges } = context.bundle;
      await challenges.save(makeChallenge());

      const found = await challenges.findById("challenge-1");
      expect(found).toEqual(makeChallenge());

      await challenges.update(makeChallenge({ failedAttempts: 3 }));
      expect((await challenges.findById("challenge-1"))?.failedAttempts).toBe(3);

      expect(await challenges.delete("challenge-1")).toBe(true);
      expect(await challenges.delete("challenge-1")).toBe(false);
      expect(await challenges.findById("challenge-1")).toBeUndefined();
    });

    it("deletes expired challenges only", async () => {
      const { challenges } = context.bundle;
      await challenges.save(makeChallenge({ id: "expired", expiresAtMs: 1_000 }));
      await challenges.save(makeChallenge({ id: "active", expiresAtMs: 5_000 }));

      await challenges.deleteExpired(1_000);

      expect(await challenges.findById("expired")).toBeUndefined();
      expect(await challenges.findById("active")).toBeDefined();
    });

    it("inserts and lists generation tasks preserving jsonb and ordering", async () => {
      const { tasks } = context.bundle;
      await tasks.insert(makeTask({ id: "task-a", createdAt: "2026-06-20T00:00:00.000Z" }));
      await tasks.insert(makeTask({ id: "task-b", createdAt: "2026-06-20T00:00:01.000Z" }));

      const listed = await tasks.list();
      expect(listed.map((task) => task.id)).toEqual(["task-a", "task-b"]);
      expect(listed[0]!.preset).toEqual(makeTask().preset);
      expect(listed[0]!.resultPreview).toEqual(makeTask().resultPreview);
    });

    it("inserts and lists assets preserving the content discriminated union", async () => {
      const { assets } = context.bundle;
      await assets.insert(makeAsset({ id: "asset-a", createdAt: "2026-06-20T00:00:00.000Z" }));
      await assets.insert(makeAsset({ id: "asset-b", createdAt: "2026-06-20T00:00:01.000Z" }));

      const listed = await assets.list();
      expect(listed.map((asset) => asset.id)).toEqual(["asset-a", "asset-b"]);
      expect(listed[0]!.content).toEqual(makeAsset().content);
      expect(listed[0]!.source).toEqual(makeAsset().source);
    });

    it("does not share mutable references with stored task state", async () => {
      const { tasks } = context.bundle;
      await tasks.insert(makeTask({ id: "task-a" }));

      const first = await tasks.list();
      first[0]!.preset.parameters.quality = "mutated";

      const second = await tasks.list();
      expect(second[0]!.preset.parameters.quality).toBe("high");
    });
  });
  ```
- [ ] Run `pnpm --filter @gw-link-omniai/api test` and `... typecheck`. Both green.
- [ ] Commit: `feat(api): add repository interfaces and in-memory implementations`.

---

## Task 3: Drizzle repository implementations + extend the contract test to pglite

**Files:**
- Create: `apps/api/src/repositories/drizzle.ts`
- Modify: `apps/api/src/repositories/__tests__/repositoryContract.test.ts`

**Steps:**

- [ ] Create `apps/api/src/repositories/drizzle.ts`:
  ```ts
  import { and, eq, lte } from "drizzle-orm";
  import type {
    CreationAsset,
    GenerationTask,
    LoginChannel,
    UserProfile
  } from "@gw-link-omniai/shared";
  import type { AppDatabase } from "../db/client";
  import { assets, generationTasks, loginChallenges, sessions, users } from "../db/schema";
  import type {
    AssetRepository,
    ChallengeRepository,
    GenerationTaskRepository,
    LoginChallengeRecord,
    SessionRecord,
    SessionRepository,
    UserRepository
  } from "./types";

  function mapUserRow(row: typeof users.$inferSelect): UserProfile {
    return {
      id: row.id,
      displayName: row.displayName,
      destination: row.destination,
      channel: row.channel as LoginChannel,
      plan: row.plan as UserProfile["plan"],
      createdAt: row.createdAt.toISOString()
    };
  }

  function mapSessionRow(row: typeof sessions.$inferSelect): SessionRecord {
    return { token: row.token, userId: row.userId, expiresAtMs: row.expiresAt.getTime() };
  }

  function mapChallengeRow(row: typeof loginChallenges.$inferSelect): LoginChallengeRecord {
    return {
      id: row.id,
      destination: row.destination,
      channel: row.channel as LoginChannel,
      codeHash: row.codeHash,
      expiresAtMs: row.expiresAt.getTime(),
      failedAttempts: row.failedAttempts
    };
  }

  function mapTaskRow(row: typeof generationTasks.$inferSelect): GenerationTask {
    return {
      id: row.id,
      mode: row.mode as GenerationTask["mode"],
      status: row.status as GenerationTask["status"],
      prompt: row.prompt,
      optimizedPrompt: row.optimizedPrompt,
      preset: row.preset,
      resultPreview: row.resultPreview,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  function mapAssetRow(row: typeof assets.$inferSelect): CreationAsset {
    return {
      id: row.id,
      mode: row.mode as CreationAsset["mode"],
      title: row.title,
      content: row.content,
      preview: row.preview,
      source: row.source,
      prompt: row.prompt,
      optimizedPrompt: row.optimizedPrompt,
      preset: row.preset,
      createdAt: row.createdAt.toISOString()
    };
  }

  export class DrizzleUserRepository implements UserRepository {
    constructor(private readonly db: AppDatabase) {}

    async findBySubject(channel: LoginChannel, destination: string): Promise<UserProfile | undefined> {
      const rows = await this.db
        .select()
        .from(users)
        .where(and(eq(users.channel, channel), eq(users.destination, destination)))
        .limit(1);
      return rows[0] ? mapUserRow(rows[0]) : undefined;
    }

    async findById(id: string): Promise<UserProfile | undefined> {
      const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ? mapUserRow(rows[0]) : undefined;
    }

    async insert(user: UserProfile): Promise<void> {
      await this.db.insert(users).values({
        id: user.id,
        displayName: user.displayName,
        destination: user.destination,
        channel: user.channel,
        plan: user.plan,
        createdAt: new Date(user.createdAt)
      });
    }
  }

  export class DrizzleSessionRepository implements SessionRepository {
    constructor(private readonly db: AppDatabase) {}

    async save(session: SessionRecord): Promise<void> {
      await this.db
        .insert(sessions)
        .values({
          token: session.token,
          userId: session.userId,
          expiresAt: new Date(session.expiresAtMs)
        })
        .onConflictDoUpdate({
          target: sessions.token,
          set: { userId: session.userId, expiresAt: new Date(session.expiresAtMs) }
        });
    }

    async findByToken(token: string): Promise<SessionRecord | undefined> {
      const rows = await this.db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
      return rows[0] ? mapSessionRow(rows[0]) : undefined;
    }

    async delete(token: string): Promise<boolean> {
      const deleted = await this.db
        .delete(sessions)
        .where(eq(sessions.token, token))
        .returning({ token: sessions.token });
      return deleted.length > 0;
    }

    async deleteExpired(nowMs: number): Promise<void> {
      await this.db.delete(sessions).where(lte(sessions.expiresAt, new Date(nowMs)));
    }
  }

  export class DrizzleChallengeRepository implements ChallengeRepository {
    constructor(private readonly db: AppDatabase) {}

    async save(challenge: LoginChallengeRecord): Promise<void> {
      await this.db.insert(loginChallenges).values({
        id: challenge.id,
        destination: challenge.destination,
        channel: challenge.channel,
        codeHash: challenge.codeHash,
        expiresAt: new Date(challenge.expiresAtMs),
        failedAttempts: challenge.failedAttempts
      });
    }

    async findById(id: string): Promise<LoginChallengeRecord | undefined> {
      const rows = await this.db
        .select()
        .from(loginChallenges)
        .where(eq(loginChallenges.id, id))
        .limit(1);
      return rows[0] ? mapChallengeRow(rows[0]) : undefined;
    }

    async update(challenge: LoginChallengeRecord): Promise<void> {
      await this.db
        .update(loginChallenges)
        .set({
          destination: challenge.destination,
          channel: challenge.channel,
          codeHash: challenge.codeHash,
          expiresAt: new Date(challenge.expiresAtMs),
          failedAttempts: challenge.failedAttempts
        })
        .where(eq(loginChallenges.id, challenge.id));
    }

    async delete(id: string): Promise<boolean> {
      const deleted = await this.db
        .delete(loginChallenges)
        .where(eq(loginChallenges.id, id))
        .returning({ id: loginChallenges.id });
      return deleted.length > 0;
    }

    async deleteExpired(nowMs: number): Promise<void> {
      await this.db.delete(loginChallenges).where(lte(loginChallenges.expiresAt, new Date(nowMs)));
    }
  }

  export class DrizzleGenerationTaskRepository implements GenerationTaskRepository {
    constructor(private readonly db: AppDatabase) {}

    async insert(task: GenerationTask): Promise<void> {
      await this.db.insert(generationTasks).values({
        id: task.id,
        ownerUserId: null,
        mode: task.mode,
        status: task.status,
        prompt: task.prompt,
        optimizedPrompt: task.optimizedPrompt,
        preset: task.preset,
        resultPreview: task.resultPreview,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt)
      });
    }

    async list(): Promise<GenerationTask[]> {
      const rows = await this.db.select().from(generationTasks).orderBy(generationTasks.createdAt);
      return rows.map(mapTaskRow);
    }
  }

  export class DrizzleAssetRepository implements AssetRepository {
    constructor(private readonly db: AppDatabase) {}

    async insert(asset: CreationAsset): Promise<void> {
      await this.db.insert(assets).values({
        id: asset.id,
        ownerUserId: null,
        mode: asset.mode,
        title: asset.title,
        content: asset.content,
        preview: asset.preview,
        source: asset.source,
        prompt: asset.prompt,
        optimizedPrompt: asset.optimizedPrompt,
        preset: asset.preset,
        createdAt: new Date(asset.createdAt)
      });
    }

    async list(): Promise<CreationAsset[]> {
      const rows = await this.db.select().from(assets).orderBy(assets.createdAt);
      return rows.map(mapAssetRow);
    }
  }
  ```
- [ ] Extend `apps/api/src/repositories/__tests__/repositoryContract.test.ts` to also run the pglite backend. Add imports near the top:
  ```ts
  import {
    DrizzleAssetRepository,
    DrizzleChallengeRepository,
    DrizzleGenerationTaskRepository,
    DrizzleSessionRepository,
    DrizzleUserRepository
  } from "../drizzle";
  import { createPgliteDatabase } from "../../testSupport/pglite";
  ```
  Add a `setupPglite` function (a fresh, migrated pglite per test keeps backends isolated with no truncation logic):
  ```ts
  async function setupPglite(): Promise<BackendContext> {
    const { db, close } = await createPgliteDatabase();
    return {
      bundle: {
        users: new DrizzleUserRepository(db),
        sessions: new DrizzleSessionRepository(db),
        challenges: new DrizzleChallengeRepository(db),
        tasks: new DrizzleGenerationTaskRepository(db),
        assets: new DrizzleAssetRepository(db)
      },
      close
    };
  }
  ```
  Change the backends array to include both:
  ```ts
  const backends = [
    { name: "memory", setup: setupMemory },
    { name: "pglite", setup: setupPglite }
  ];
  ```
  Note: the session tests already insert the owning user first (`await users.insert(makeUser())`), which satisfies the `sessions.user_id` FK on the Drizzle backend.
- [ ] Run `pnpm --filter @gw-link-omniai/api test` (both backends pass the same contract) and `... typecheck`. Green.
- [ ] Commit: `feat(api): add drizzle repositories and cross-backend contract tests`.

---

## Task 4: Refactor the auth service onto repositories

**Files:**
- Modify: `apps/api/src/services/authService.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/services/__tests__/authService.test.ts`

**Steps:**

- [ ] In `apps/api/src/services/authService.ts`:
  - Remove the local `interface LoginChallengeRecord` and `interface SessionRecord` declarations; import them instead:
    ```ts
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
    ```
  - Change the `AuthService` interface to union return types:
    ```ts
    export interface AuthService {
      startLogin(request: LoginStartRequest): LoginStartResponse | Promise<LoginStartResponse>;
      verifyLogin(request: LoginVerifyRequest): AuthSession | Promise<AuthSession>;
      getSession(token: string | undefined): SessionResponse | Promise<SessionResponse>;
      logout(token: string | undefined): boolean | Promise<boolean>;
    }
    ```
  - Add an `AuthRepositories` type:
    ```ts
    export interface AuthRepositories {
      users: UserRepository;
      sessions: SessionRepository;
      challenges: ChallengeRepository;
    }
    ```
  - Rename `InMemoryAuthService` to `AuthServiceImpl`, change its constructor to accept repositories, make the four methods `async`, replace `Map` access with repository calls, and persist the failed-attempt increment with `challenges.update`. Full class:
    ```ts
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
    ```
  - Add the backward-compatible `InMemoryAuthService` subclass (same constructor signature as before):
    ```ts
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
    ```
  - Keep all existing helper functions (`normalizeDestination`, `generateNumericCode`, `hashCode`, `createUserId`, `createUserSubject`, `createDisplayName`, `anonymousSession`) unchanged. The `createUserSubject` helper is still used by `createUserId`; the `usersBySubject`/`usersById`/`sessions`/`challenges` Map fields are removed (now in repositories). Remove the now-unused `sweepExpiredChallenges`/`sweepExpiredSessions` private methods (replaced by `deleteExpired`).
- [ ] In `apps/api/src/routes/auth.ts`, `await` the four service calls so error mapping still works after the methods became async:
  - start-login handler: `return await authService.startLogin(loginRequest);`
  - verify-login handler: `return await authService.verifyLogin(loginRequest);`
  - session handler: `return await authService.getSession(readBearerToken(request.headers.authorization));`
  - logout handler: `await authService.logout(readBearerToken(request.headers.authorization));` then `return { ok: true };`
- [ ] Convert `apps/api/src/services/__tests__/authService.test.ts` to async. Replace the file body's `describe` block so every `it` is `async`, every service call is `await`ed, synchronous `expect(...).toEqual(...)` becomes `expect(await ...).toEqual(...)`, and `expect(() => service.verifyLogin(...)).toThrow(err)` becomes `await expect(service.verifyLogin(...)).rejects.toThrow(err)`. Keep the helpers (`createService`, `createSequenceGenerator`, `createMutableClock`) and constants unchanged. The converted cases:
  ```ts
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
  ```
- [ ] Run `pnpm --filter @gw-link-omniai/api test` (auth unit + `routes/__tests__/auth.test.ts` + `server.test.ts` all green — the HTTP tests' sync fakes remain valid via union return types) and `... typecheck`. Green.
- [ ] Commit: `refactor(api): back the auth service with repositories`.

---

## Task 5: Refactor the generation service onto a repository

**Files:**
- Modify: `apps/api/src/services/generationService.ts`
- Modify: `apps/api/src/routes/generations.ts`
- Modify: `apps/api/src/services/__tests__/generationService.test.ts`

**Steps:**

- [ ] In `apps/api/src/services/generationService.ts`:
  - Add imports:
    ```ts
    import type { GenerationTaskRepository } from "../repositories/types";
    import { InMemoryGenerationTaskRepository } from "../repositories/memory";
    ```
  - Change `listTasks` in the `GenerationService` interface to a union return type:
    ```ts
    export interface GenerationService {
      createTask(request: GenerationTaskRequest): GenerationTask | Promise<GenerationTask>;
      listTasks(): GenerationTask[] | Promise<GenerationTask[]>;
    }
    ```
  - Rename `InMemoryGenerationService` to `GenerationServiceImpl`; accept a `GenerationTaskRepository` as the first constructor arg; replace the `private readonly tasks: GenerationTask[] = []` field with the injected repository; replace `this.tasks.push(task)` with `await this.tasks.insert(task)`; make `listTasks` async returning `this.tasks.list()`. The validation, catalog lookup, provider dry-run, and the final `return cloneGenerationTask(task)` stay exactly as-is. Constructor:
    ```ts
    constructor(taskRepository: GenerationTaskRepository, options: GenerationServiceOptions = {}) {
      this.tasks = taskRepository;
      this.clock = options.clock ?? { now: () => new Date() };
      this.idGenerator = options.idGenerator ?? createGenerationTaskId;
      this.modelCatalog = options.modelCatalog;
      this.providerAdapter = options.providerAdapter ?? new FakeProviderAdapter();
      this.userId = options.userId ?? "development-user";
    }
    ```
    where the field is declared `private readonly tasks: GenerationTaskRepository;`. The create path ends with:
    ```ts
    await this.tasks.insert(task);
    return cloneGenerationTask(task);
    ```
    and:
    ```ts
    async listTasks(): Promise<GenerationTask[]> {
      return this.tasks.list();
    }
    ```
  - Add the backward-compatible subclass:
    ```ts
    export class InMemoryGenerationService extends GenerationServiceImpl {
      constructor(options: GenerationServiceOptions = {}) {
        super(new InMemoryGenerationTaskRepository(), options);
      }
    }
    ```
  - Keep `createGenerationTaskId`, `cloneGenerationTask`, and all other helpers unchanged.
- [ ] In `apps/api/src/routes/generations.ts`, change the GET handler to await:
  ```ts
  server.get("/v1/generations", async () => ({
    tasks: await generationService.listTasks()
  }))
  ```
  (The POST handler already `await`s `createTask`.)
- [ ] In `apps/api/src/services/__tests__/generationService.test.ts`, `await` the five `listTasks()` call sites (the surrounding `it` blocks are already async):
  - `expect(service.listTasks()).toEqual([]);` → `expect(await service.listTasks()).toEqual([]);` (two occurrences in the provider-error tests).
  - In the catalog-error test's `catch` block: `expect(service.listTasks()).toEqual([]);` → `expect(await service.listTasks()).toEqual([]);`.
  - In the defensive-copies test: `const [listedTask] = service.listTasks();` → `const [listedTask] = await service.listTasks();`, and `expect(service.listTasks()[0]!.preset.parameters.quality).toBe("high");` → `expect((await service.listTasks())[0]!.preset.parameters.quality).toBe("high");`.
- [ ] Run `pnpm --filter @gw-link-omniai/api test` (generation unit + `server.test.ts` generation route green) and `... typecheck`. Green.
- [ ] Commit: `refactor(api): back the generation service with a repository`.

---

## Task 6: Refactor the asset service onto a repository

**Files:**
- Modify: `apps/api/src/services/assetService.ts`
- Modify: `apps/api/src/services/__tests__/assetService.test.ts`

**Steps:**

- [ ] In `apps/api/src/services/assetService.ts`:
  - Add imports:
    ```ts
    import type { AssetRepository } from "../repositories/types";
    import { InMemoryAssetRepository } from "../repositories/memory";
    ```
  - Change the `AssetService` interface to union return types:
    ```ts
    export interface AssetService {
      createAsset(request: CreationAssetRequest): CreationAsset | Promise<CreationAsset>;
      listAssets(): CreationAsset[] | Promise<CreationAsset[]>;
    }
    ```
  - Rename `InMemoryAssetService` to `AssetServiceImpl`; accept an `AssetRepository` as the first constructor arg; replace the `private readonly assets: CreationAsset[] = []` field with the injected repository (keep the `private nextAssetId = 1` field and `createAssetId` method); make `createAsset`/`listAssets` async. Constructor:
    ```ts
    constructor(assetRepository: AssetRepository, options: AssetServiceOptions = {}) {
      this.assets = assetRepository;
      this.clock = options.clock ?? { now: () => new Date() };
      this.idGenerator = options.idGenerator ?? (() => this.createAssetId());
    }
    ```
    where the field is declared `private readonly assets: AssetRepository;`. The create path ends with:
    ```ts
    await this.assets.insert(asset);
    return cloneAsset(asset);
    ```
    and:
    ```ts
    async listAssets(): Promise<CreationAsset[]> {
      return this.assets.list();
    }
    ```
    Mark `createAsset` `async`. All validation, normalization, and `cloneAsset`/`cloneContent`/etc. helpers stay unchanged.
  - Add the backward-compatible subclass:
    ```ts
    export class InMemoryAssetService extends AssetServiceImpl {
      constructor(options: AssetServiceOptions = {}) {
        super(new InMemoryAssetRepository(), options);
      }
    }
    ```
- [ ] `apps/api/src/routes/assets.ts` already `await`s `createAsset`/`listAssets`; no change needed.
- [ ] Convert `apps/api/src/services/__tests__/assetService.test.ts` to async:
  - Make `expectAssetError` async and `await` the action:
    ```ts
    async function expectAssetError(action: () => unknown, message: string, statusCode: number) {
      try {
        await action();
      } catch (error) {
        expect(error).toBeInstanceOf(AssetError);
        expect(error).toMatchObject({ message, statusCode });
        return;
      }

      throw new Error("Expected asset error");
    }
    ```
  - Make every `it(...)` callback `async`.
  - `expect(service.createAsset(...)).toEqual({...})` → `expect(await service.createAsset(...)).toEqual({...})`.
  - In the unique-ids test, `await` each `createAsset(...)` before reading `.id` (build the array with awaited calls):
    ```ts
    const ids = [
      (await first.createAsset(createImageRequest())).id,
      (await second.createAsset(createImageRequest())).id,
      (await first.createAsset(createImageRequest())).id
    ];
    expect(ids).toEqual(["creation_asset_000001", "creation_asset_000001", "creation_asset_000002"]);
    ```
  - In the mode-specific previews test, `await` both `createAsset` calls (`const textAsset = await service.createAsset({...})`, `const videoAsset = await service.createAsset({...})`).
  - In the defensive-copies test, `await` `createAsset` and both `listAssets()` reads (`const [listedAsset] = await service.listAssets();`, `expect((await service.listAssets())[0]).toMatchObject({...})`).
  - In the content-normalization test, `await` `createAsset` and `listAssets()`.
  - Every `expectAssetError(() => service.createAsset(...), ...)` becomes `await expectAssetError(() => service.createAsset(...), ...)` (the action returns a promise, which `expectAssetError` now awaits).
- [ ] Run `pnpm --filter @gw-link-omniai/api test` (asset unit + `server.test.ts` asset route green) and `... typecheck`. Green.
- [ ] Commit: `refactor(api): back the asset service with a repository`.

---

## Task 7: Config, composition factory, and server wiring

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/__tests__/config.test.ts`
- Modify: `apps/api/src/services/modelConfig.ts`
- Create: `apps/api/src/services/appServices.ts`
- Create: `apps/api/src/services/__tests__/appServices.test.ts`
- Create: `apps/api/src/__tests__/dbPersistence.test.ts`
- Modify: `apps/api/src/server.ts`

**Steps:**

- [ ] Add optional `databaseUrl` to `apps/api/src/config.ts`:
  - In `ApiConfig`, add `databaseUrl?: string;`.
  - In `loadConfig`, add `databaseUrl: env.DATABASE_URL` to the returned object.
- [ ] Add config tests to `apps/api/src/__tests__/config.test.ts` (existing `toEqual` cases stay valid because `toEqual` ignores `undefined` properties):
  ```ts
  it("includes the database URL when provided", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://localhost:5432/omni" })).toMatchObject({
      databaseUrl: "postgres://localhost:5432/omni"
    });
  });

  it("omits the database URL when not provided", () => {
    expect(loadConfig({}).databaseUrl).toBeUndefined();
  });
  ```
- [ ] Move `resolveConfigPath` from `server.ts` to `apps/api/src/services/modelConfig.ts`:
  - In `modelConfig.ts`, extend the `node:fs` import to `import { existsSync, readFileSync } from "node:fs";` and add `import { dirname, isAbsolute, join } from "node:path";`.
  - Append the exported function:
    ```ts
    export function resolveConfigPath(configPath: string): string {
      if (isAbsolute(configPath) || existsSync(configPath)) {
        return configPath;
      }

      let currentDirectory = process.cwd();

      while (true) {
        const candidate = join(currentDirectory, configPath);

        if (existsSync(candidate)) {
          return candidate;
        }

        const parentDirectory = dirname(currentDirectory);

        if (parentDirectory === currentDirectory) {
          return configPath;
        }

        currentDirectory = parentDirectory;
      }
    }
    ```
- [ ] Create `apps/api/src/services/appServices.ts`:
  ```ts
  import { randomUUID } from "node:crypto";
  import type { ApiConfig } from "../config";
  import { createDbClient, type AppDatabase } from "../db/client";
  import {
    DrizzleAssetRepository,
    DrizzleChallengeRepository,
    DrizzleGenerationTaskRepository,
    DrizzleSessionRepository,
    DrizzleUserRepository
  } from "../repositories/drizzle";
  import { AssetServiceImpl, InMemoryAssetService, type AssetService } from "./assetService";
  import { AuthServiceImpl, InMemoryAuthService, type AuthService } from "./authService";
  import {
    GenerationServiceImpl,
    InMemoryGenerationService,
    type GenerationService
  } from "./generationService";
  import { ConfigModelCatalog, type ModelCatalog } from "./modelCatalog";
  import { loadModelCatalogConfig, resolveConfigPath } from "./modelConfig";

  export interface AppServices {
    authService: AuthService;
    generationService: GenerationService;
    assetService: AssetService;
    modelCatalog: ModelCatalog;
    verifyConnectivity(): Promise<void>;
    closeDb(): Promise<void>;
  }

  export function createDbServices(
    db: AppDatabase,
    modelCatalog: ModelCatalog,
    options: { authDevCodesEnabled: boolean }
  ): { authService: AuthService; generationService: GenerationService; assetService: AssetService } {
    const authService = new AuthServiceImpl(
      {
        users: new DrizzleUserRepository(db),
        sessions: new DrizzleSessionRepository(db),
        challenges: new DrizzleChallengeRepository(db)
      },
      { devCodesEnabled: options.authDevCodesEnabled }
    );

    const generationService = new GenerationServiceImpl(new DrizzleGenerationTaskRepository(db), {
      modelCatalog,
      idGenerator: () => `generation_task_${randomUUID()}`
    });

    const assetService = new AssetServiceImpl(new DrizzleAssetRepository(db), {
      idGenerator: () => `creation_asset_${randomUUID()}`
    });

    return { authService, generationService, assetService };
  }

  export function createServices(config: ApiConfig): AppServices {
    const modelCatalog = new ConfigModelCatalog(
      loadModelCatalogConfig(resolveConfigPath(config.modelConfigPath))
    );

    if (!config.databaseUrl) {
      return {
        authService: new InMemoryAuthService({ devCodesEnabled: config.authDevCodesEnabled }),
        generationService: new InMemoryGenerationService({ modelCatalog }),
        assetService: new InMemoryAssetService(),
        modelCatalog,
        async verifyConnectivity() {},
        async closeDb() {}
      };
    }

    const client = createDbClient(config.databaseUrl);
    const services = createDbServices(client.db, modelCatalog, {
      authDevCodesEnabled: config.authDevCodesEnabled
    });

    return {
      ...services,
      modelCatalog,
      verifyConnectivity: () => client.verifyConnectivity(),
      closeDb: () => client.close()
    };
  }
  ```
- [ ] Create `apps/api/src/services/__tests__/appServices.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import type { ApiConfig } from "../../config";
  import { createServices } from "../appServices";
  import { InMemoryAssetService } from "../assetService";
  import { InMemoryAuthService } from "../authService";
  import { InMemoryGenerationService } from "../generationService";

  function baseConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
    return {
      port: 8787,
      gatewayBaseUrl: "https://gateway.gw-link.local",
      authDevCodesEnabled: true,
      modelConfigPath: "config/models.json",
      ...overrides
    };
  }

  describe("createServices", () => {
    it("builds in-memory services when DATABASE_URL is absent", async () => {
      const services = createServices(baseConfig());

      expect(services.authService).toBeInstanceOf(InMemoryAuthService);
      expect(services.generationService).toBeInstanceOf(InMemoryGenerationService);
      expect(services.assetService).toBeInstanceOf(InMemoryAssetService);
      await expect(services.verifyConnectivity()).resolves.toBeUndefined();
      await expect(services.closeDb()).resolves.toBeUndefined();
    });

    it("builds database-backed services when DATABASE_URL is present", async () => {
      const services = createServices(baseConfig({ databaseUrl: "postgres://localhost:5432/omni" }));

      // postgres.js connects lazily, so construction does not open a socket.
      expect(services.authService).not.toBeInstanceOf(InMemoryAuthService);
      expect(services.generationService).not.toBeInstanceOf(InMemoryGenerationService);
      expect(services.assetService).not.toBeInstanceOf(InMemoryAssetService);
      expect(typeof services.verifyConnectivity).toBe("function");

      await services.closeDb();
    });
  });
  ```
- [ ] Create `apps/api/src/__tests__/dbPersistence.test.ts` (the "survives restart" proof — a second set of services over the same pglite db reads what the first wrote):
  ```ts
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import type { ApiConfig } from "../config";
  import type { ModelCatalogConfig } from "../services/modelConfig";
  import { buildServer } from "../server";
  import { createDbServices } from "../services/appServices";
  import { ConfigModelCatalog } from "../services/modelCatalog";
  import { createPgliteDatabase, type PgliteDatabase } from "../testSupport/pglite";

  function smokeConfig(): ApiConfig {
    return {
      port: 8787,
      gatewayBaseUrl: "https://gateway.gw-link.local",
      authDevCodesEnabled: true,
      modelConfigPath: "config/models.json"
    };
  }

  function modelConfig(): ModelCatalogConfig {
    return {
      providers: [
        {
          id: "openai-main",
          displayName: "OpenAI Main",
          protocol: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          models: [
            {
              id: "gw-text-balanced",
              providerModelId: "gpt-4.1-mini",
              displayName: "OmniAI Text Balanced",
              capability: "text",
              tags: ["recommended", "balanced"],
              visibility: "visible",
              minimumPlan: "free",
              creditUnitCost: 1
            }
          ]
        }
      ]
    };
  }

  function buildServerForDb(database: PgliteDatabase) {
    const modelCatalog = new ConfigModelCatalog(modelConfig());
    const services = createDbServices(database.db, modelCatalog, { authDevCodesEnabled: true });
    return buildServer({
      config: smokeConfig(),
      modelCatalog,
      authService: services.authService,
      generationService: services.generationService,
      assetService: services.assetService
    });
  }

  describe("database-backed persistence", () => {
    let database: PgliteDatabase;

    beforeEach(async () => {
      database = await createPgliteDatabase();
    });

    afterEach(async () => {
      await database.close();
    });

    it("persists sessions, tasks, and assets across service instances", async () => {
      const first = buildServerForDb(database);

      const startResponse = await first.inject({
        method: "POST",
        url: "/v1/auth/start-login",
        payload: { destination: "creator@example.com" }
      });
      const { challengeId, devCode } = startResponse.json() as { challengeId: string; devCode: string };

      const verifyResponse = await first.inject({
        method: "POST",
        url: "/v1/auth/verify-login",
        payload: { challengeId, code: devCode }
      });
      const { token } = verifyResponse.json() as { token: string };

      await first.inject({
        method: "POST",
        url: "/v1/generations",
        payload: {
          mode: "text",
          prompt: "帮我写一个新品发布文案",
          optimizedPrompt: "请生成一段新品推广文案。",
          preset: {
            modelId: "gw-text-balanced",
            parameters: { outputFormat: "markdown", tone: "clear" },
            creditEstimate: { credits: 1, unit: "credit" }
          }
        }
      });

      await first.inject({
        method: "POST",
        url: "/v1/assets",
        payload: {
          mode: "text",
          title: "文本资产",
          content: { kind: "text", text: "这是一段可复用的新品推广文案。", format: "markdown" },
          source: { taskId: "generation_task_000001", taskStatus: "succeeded" },
          prompt: "帮我写一个新品发布文案",
          optimizedPrompt: "请生成一段新品推广文案。",
          preset: {
            modelId: "gw-text-balanced",
            parameters: { outputFormat: "markdown", tone: "clear" },
            creditEstimate: { credits: 1, unit: "credit" }
          }
        }
      });

      // Simulate a process restart: brand-new server + services over the SAME database.
      const second = buildServerForDb(database);

      const sessionResponse = await second.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { authorization: `Bearer ${token}` }
      });
      expect(sessionResponse.json()).toMatchObject({
        authenticated: true,
        user: { destination: "creator@example.com" }
      });

      const tasksResponse = await second.inject({ method: "GET", url: "/v1/generations" });
      expect(tasksResponse.json()).toMatchObject({
        tasks: [{ mode: "text", status: "queued", prompt: "帮我写一个新品发布文案" }]
      });

      const assetsResponse = await second.inject({ method: "GET", url: "/v1/assets" });
      expect(assetsResponse.json()).toMatchObject({
        assets: [{ mode: "text", title: "文本资产" }]
      });
    });
  });
  ```
- [ ] Update `apps/api/src/server.ts`:
  - Remove the local `resolveConfigPath` function and the now-unused imports `import { existsSync } from "node:fs";` and `import { dirname, isAbsolute, join } from "node:path";`.
  - Change the modelConfig import to: `import { loadModelCatalogConfig, resolveConfigPath } from "./services/modelConfig";`.
  - Add: `import { createServices } from "./services/appServices";`.
  - Leave `buildServer` and its in-memory defaults unchanged (it still must not create a DB client when services are injected).
  - Replace the `import.meta.url` main block with:
    ```ts
    if (import.meta.url === `file://${process.argv[1]}`) {
      const config = loadConfig();
      const services = createServices(config);

      try {
        await services.verifyConnectivity();
      } catch (error) {
        console.error("Database connectivity check failed", error);
        await services.closeDb();
        process.exit(1);
      }

      const server = buildServer({
        config,
        modelCatalog: services.modelCatalog,
        authService: services.authService,
        generationService: services.generationService,
        assetService: services.assetService
      });

      const shutdown = async (signal: string) => {
        console.log(`Received ${signal}, shutting down`);
        await server.close();
        await services.closeDb();
        process.exit(0);
      };

      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));

      await server.listen({
        port: config.port,
        host: "0.0.0.0"
      });

      console.log(`GW-LINK OmniAI API listening on ${config.port}`);
    }
    ```
  - Note on connectivity-failure coverage: the failure branch is straightforward wiring and reaching it in a unit test requires a real failed connection (slow/flaky), so it is verified manually per the acceptance checklist rather than with an automated network test. The positive connectivity path (`select 1`) is exercised by the pglite-backed tests.
- [ ] Run `pnpm --filter @gw-link-omniai/api test` and `pnpm --filter @gw-link-omniai/api typecheck`. Green.
- [ ] Commit: `feat(api): select drizzle or in-memory services via DATABASE_URL with startup checks`.

---

## Task 8: Documentation

**Files:**
- Create: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/architecture/mvp-skeleton.md`

**Steps:**

- [ ] Create `.env.example` at the repo root:
  ```bash
  # GW-LINK OmniAI API environment variables (copy to .env for local use)

  # HTTP port for the product API (default 8787)
  PORT=8787

  # GW-LINK AI gateway base URL
  GW_LINK_GATEWAY_BASE_URL=https://gateway.gw-link.local

  # Path to the product model catalog (default config/models.json)
  GW_LINK_MODEL_CONFIG_PATH=config/models.json

  # Passwordless login dev codes. Defaults on outside production, off when
  # NODE_ENV=production. NEVER set this to true in production: the start-login
  # response would expose verification codes.
  # GW_LINK_AUTH_DEV_CODES_ENABLED=true

  # Postgres connection string. When unset, the API runs fully in-memory
  # (data is lost on restart). When set, the API uses Drizzle-backed services.
  #
  # Supabase direct connection (port 5432):
  #   postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
  # Supabase transaction pooler (port 6543) is also supported; the client sets
  #   prepare:false so prepared statements work through the pooler.
  # DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
  ```
- [ ] Add a Persistence section to `README.md` (after the Provider Adapter Foundation section, before `## Validation`):
  ```markdown
  ### Persistence Foundation

  The fifth product-first slice replaces in-process storage with durable Postgres
  storage behind a repository seam, without changing product contracts or routes.

  - Set `DATABASE_URL` to use Drizzle-backed auth, generation, and asset services.
  - Leave `DATABASE_URL` unset for zero-config local development with in-memory
    services (data is lost on restart).
  - Apply migrations explicitly (startup never migrates automatically):

  ```bash
  pnpm --filter @gw-link-omniai/api db:generate   # regenerate SQL after schema changes
  DATABASE_URL=postgresql://... pnpm --filter @gw-link-omniai/api db:migrate
  ```

  - Supabase Postgres is the managed target. Use the direct connection (5432) or
    the transaction pooler (6543); the client sets `prepare:false` for pooler
    compatibility.
  - Tests use `@electric-sql/pglite` (in-process Postgres), so no database is
    required to run `pnpm --filter @gw-link-omniai/api test`.
  - This slice keeps the fake provider adapter, placeholder asset URLs, dev-code
    auth, and global (non-per-user) list semantics. A nullable `owner_user_id`
    column is reserved for later per-user isolation.
  ```
  (Use a fenced block with `~~~` or escape the inner backticks as appropriate so the nested code block renders.)
- [ ] Add to `CLAUDE.md` under the "API architecture (apps/api)" section a note on the repository seam:
  ```markdown
  - **Repository seam + dual implementations**: core services (`auth`, `generation`, `asset`) hold their logic in `XServiceImpl` classes that take injected repositories (`apps/api/src/repositories/types.ts`). Each repository has an in-memory implementation (`repositories/memory.ts`, clones at the storage boundary with `structuredClone`) and a Drizzle implementation (`repositories/drizzle.ts`). The `InMemoryXService` classes are thin subclasses that wire the in-memory repositories, preserving their original constructor signatures. `createServices(config)` (`services/appServices.ts`) selects Drizzle vs in-memory by the presence of `config.databaseUrl`; `buildServer` still accepts injected services and never creates a DB client itself. Service interface methods return `T | Promise<T>` so synchronous test fakes stay valid while routes `await`.
  - **Persistence + tests**: Postgres access is via Drizzle ORM + the `postgres` driver (`db/client.ts`, `prepare:false` for the Supabase pooler). Migrations are explicit (`db:generate`/`db:migrate`, `db/migrate.ts`); startup never auto-migrates. Tests use `@electric-sql/pglite` via `testSupport/pglite.ts`; repository behavior is locked by a single cross-backend contract test (`repositories/__tests__/repositoryContract.test.ts`) run against both memory and pglite.
  ```
- [ ] Append a section to `docs/architecture/mvp-skeleton.md`:
  ```markdown
  ## Persistence Foundation Slice

  The persistence foundation slice replaces in-process storage with durable
  Postgres storage behind a repository seam, without changing product contracts,
  `/v1/*` routes, or HTTP response shapes. The three core services keep their
  interfaces and business logic; only their storage becomes an injected
  repository, with in-memory and Drizzle implementations locked to one
  cross-backend contract test.

  `createServices(config)` selects Drizzle-backed services when `DATABASE_URL`
  is set and in-memory services otherwise. Startup verifies database connectivity
  and registers graceful shutdown; migrations stay an explicit step. The slice
  reserves a nullable `owner_user_id` column on tasks and assets for later
  per-user isolation but does not populate or filter on it — `listTasks` and
  `listAssets` still return everything, matching prior behavior. Real provider
  calls, object storage, billing, and per-user access control remain later slices.
  ```
- [ ] Run the full suite from the repo root: `pnpm test` and `pnpm typecheck`. Both green.
- [ ] Commit: `docs: document the persistence foundation slice`.

---

## Final Verification (after all tasks)

- [ ] `pnpm test` passes (root `node:test` workspace check + every package's vitest).
- [ ] `pnpm typecheck` passes across all packages.
- [ ] `git grep -n "providerModelId\|apiKeyEnv\|baseUrl" apps/api/src/routes` shows no provider internals leaked into routes (product boundary intact).
- [ ] No edits exist under `packages/shared/`, and `apps/api/src/routes/*` request/response shapes are unchanged except added `await`s.
- [ ] Manual Supabase check (not automated): set `DATABASE_URL` to a Supabase instance, run `db:migrate`, start the API, complete login + create a task + save an asset, restart the process, and confirm the session, task, and asset are still readable.
```
