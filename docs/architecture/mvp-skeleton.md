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
