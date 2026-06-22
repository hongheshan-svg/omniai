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

Production-ready auth follow-up work should replace the in-memory service with persistent storage, add real SMS/email delivery, keep `devCode` disabled (`NODE_ENV=production` defaults `GW_LINK_AUTH_DEV_CODES_ENABLED` to `false`), add refresh-token rotation, and introduce device/session management.

## Product-First Studio Slice

The Studio Shell + Prompt Optimizer slice puts the product workflow ahead of provider integration. Desktop users see text, image, and video creation modes, each with mode-specific prompt guidance and rule-based local structured optimization output.

The API exposes `/v1/prompt/optimize` through a local rule-based optimizer. It returns structured sections, a recommended preset, and a credit estimate without calling real AI providers or external networks.

This slice intentionally leaves generation task submission, asset persistence, billing mutations, and real provider adapters for later stages. Gateway integration must plug into the product workflow instead of driving the product architecture.

## Unified Generation Task Slice

The unified generation task slice connects Studio prompt optimization to product-level task submission. Text, image, and video tasks share `GenerationTaskRequest` and `GenerationTask`, so later provider adapters can implement one stable product contract instead of shaping the product API.

The API exposes `/v1/generations` through an in-memory task service. Tasks are queued and listable inside the current API process, but this slice intentionally does not persist tasks, create assets, call real providers, or mutate credits.

Desktop submission remains local in this slice. The UI proves the user workflow from optimized prompt to task center while keeping HTTP client, auth token handling, persistence, and provider execution for later stages.

## Asset Library Slice

The asset library slice turns generated task output into reusable product assets. Text, image, and video assets share `CreationAssetRequest` and `CreationAsset`, keeping provider responses and storage details behind later adapter and persistence stages.

The API exposes `/v1/assets` through an in-memory asset service. Assets are listable inside the current API process, but this slice intentionally does not persist assets, upload files, call real providers, sync across devices, or mutate credits.

Desktop asset saving remains local in this slice. The UI proves the workflow from task center to filtered asset library while keeping HTTP client, auth token handling, persistent storage, file lifecycle, and real provider output for later stages.

## Provider Adapter Foundation Slice

The provider adapter foundation keeps provider configuration behind the product API. Product requests still use `GenerationTaskRequest`, while the API resolves `preset.modelId` through an internal model catalog before submitting a fake provider dry-run.

`config/models.json` declares product model IDs, provider model IDs, provider protocol, provider base URL, API key environment names, visibility, plan level, tags, and credit unit cost. `/v1/models` exposes only product-facing fields; provider details stay server-side.

The fake provider adapter supports OpenAI-compatible and Anthropic-compatible protocol dispatch without reading API keys or making network calls. This prepares the codebase for real provider HTTP clients without turning GW-LINK OmniAI into a gateway product or changing the text, image, and video creation workflow.

## First Implementation Slice

This skeleton proves that the repository can host all planned product surfaces, share contracts safely, and run tests per package. Business features should be added in thin vertical slices: authentication, model catalog, text generation, image generation, video task submission, assets, credits, and orders.

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

## Per-User Isolation Slice

The per-user isolation slice scopes generation tasks and assets to the
authenticated user without changing product contracts, route paths, or
response shapes. A Fastify `preHandler` auth guard resolves the bearer token
through the existing auth session service and attaches the user id to the
request; `/v1/generations` and `/v1/assets` (read and write) require it, while
the model catalog, prompt optimizer, auth, and health routes stay public.

The services thread the authenticated user id into the repositories, which
write `owner_user_id` and filter lists by it. No database migration is needed —
the `owner_user_id` columns were reserved in the Persistence Foundation slice.
Isolation is enforced at the application layer; Postgres row-level security,
refresh tokens, roles, and admin cross-user access remain later slices.

## Desktop ↔ API Integration Slice

The desktop integration slice connects the primary creation workspace to the
product API. A framework-free, fetch-injectable API client (`apiClient.ts`)
wraps the product endpoints; `App.tsx` takes an injected client and runs the
passwordless login flow, then optimizes prompts, submits generations, and lists
the user's tasks and assets through the guarded API with a bearer token held in
React memory. The API enables CORS so the Tauri webview / Vite dev server can
call it across origins.

Asset creation from the desktop is intentionally deferred: the API requires a
succeeded source task, and tasks remain queued until a later task-status /
real-provider slice, so the asset library is read-only here. Admin and mobile
remain local; token persistence, real providers, and streaming are later slices.

## Real Text Provider Slice

The real text provider slice makes text generation produce actual content. The
default provider adapter (`OpenAiCompatibleTextProvider`) calls an OpenAI-
compatible `chat/completions` endpoint synchronously when a text model's
`apiKeyEnv` is configured, returning a `succeeded` task with an optional
`GenerationTask.result` (text). Without a key, or for image/video, it falls
back to the prior `queued` placeholder, so existing behavior and tests are
unchanged. Provider keys stay in env and are never exposed across the product
boundary; provider failures return 502 without persisting a task.

Generation is synchronous here — async queues/workers, streaming, image/video
providers, the anthropic-compatible path, credit deduction, and saving a
succeeded task as an asset remain later slices.

## Desktop Asset Save Slice

