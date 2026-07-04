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
The desktop also auto-polls `running` tasks every 5s (`selectRunningTaskIds` +
a `setInterval` effect keyed on the running-id set; poll reuses `getGeneration`,
401 signs out, other errors stay silent), keeping the manual "刷新状态" button.

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

## Credit Top-up Foundation Slice

`CreditService.topUp` records a positive `topup` ledger entry. `POST
/v1/credits/topup` (auth-guarded, gated by `GW_LINK_DEV_TOPUP_ENABLED` — default
off in production) credits the account directly and returns the new balance; the
gate flag is passed into `registerCreditRoutes` from the injected config at build
time (never triggering `loadConfig`). The desktop adds a fixed-amount "充值"
button. This is a dev-only direct credit; real payment channels (Stripe / Alipay
/ WeChat) will drive `topUp` via webhooks, and a package catalog / custom amounts
/ minimumPlan enforcement remain later work.

## Mobile API Integration Slice

The `apiClient` was lifted from `apps/desktop` to `packages/shared` (it is
framework-free — only `fetch` + shared contracts), so desktop and mobile import
one client from `@gw-link-omniai/shared`. The mobile app gains its first live
screen wired to the API for the core flow: passwordless login, generation
submit, task list, and balance.

Following the repo convention (state logic in framework-free modules, thin
components), the interaction logic lives in `apps/mobile/src/appModel.ts` — a
`createMobileAppController({ apiClient, tokenStore })` controller holding state
(`signedOut → signingIn → signedIn`) with `getState`/`subscribe` and the
`startLogin`/`verifyLogin`/`submitGeneration`/`restore`/`signOut` actions. It is
unit-tested directly with vitest. `apps/mobile/App.tsx` is a thin React Native
view that subscribes via `useSyncExternalStore` and is typecheck-only: RN 0.74
source (Flow+ESM) cannot render under vite-node, so component rendering is not
unit-tested — all behavior is covered at the controller layer.

The bearer token persists in the OS secure enclave via `expo-secure-store` (iOS
Keychain / Android Keystore, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) behind the
same injectable `TokenStore` interface as desktop; startup restores the token
through `getSession` and clears it if invalid. A `running` task row shows a "刷新状态" button that re-polls via
`getGeneration`, and a `succeeded` row shows a "保存到资产库" button; the
signed-in screen lists saved assets with type filters (`filterCreationAssets`).
The asset-model pure functions (`buildAssetRequestFromTask`, `filterCreationAssets`,
labels, `summarizeAssetPrompt`) were lifted to `packages/shared` so desktop and
mobile share them. Top-up, image/video rendering, and multi-screen navigation
remain later slices.

Image results (and saved image assets) render via React Native's built-in `Image`;
video results render a `posterUrl` thumbnail plus a `formatDuration` (mm:ss) label
— inline playback is deferred. `App.tsx` stays typecheck-only, so the media
rendering is not unit-tested; the framework-free `formatDuration` helper carries
the unit coverage.

Video results play inline via `expo-av` (`<Video>` with native controls and a
`usePoster` poster) through a small reused `VideoResult` component; the duration
label reuses `formatDuration`. `VideoResult` and `App.tsx` stay typecheck-only, so
actual playback is verified manually on a device/simulator rather than in the unit
suite.

The `appModel` controller also auto-polls `running` tasks every 5s
(`startAutoPoll`/`stopAutoPoll`; `pollRunning` reuses `getGeneration`, 401 signs
out and stops, other errors stay silent), started by `App.tsx` while signed-in and
stopped on cleanup. Because the polling lives in the framework-free controller, it
is fully unit-tested with fake timers (unlike the typecheck-only view).

## Admin Model Display Slice

The admin operations console makes its first live API call: the shared apiClient
gains `listModels()` (public `GET /v1/models`, no token — product fields only), and
a client component `ModelCatalogSection` fetches and renders the visible model
catalog inside the Model Display module (name + `capability · plan · creditUnitCost`
summary via the framework-free `catalogModel` helper). `AdminAppShell` threads an
optional injected `client` for testability. The other four modules (Users, Plans &
Credits, Orders, Usage Metrics) stay placeholders because the API has no admin auth
or cross-user endpoints yet — those remain a later slice.

## Payment Order Foundation Slice

