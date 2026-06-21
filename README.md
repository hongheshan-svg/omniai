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
When `NODE_ENV=production`, auth dev codes default to disabled; deployments can also set `GW_LINK_AUTH_DEV_CODES_ENABLED=false` explicitly.
Do not set `GW_LINK_AUTH_DEV_CODES_ENABLED=true` in production because the start-login response will expose verification codes.

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

### Studio Shell and Prompt Optimizer

The first product-first slice is the Studio Shell + Prompt Optimizer MVP.

- Desktop exposes three creation modes: text, image, and video.
- Each mode has a prompt optimization experience.
- `POST /v1/prompt/optimize` returns rule-based local structured optimization output.
- The optimizer does not call real AI providers or external networks in this stage.
- Generation task submission is covered by the Unified Generation Task MVP below; asset storage and real provider adapters are later slices.

Example:

```bash
curl -s -X POST http://localhost:8787/v1/prompt/optimize \
  -H 'content-type: application/json' \
  -d '{"mode":"image","prompt":"做一张咖啡店新品海报","templateId":"image-poster"}'
```

### Unified Generation Task MVP

The second product-first slice connects prompt optimization to generation task submission.

- Text, image, and video use one shared `GenerationTask` contract.
- `POST /v1/generations` creates a queued in-memory task.
- `GET /v1/generations` lists tasks in the current API process.
- Desktop can submit the current Studio result into a local task center.
- This stage still does not call real AI providers, persist tasks, store assets, or deduct credits.

Example:

```bash
curl -s -X POST http://localhost:8787/v1/generations \
  -H 'content-type: application/json' \
  -d '{"mode":"image","prompt":"做一张咖啡店新品海报","optimizedPrompt":"制作一张咖啡店新品商业海报。","preset":{"modelId":"gw-image-creative","parameters":{"aspectRatio":"4:3","quality":"high","count":1},"creditEstimate":{"credits":2,"unit":"credit"}}}'
```

### Asset Library MVP

The third product-first slice turns generation task output into reusable creation assets.

- Text, image, and video use one shared `CreationAsset` contract.
- `POST /v1/assets` creates an in-memory asset with fake text, image, or video content.
- `GET /v1/assets` lists assets in the current API process.
- Desktop can save submitted tasks into a local asset library.
- The asset library can filter all, text, image, and video assets.
- This stage still does not call real AI providers, persist assets, store files, sync across devices, or deduct credits.

Example:

```bash
curl -s -X POST http://localhost:8787/v1/assets \
  -H 'content-type: application/json' \
  -d '{"mode":"image","title":"图片资产","content":{"kind":"image","url":"https://assets.gw-link.local/placeholders/image-generation.png","alt":"咖啡店新品海报占位图"},"source":{"taskId":"generation_task_000001","taskStatus":"succeeded"},"prompt":"做一张咖啡店新品海报","optimizedPrompt":"制作一张咖啡店新品商业海报。","preset":{"modelId":"gw-image-creative","parameters":{"aspectRatio":"4:3","quality":"high","count":1},"creditEstimate":{"credits":2,"unit":"credit"}}}'
```

### Provider Adapter Foundation

The fourth product-first slice adds the model catalog and provider adapter foundation behind the existing creation workflow.

- `config/models.json` declares product-facing text, image, and video models.
- OpenAI-compatible and Anthropic-compatible providers can use any configured `providerModelId`.
- `/v1/models` returns product fields only and does not expose provider model IDs, base URLs, or API key env names.
- `/v1/generations` still accepts the product `mode`, prompt, optimized prompt, and preset contract.
- The current provider adapter is a fake dry-run adapter. It does not read provider API keys and does not send network requests.
- Real provider HTTP clients, streaming, persistence, file storage, credit mutation, and automatic asset creation remain later slices.

Set `GW_LINK_MODEL_CONFIG_PATH=/absolute/path/to/models.json` to load another model catalog.

