# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GW-LINK OmniAI: a multi-platform AI creation product (text chat, image generation, video generation). Built as thin vertical product slices on top of a stable contract layer, with real AI provider integration deliberately deferred. Most service implementations today are in-memory or fake stand-ins (`InMemory*`, `Fake*`); the product contracts they satisfy are the stable part.

## Commands

pnpm workspace (pnpm 11, Node 20, all packages are ESM + TypeScript strict).

```bash
pnpm install --frozen-lockfile   # first-time setup
pnpm test                        # node --test on tests/workspace.test.mjs, then `pnpm -r test`
pnpm typecheck                   # `tsc --noEmit` across every package

pnpm dev:api                     # Fastify API on :8787 (tsx)
pnpm dev:admin                   # Next.js admin
pnpm dev:desktop                 # Vite + Tauri desktop shell
pnpm dev:mobile                  # Expo mobile shell
```

Run one package's tests / typecheck (each package's `test` is `vitest run`, `typecheck` is `tsc --noEmit`):

```bash
pnpm --filter @gw-link-omniai/api test
pnpm --filter @gw-link-omniai/api typecheck
```

Run a single vitest file or test name (cd into the package, or use `--filter`):

```bash
pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/generationService.test.ts
pnpm --filter @gw-link-omniai/api exec vitest run -t "queues a task"
```

`tests/workspace.test.mjs` is a root-level `node:test` (not vitest) that asserts the workspace skeleton/manifests; it runs first under `pnpm test`.

## Workspace layout

- `packages/shared` (`@gw-link-omniai/shared`) — product contracts (types) and pure helpers. **Consumed as TypeScript source**, not a build artifact: `main` is `src/index.ts` and `tsconfig.base.json` maps the import to `packages/shared/src/index.ts`. Edits are picked up live; there is no shared build step. Everything public is re-exported from `src/index.ts` — add new contracts there.
- `apps/api` — Fastify product API + the adapter boundary to the GW-LINK AI gateway.
- `apps/admin` — Next.js internal operations console.
- `apps/desktop` — Tauri 2 + Vite + React 18, the primary creation workspace.
- `apps/mobile` — Expo 51 + React Native companion.

## API architecture (apps/api)

`buildServer(options)` in `src/server.ts` is the composition root. Every dependency (services, model catalog, config, prompt optimizer, provider adapter) is an **optional constructor option** that defaults to a real instance — tests inject fakes/in-memory variants instead of standing up the whole graph.

Layering is strict and one-directional:

- **Routes** (`src/routes/*.ts`, registered via `registerXRoutes(server, deps)`) are thin: parse/validate the request body with hand-written type guards (`isRecord`, etc. — no schema library), call a service, map errors to status codes. They never contain business logic.
- **Services** (`src/services/*.ts`) hold the logic. Each is an `interface` plus an implementation (`InMemoryGenerationService`, `ConfigModelCatalog`, `FakeProviderAdapter`, ...). Services throw typed errors (`GenerationTaskError`, `ModelCatalogError`, `ProviderAdapterError`) that carry a `statusCode`; routes/services translate these into HTTP responses.

Conventions to match when adding code here:

- **Defensive cloning**: services clone every object they return or store (`cloneGenerationTask`, `cloneProductModel`, ...) so callers can't mutate internal state. Preserve this — don't hand out internal references.
- **Injectable side effects**: time and IDs come from options (`clock.now()`, `idGenerator`), never `Date.now()`/random inline, so tests are deterministic.
- **Repository seam + dual implementations**: core services (`auth`, `generation`, `asset`) hold their logic in `XServiceImpl` classes that take injected repositories (`apps/api/src/repositories/types.ts`). Each repository has an in-memory implementation (`repositories/memory.ts`, clones at the storage boundary with `structuredClone`) and a Drizzle implementation (`repositories/drizzle.ts`). The `InMemoryXService` classes are thin subclasses that wire the in-memory repositories, preserving their original constructor signatures. `createServices(config)` (`services/appServices.ts`) selects Drizzle vs in-memory by the presence of `config.databaseUrl`; `buildServer` still accepts injected services and never creates a DB client itself. Service interface methods return `T | Promise<T>` so synchronous test fakes stay valid while routes `await`.
- **Persistence + tests**: Postgres access is via Drizzle ORM + the `postgres` driver (`db/client.ts`, `prepare:false` for the Supabase pooler). Migrations are explicit (`db:generate`/`db:migrate`, `db/migrate.ts`); startup never auto-migrates. Tests use `@electric-sql/pglite` via `testSupport/pglite.ts`; repository behavior is locked by a single cross-backend contract test (`repositories/__tests__/repositoryContract.test.ts`) run against both memory and pglite.

