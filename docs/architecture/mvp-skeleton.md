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

The Studio Shell + Prompt Optimizer slice puts the product workflow ahead of provider integration. Desktop users see text, image, and video creation modes, each with mode-specific prompt guidance and deterministic optimization output.

The API exposes `/v1/prompt/optimize` through a local rule-based optimizer. It returns structured sections, a recommended preset, and a credit estimate without calling real AI providers or external networks.

This slice intentionally leaves generation task submission, asset persistence, billing mutations, and real provider adapters for later stages. Gateway integration must plug into the product workflow instead of driving the product architecture.

## First Implementation Slice

This skeleton proves that the repository can host all planned product surfaces, share contracts safely, and run tests per package. Business features should be added in thin vertical slices: authentication, model catalog, text generation, image generation, video task submission, assets, credits, and orders.
