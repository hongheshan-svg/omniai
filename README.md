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