### Persistence Foundation

The fifth product-first slice replaces in-process storage with durable Postgres
storage behind a repository seam, without changing product contracts or routes.

- Set `DATABASE_URL` to use Drizzle-backed auth, generation, and asset services.
- Leave `DATABASE_URL` unset for zero-config local development with in-memory
  services (data is lost on restart).
- Apply migrations explicitly (startup never migrates automatically):

~~~bash
pnpm --filter @gw-link-omniai/api db:generate   # regenerate SQL after schema changes
DATABASE_URL=postgresql://... pnpm --filter @gw-link-omniai/api db:migrate
~~~

- Supabase Postgres is the managed target. Use the direct connection (5432) or
  the transaction pooler (6543); the client sets `prepare:false` for pooler
  compatibility.
- Tests use `@electric-sql/pglite` (in-process Postgres), so no database is
  required to run `pnpm --filter @gw-link-omniai/api test`.
- This slice keeps the fake provider adapter, placeholder asset URLs, dev-code
  auth, and global (non-per-user) list semantics. A nullable `owner_user_id`
  column is reserved for later per-user isolation.

### Per-User Isolation

The sixth product-first slice scopes generation tasks and assets to the
authenticated user and guards the protected routes.

- `/v1/generations` and `/v1/assets` (POST and GET) now require a bearer token;
  missing or invalid tokens get `401 { "error": "Authentication required" }`.
- `/health`, `/v1/models`, `/v1/prompt/*`, and `/v1/auth/*` stay public.
- List endpoints return only the calling user's items; new rows are written
  under the user's `owner_user_id`.
- No database migration — this reuses the `owner_user_id` columns reserved in
  the Persistence Foundation slice.

Obtain a token via the passwordless login flow, then call a protected route:

```bash
# 1) start-login returns a devCode in local development
curl -s -X POST http://localhost:8787/v1/auth/start-login \
  -H 'content-type: application/json' -d '{"destination":"creator@example.com"}'
# 2) verify-login returns a token
curl -s -X POST http://localhost:8787/v1/auth/verify-login \
  -H 'content-type: application/json' -d '{"challengeId":"<id>","code":"<devCode>"}'
# 3) call a protected route with the token
curl -s http://localhost:8787/v1/generations -H 'authorization: Bearer <token>'
```

### Desktop ↔ API

The seventh product-first slice connects the desktop app to the product API.

- Start the API first (`pnpm dev:api`), then the desktop app (`pnpm dev:desktop`).
- Desktop reads `VITE_API_BASE_URL` (default `http://localhost:8787`).
- Passwordless login: enter an email/phone, the start-login response returns a
  `devCode` in local development, enter it to receive a bearer session (held in
  memory — re-login after restart).
- Optimize a prompt, submit a generation, and view your own task list and asset
  library (per-user, via the guarded API).
- Save a `succeeded` text generation as an asset ("保存到资产库") — the desktop
  builds the asset from the task's text result and posts it to `/v1/assets`.
  (Image/video stay `queued` with no result, so they are not yet saveable.)
- The API enables CORS (`GW_LINK_CORS_ORIGINS`, reflects the request origin when
  unset — set explicit origins in production).

### Real Text Generation

The eighth product-first slice makes text generation real.

- Configure a provider API key (the env var named by `config/models.json`'s
  `apiKeyEnv`, e.g. `OPENAI_API_KEY`). With a key, `POST /v1/generations` for a
  text model calls the OpenAI-compatible provider synchronously and returns a
  `succeeded` task carrying `result: { kind: "text", text, format }`.
- Without a key, text generation falls back to today's `queued` placeholder
  (no real call). Image and video remain placeholder/`queued`.
- Generation is synchronous (no queue/worker); provider errors return `502`
  without persisting a task. The API key is never exposed by `/v1/models` or
  returned to clients.
- The desktop task center shows the generated text when present.

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
