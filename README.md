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
  `devCode` in local development, enter it to receive a bearer session.
- The bearer session is persisted via an injectable `TokenStore` (default
  `localStorage`); on startup the desktop validates the stored token with
  `GET /v1/auth/session` and restores the session, so a restart no longer
  requires re-login (invalid/expired tokens are cleared).
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
- The desktop shows the balance in the header (loaded on login, refreshed after
  each generation) and shows a friendly "积分不足，无法生成" message when a
  generation is rejected for insufficient credits (`402`).
- Dev-only top-up: `POST /v1/credits/topup` (gated by `GW_LINK_DEV_TOPUP_ENABLED`,
  off in production) credits the account directly and returns the new balance; the
  desktop has a "充值" button. Real payment channels (driving `topUp` via webhooks)
  are a later slice.
- Concurrent deduction is not yet atomic; real payment channels and admin/mobile
  balance display are later slices.

### Real Image Generation

The tenth product-first slice makes image generation real.

- With a provider key, `POST /v1/generations` for an image model calls the
  OpenAI-compatible `images/generations` endpoint, stores the image in the object
  store, and returns a `succeeded` task whose `result.url` points at
  `GET /files/<id>` (public, opaque id). Without an object store the image falls
  back to an inline `data:` URL. Set `GW_LINK_OBJECT_STORE_DIR` to persist files
  on disk (in-memory otherwise); `GW_LINK_PUBLIC_BASE_URL` sets the file URL host.
- Without a key, image generation falls back to the `queued` placeholder.
  Generation routes by mode (`CompositeProviderAdapter`); video stays `queued`.
- The desktop renders the generated image in the task center and can save it to
  the asset library (image assets render in the library too).

### Async Generation Lifecycle

Generation can be asynchronous: a provider may return a `running` task with an
internal job reference (never exposed in the product contract). `GET
/v1/generations/:id` re-polls a `running` task via the stored reference,
persists the new status/result, and charges the model's `creditUnitCost` once,
on the `running → succeeded` transition. The desktop shows a "刷新状态" button on
running tasks that fetches the latest state. No background worker — advancement
happens on read.
- Video generation uses `AsyncVideoProvider` (the real async provider plugged
  into this lifecycle): with a configured video service key it submits a job and
  polls to a `result.kind === "video"` (service-hosted URL); the desktop renders
  `<video>` and saves it as an asset. Without a key, video stays `queued`.

### Mobile API Integration

The mobile app connects to the product API for the core creation flow.

- The `apiClient` now lives in `packages/shared` (framework-free — `fetch` +
  shared contracts) and is imported by both desktop and mobile from
  `@gw-link-omniai/shared`.
- Mobile interaction logic lives in a framework-free controller
  (`apps/mobile/src/appModel.ts`, `createMobileAppController`), unit-tested
  directly with vitest. `App.tsx` is a thin React Native view (login → generation
  form → task list + balance) driven by that controller.
- The bearer token is stored in the OS secure enclave via `expo-secure-store`
  (iOS Keychain / Android Keystore); on startup the stored token is validated with
  `GET /v1/auth/session` and the session restored (invalid tokens cleared).
- Core flow: login, submit a generation, list your tasks, show balance, refresh a
  `running` task's status, and save a succeeded result to a filtered asset
  library. Top-up and image/video rendering remain later slices.

### Admin Model Display

The admin console's Model Display module renders the live product model catalog.

- The shared apiClient gains `listModels()` (public `GET /v1/models`, no token).
- `ModelCatalogSection` (a client component) fetches the catalog on mount and lists
  each visible model's name and a `capability · minimumPlan · creditUnitCost` summary.
- `NEXT_PUBLIC_API_BASE_URL` overrides the API base (defaults to `http://localhost:8787`).
- The other admin modules (Users, Plans & Credits, Orders, Usage Metrics) remain
  placeholders — they need admin auth and cross-user endpoints (a later slice).

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

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