This sub-slice adds the order/checkout contract without any real payment
integration. `config/credit-packages.json` (path overridable via
`GW_LINK_PACKAGES_CONFIG_PATH`) feeds a `ConfigPackageCatalog`
(`listPackages`/`getPackage`, defensively cloned like `ConfigModelCatalog`),
served publicly at `GET /v1/packages`. `OrderRepository` follows the existing
repository seam — an in-memory implementation and a Drizzle implementation
backed by a new owner-scoped `orders` table (`owner_user_id` FK, mirroring
`assets`/`credit_transactions`), locked by the same cross-backend contract
test. `OrderService` (`OrderServiceImpl`/`InMemoryOrderService`) exposes
`createOrder(userId, packageId)` — resolves the package via the catalog
(unknown id throws a 404 `OrderServiceError`), generates an id and an opaque
`checkoutRef`, and persists a `pending` order — and `listOrders(userId)`,
scoped by owner like generations/assets. `POST /v1/orders` (auth-guarded,
`isCreateOrderRequest` body validation, 400/401/404 mapped from the guard and
service errors) and `GET /v1/orders` (auth-guarded, per-user) are registered
alongside the public `GET /v1/packages` in `buildServer`. Prices are integer
`amountCents` with an ISO `currency`; orders never leave the `pending` status
in this slice — crediting the account, verifying a payment webhook's
signature (driving `CreditService.topUp`), and integrating a real payment
provider are later sub-slices.

## Payment Webhook Slice

This sub-slice (payment sub-slice B) closes the loop opened by the order
foundation: a public `POST /v1/payments/webhook` verifies a signature and
credits the buyer. `webhookSignature.ts` signs/verifies an HMAC-SHA256 over
the raw request body (hex, `x-gw-signature` header) using
`crypto.timingSafeEqual` for a constant-time comparison, so timing cannot
leak whether a signature is close to correct. `PaymentServiceImpl` assembles
the flow: an unset `paymentWebhookSecret` (`ApiConfig`, env
`GW_LINK_PAYMENT_WEBHOOK_SECRET`) throws before any verification, mapped to
`500` — the webhook never processes an unsigned or unconfigured event; a bad
signature is `401`; invalid JSON or an event failing `isPaymentWebhookEvent`
is `400`; a non-`payment.succeeded` event is acknowledged and ignored; an
unknown `checkoutRef` (via `OrderRepository.getByCheckoutRef`) is `404`. For a
known order, idempotency is enforced by only acting when `status ===
"pending"`: the service calls `OrderRepository.updateStatus(id, "paid")`
**before** `CreditService.topUp(ownerUserId, record.credits, record.id,
"purchase")`, so a redelivered event finds the order already `paid` and
returns without crediting again. The credited amount is always
`record.credits` from the stored order, never a value from the event body.
Marking paid before crediting means a `topUp` failure after the status
update leaves the order paid but uncredited — a documented limitation of the
current non-transactional repositories; the real fix is wrapping both writes
in a single DB transaction, deferred. `buildServer`/`createServices` build
one `OrderRepository` explicitly and inject it into both `OrderServiceImpl`
and `PaymentServiceImpl`, so the webhook sees orders created via `POST
/v1/orders`. Fastify's default JSON body parser is replaced with a raw-body
content-type parser that stores the exact bytes on `request.rawBody` before
parsing, since HMAC verification requires the untouched wire bytes rather
than a re-serialized object. Deferred non-goals: real Stripe/Alipay/WeChat
Pay signature formats, concurrency/row-locking around the mark-paid-then-credit
sequence, `payment.failed` handling, refunds, and the client checkout UI —
all sub-slice C.

## Desktop Checkout Slice

This sub-slice (payment sub-slice C) closes the loop end to end with a
desktop checkout UI. `apiClient` gains four methods: `listPackages()`
(public), `createOrder(packageId, token)`, `listOrders(token)`, and
`devCompletePayment(orderId, token)`. `OrderService` gains
`getOrder(userId, orderId): Promise<Order | null>`, an owner-scoped lookup
used by the new route. `registerPaymentRoutes` is refactored to a deps
object (`{ paymentService, orderService, authService, secret,
devPaymentsEnabled }`) and adds a dev-gated `POST /v1/payments/dev-complete`:
auth-guarded, it looks up the caller's order via `getOrder` (404 if missing
or not owned), server-side signs a `payment.succeeded` event for the order's
`checkoutRef` with `config.paymentWebhookSecret`, and feeds it straight into
the real `PaymentService.handleWebhookEvent` — reusing the audited
verify + idempotent + credit path rather than duplicating it, so the client
never sees the signing secret. `ApiConfig.devPaymentsEnabled` (env
`GW_LINK_DEV_PAYMENTS_ENABLED`, parsed identically to `devTopupEnabled`)
gates the route with `403` and defaults off in production, on otherwise.
The desktop adds a package-checkout section (`orderModel.ts`:
`formatPackagePrice`, `getOrderStatusLabel`) alongside the existing
fixed-100 "充值" dev top-up button: "购买" creates an order, immediately
calls `devCompletePayment`, then reloads the balance and order list. Real
payment-provider checkout pages/redirects and mobile checkout are later
work.

