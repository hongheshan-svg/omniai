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

## First Implementation Slice

This skeleton proves that the repository can host all planned product surfaces, share contracts safely, and run tests per package. Business features should be added in thin vertical slices: authentication, model catalog, text generation, image generation, video task submission, assets, credits, and orders.