## The product boundary (most important constraint)

The product API is a boundary that **hides all provider/gateway detail behind product contracts**. Do not leak provider internals into product surfaces:

- `config/models.json` maps product model IDs → provider model IDs, protocol, base URL, API-key env name, visibility, plan, credit cost. `GW_LINK_MODEL_CONFIG_PATH` overrides the path.
- `/v1/models` returns **product fields only** — never `providerModelId`, `baseUrl`, or `apiKeyEnv`. `ConfigModelCatalog.listVisibleModels()` is the filter; keep it that way.
- Clients send the product contract (`mode`, `prompt`, `optimizedPrompt`, `preset`); the API resolves `preset.modelId` through the catalog server-side. Model `visibility` is `visible` | `hidden` | `maintenance` (hidden/maintenance are not generatable).
- Today the provider adapter (`FakeProviderAdapter`) does protocol dispatch (`openai-compatible` / `anthropic-compatible`) but reads no API keys and makes no network calls. Real HTTP clients, streaming, persistence, file storage, and credit mutation are explicitly later slices — don't pull them forward without a spec.
- **Auth guard + per-user isolation**: `/v1/generations` and `/v1/assets` (POST + GET) are guarded by `createAuthGuard(authService)` (`src/routes/authGuard.ts`), which resolves the bearer token via `authService.getSession` and attaches `request.userId`; unauthenticated requests get `401 { error: "Authentication required" }`. Generation/asset services take a `userId` per call and persist/list by `owner_user_id` through the repositories. `/health`, `/v1/models`, `/v1/prompt/*`, and `/v1/auth/*` stay public. Isolation is enforced at the application layer (owner filter in the repositories), not yet via Postgres RLS.
- **Real text provider**: `OpenAiCompatibleTextProvider` (`src/services/openAiTextProvider.ts`) is the default provider adapter. For text + openai-compatible models with the provider's `apiKeyEnv` set, it calls `chat/completions` synchronously and returns `status: "succeeded"` with a `GenerationTask.result` (text); otherwise (no key / non-text / non-openai) it falls back to `status: "queued"` with no result. The API key is read from env, used only in the request header, and never exposed via `/v1/models` or responses. `GenerationTask.result?` is the (optional, additive) contract field carrying generated content. `FakeProviderAdapter` remains for deterministic `queued` tests.

## Frontend conventions (desktop / admin / mobile)

Presentation and state logic live in framework-free `*Model.ts` modules (`studioModel.ts`, `generationModel.ts`, `assetModel.ts`, `sessionModel.ts`) that import contracts from `@gw-link-omniai/shared` and are unit-tested directly with vitest. React components (`App.tsx`, etc.) stay thin and call into these models. The client apps are currently **self-contained/local** — they use fixtures and local task/asset state, not the HTTP API yet.

Desktop now talks to the HTTP API: `apps/desktop/src/apiClient.ts` is a framework-free, fetch-injectable typed client (`createApiClient({ baseUrl?, fetch? })` → `ApiClient`; throws `ApiError`), and `App.tsx` takes an injected `client` (default `createApiClient()`), runs the passwordless login flow, and drives optimize/submit/list against the API with a bearer token held in React memory. Admin and mobile remain local/fixture-based. The API enables CORS (`@fastify/cors`, `GW_LINK_CORS_ORIGINS`).

## Development process

Work proceeds as spec-driven vertical slices. Design specs live in `docs/superpowers/specs/` and implementation plans in `docs/superpowers/plans/` (dated filenames); `docs/architecture/mvp-skeleton.md` records the cumulative architecture. The repo follows a brainstorm → spec → plan → TDD-implement flow (the superpowers skills). When adding a feature, check for an existing spec/plan and keep `mvp-skeleton.md` consistent.

## Config / env

API config is centralized in `apps/api/src/config.ts` (`loadConfig`): `PORT` (default 8787), `GW_LINK_GATEWAY_BASE_URL`, `GW_LINK_MODEL_CONFIG_PATH`, and `GW_LINK_AUTH_DEV_CODES_ENABLED`. Local auth is passwordless (email/phone) and returns a `devCode` in the start-login response to complete the flow without a real SMS/email provider. Dev codes default off when `NODE_ENV=production`; never set `GW_LINK_AUTH_DEV_CODES_ENABLED=true` in production (it exposes verification codes).