With real text generation producing `succeeded` tasks (Real Text Provider
slice), the desktop can now save a generated text task as an asset. A
framework-free `buildAssetRequestFromTask` maps a succeeded text task to a
`CreationAssetRequest` (content from the task's text result, source
`taskStatus: "succeeded"`), and the App posts it through `apiClient.createAsset`
to the existing guarded `/v1/assets` route, then refreshes the per-user asset
library. No backend or shared-contract change was needed. Image and video stay
`queued` (no result) and are not yet saveable; object storage and saving
image/video assets remain later slices.

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

## Desktop Credit Balance Slice

The desktop closes the credit-foundation loop on the client. `apiClient` gains
`getCreditBalance`, a framework-free `formatCreditBalance` renders "积分：N", and
`App.tsx` loads the balance on login (in the same `Promise.all` as tasks/assets),
refreshes it after each generation, clears it on sign-out, and maps an
insufficient-credit `402` from `POST /v1/generations` to a friendly
"积分不足，无法生成" message (reactive — no proactive button disabling, since the
client's `creditEstimate` may differ from the server's authoritative
`creditUnitCost`). No backend or shared-contract change. Top-up/payment and
admin/mobile balance display remain later slices.

## Real Image Provider Slice

Image generation produces actual images. `GenerationTaskResult` gains an
`image` variant (`{ kind, url, alt }`, identical to the image asset content).
`OpenAiCompatibleImageProvider` calls the OpenAI-compatible `images/generations`
endpoint and returns the image as an inline `data:` URL (b64 → data URL, or a
passed-through provider URL); a `CompositeProviderAdapter` routes generation by
mode (image → image provider, else → text provider) and is the default adapter.
The generation service, persistence, and credit deduction are unchanged (the
result passes through generically; image costs `creditUnitCost` = 2). The
desktop renders generated images and saves them as assets. Object storage (real
file URLs instead of inline base64), image parameters, and real video generation
remain later slices.

## Object Storage Slice

Generated images are stored in an `ObjectStore` (interface + `InMemoryObjectStore`
default + `LocalFileObjectStore` when `GW_LINK_OBJECT_STORE_DIR` is set), mirroring
the repository seam. The image provider takes an injected store: it `put`s the
decoded bytes and returns `${GW_LINK_PUBLIC_BASE_URL}/files/<id>` (opaque id with a
content-type extension), falling back to an inline `data:` URL when no store is
given. A public `GET /files/:id` route streams the bytes; `LocalFileObjectStore`
rejects ids that are not the generated `${uuid}.${ext}` shape so the route can
never traverse outside the store directory. One store instance is shared between
the image provider and the file route. The generation service, persistence,
credits, desktop, and shared contracts are unchanged. Cloud backends (Supabase
Storage / S3) behind the same interface, per-user ACL / signed URLs, and
non-image files remain later slices.

## Session Token Persistence Slice

The desktop bearer token survives restarts. An injectable `TokenStore`
(interface + `createLocalStorageTokenStore` default, a no-op when `localStorage`
is absent) holds the token; `apiClient` gains `getSession` (`GET /v1/auth/session`).
On mount, `App` loads any stored token and validates it via `getSession`:
authenticated → restore the session and load tasks/assets/balance; otherwise
(not authenticated or error) → clear the token and stay signed out. The token is
saved on login and cleared on logout/401. No backend or shared-contract change.
An OS keychain / Tauri secure store behind the same `TokenStore` interface, and
refresh-token/session renewal, remain later slices.

## Async Generation Lifecycle Slice

The async generation machinery (slice 11a, fake provider). `submitGeneration`
may return `running` + a `providerRef` (server-internal, stored in
`generation_tasks.provider_ref`, never in `GenerationTask`); `ProviderAdapter`
gains optional `pollGeneration`. `CompositeProviderAdapter` routes submit/poll by
mode (text/image/video). The repository gains `get`/`update`; the generation
service persists running tasks without charging and exposes `refreshTask`
(re-poll, persist, deduct on `running → succeeded`). `GET /v1/generations/:id`
re-polls on read (no worker); the desktop adds a per-running-task refresh button.
A `FakeAsyncProvider` (submit→running, poll→succeeds after N) proves it
end-to-end; production video stays `queued`. The real async video provider, a
video-specific result variant, background polling, and a desktop auto-poll
remain slice 11b / later.

## Real Video Provider Slice

`AsyncVideoProvider` is the real async video provider (slice 11b), plugged into
the async lifecycle as the default composite `video` slot. It submits to
`POST {baseUrl}/videos/generations` (→ running + job ref) and polls
`GET {baseUrl}/videos/generations/{id}` (completed → `succeeded` + a `video`
`GenerationTaskResult` variant `{ url, durationSeconds, posterUrl }`, identical
to the asset video content; failed → `failed`; else → running). The video URL is
the service-hosted URL passed through (no object storage). The generation
service, `refreshTask`, persistence, and credits are unchanged (charge
`creditUnitCost` = 3 once on `running → succeeded`). The desktop renders
`<video>` and saves video assets. The provider targets a generic async
video-job shape; production points the video model's provider at a real service.
Object storage for video bytes, a specific vendor integration, and thumbnail
generation remain later work.
