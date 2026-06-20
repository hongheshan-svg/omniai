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