## Order Details & Receipt Slice

`Order` gains an optional additive `paidAt` (ISO), persisted through the
repository seam: `OrderRecord.paidAt`, a nullable `paid_at` column
(migration `0005`), and a widened `OrderRepository.updateStatus(id, status,
paidAt?)`. `PaymentServiceImpl` takes an injected `clock` and stamps
`paidAt = clock.now()` when it marks an order paid in the webhook credit
path; idempotent re-delivery does not overwrite it. The desktop renders
order detail and, for paid orders, a receipt entirely client-side from the
existing `listOrders` data — no new endpoint. `orderModel.ts` adds
`formatMoney`, `formatDateTime`, and `buildReceiptLines`; `App.tsx` adds a
`selectedOrderId` inline expander. Deferred: a `GET /v1/orders/:id`
endpoint, mobile order UI, real tax invoices (fapiao/title/tax id), and
receipt export/print.

## Mobile Checkout Slice

The order-presentation helpers move from `apps/desktop/src/orderModel.ts`
into `@gw-link-omniai/shared` (`orderView.ts`); the desktop `orderModel.ts`
becomes a thin re-export so its imports are unchanged, and both desktop and
mobile consume one source. The mobile controller (`appModel.ts`) gains
`packages`/`orders`/`selectedOrderId` state, loads packages + orders in
`loadUserData`, and adds `buyPackage` (createOrder → devCompletePayment →
refresh balance + orders; 401 → sign out) and `selectOrder`. `App.tsx`
(typecheck-only) renders a packages list, an orders list with an inline
查看/收起 detail block, and a receipt for paid orders. Deferred: real
payment-provider checkout, receipt export/print.

## Receipt Export Slice

`@gw-link-omniai/shared` adds `buildReceiptText(order, packageName)` — a
plain-text receipt built from `buildReceiptLines` (`"收据"` + one
`label：value` line each). The desktop `App.tsx` gains an injectable
`copyText` prop (default `navigator.clipboard.writeText`) and a "复制收据"
button inside the paid-order receipt block; success shows a `role="status"`
"已复制收据", failure sets `actionError`. Desktop-only; PDF/print/file export
deferred.

## Admin Orders Dashboard Slice

`OrderRepository.listAll()` returns every owner's orders (memory + Drizzle,
ordered by `createdAt`); `OrderService.listAllOrders()` maps them to `Order`.
`GET /v1/admin/orders` is authenticated and admin-gated, not public:
`createAdminGuard(authService, adminEmails)` resolves the bearer token and
returns `401` when unauthenticated, `403 { error: "Admin access required" }`
when the caller's email is not in the `GW_LINK_ADMIN_EMAILS` allowlist. Past
the guard, `devAdminEnabled` (`GW_LINK_DEV_ADMIN_ENABLED`) is an additional
kill-switch — `403 { error: "Admin orders are disabled" }` when off, default
on outside production and off in production — and `parseDevAdminEnabled`
throws at boot if `GW_LINK_DEV_ADMIN_ENABLED=true` with
`NODE_ENV=production`, so the flag can never be live in production.
`apiClient.listAllOrders(token)` sends the bearer token to the endpoint. The
admin console gains a framework-free passwordless login controller
(`adminAuthModel.ts`, mirroring the mobile `appModel` shape: `startLogin` →
`verify` → a session token) wired into `appShell`; `OrdersSection` shows
"请先登录" until an admin is signed in, then calls `listAllOrders(token)` and
renders `summarizeOrders` (counts + paid-only revenue and credits) plus an
order table. Deferred: real RBAC/roles, a transactions dashboard, and
filtering/pagination.
