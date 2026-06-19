# GW-LINK OmniAI MVP Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable monorepo skeleton for GW-LINK OmniAI, covering shared domain contracts, product API, admin web shell, desktop shell, and mobile shell.

**Architecture:** Use a TypeScript monorepo with one shared package and four app packages. The shared package owns product-facing contracts, the API app owns account/usage/gateway-adapter boundaries, and each client consumes shared contracts without knowing third-party model provider details.

**Tech Stack:** pnpm workspaces, TypeScript, Vitest, Fastify, React, Vite, Tauri, Next.js, Expo.

---

## Scope Check

The approved PRD covers several independent subsystems: desktop, mobile, admin, product backend, billing, assets, and AI gateway adaptation. This plan intentionally implements only the first slice: a working engineering skeleton and the interfaces that let each subsystem grow independently. It does not implement real authentication, payment, file storage, App Store packaging, or production model calls.

## File Structure

- Create: `package.json` - root workspace scripts and package manager metadata.
- Create: `pnpm-workspace.yaml` - workspace package discovery.
- Create: `tsconfig.base.json` - shared TypeScript compiler options.
- Create: `.gitignore` - ignores dependencies, builds, local env files, and brainstorming artifacts.
- Create: `README.md` - local development entry point.
- Create: `tests/workspace.test.mjs` - Node test that verifies workspace skeleton integrity.
- Create: `packages/shared/package.json` - shared package manifest.
- Create: `packages/shared/tsconfig.json` - shared package TypeScript config.
- Create: `packages/shared/src/index.ts` - public shared exports.
- Create: `packages/shared/src/models.ts` - model capability and generation task contracts.
- Create: `packages/shared/src/credits.ts` - credit estimation helpers.
- Create: `packages/shared/src/__tests__/credits.test.ts` - credit helper tests.
- Create: `apps/api/package.json` - API app manifest.
- Create: `apps/api/tsconfig.json` - API app TypeScript config.
- Create: `apps/api/src/config.ts` - environment configuration parser.
- Create: `apps/api/src/server.ts` - Fastify app factory.
- Create: `apps/api/src/routes/health.ts` - health route.
- Create: `apps/api/src/routes/models.ts` - model catalog route.
- Create: `apps/api/src/services/modelCatalog.ts` - product-facing model catalog.
- Create: `apps/api/src/services/gatewayClient.ts` - GW-LINK gateway adapter boundary.
- Create: `apps/api/src/__tests__/server.test.ts` - API route tests.
- Create: `apps/admin/package.json` - admin web app manifest.
- Create: `apps/admin/tsconfig.json` - admin TypeScript config.
- Create: `apps/admin/next.config.mjs` - Next.js config.
- Create: `apps/admin/app/page.tsx` - admin home page.
- Create: `apps/admin/src/appShell.tsx` - testable admin shell component.
- Create: `apps/admin/src/__tests__/appShell.test.tsx` - admin shell tests.
- Create: `apps/desktop/package.json` - desktop app manifest.
- Create: `apps/desktop/tsconfig.json` - desktop TypeScript config.
- Create: `apps/desktop/index.html` - Vite entry HTML.
- Create: `apps/desktop/vite.config.ts` - desktop Vite config.
- Create: `apps/desktop/src/App.tsx` - desktop shell component.
- Create: `apps/desktop/src/main.tsx` - desktop React entry.
- Create: `apps/desktop/src/__tests__/App.test.tsx` - desktop shell tests.
- Create: `apps/desktop/src-tauri/tauri.conf.json` - Tauri application config.
- Create: `apps/desktop/src-tauri/Cargo.toml` - Tauri Rust package manifest.
- Create: `apps/desktop/src-tauri/src/main.rs` - Tauri Rust entry point.
- Create: `apps/mobile/package.json` - mobile app manifest.
- Create: `apps/mobile/tsconfig.json` - mobile TypeScript config.
- Create: `apps/mobile/app.json` - Expo config.
- Create: `apps/mobile/App.tsx` - mobile app entry.
- Create: `apps/mobile/src/homeModel.ts` - testable mobile home model.
- Create: `apps/mobile/src/__tests__/homeModel.test.ts` - mobile home model tests.
- Create: `docs/architecture/mvp-skeleton.md` - architecture notes for the skeleton.

## Task 1: Root Workspace Skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `tests/workspace.test.mjs`

- [ ] **Step 1: Write the failing workspace integrity test**

Create `tests/workspace.test.mjs`:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const requiredPaths = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "packages/shared/package.json",
  "apps/api/package.json",
  "apps/admin/package.json",
  "apps/desktop/package.json",
  "apps/mobile/package.json"
];

test("workspace skeleton has required package manifests", () => {
  for (const path of requiredPaths) {
    assert.equal(existsSync(path), true, `${path} should exist`);
  }
});

test("root package declares expected workspaces", () => {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(rootPackage.private, true);
  assert.equal(rootPackage.name, "gw-link-omniai");
  assert.deepEqual(rootPackage.workspaces, ["apps/*", "packages/*"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/workspace.test.mjs
```

Expected: FAIL because the root workspace files and package manifests do not exist yet.

- [ ] **Step 3: Create the root workspace files**

Create `package.json`:

```json
{
  "name": "gw-link-omniai",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "test": "node --test tests/workspace.test.mjs && pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev:api": "pnpm --filter @gw-link-omniai/api dev",
    "dev:admin": "pnpm --filter @gw-link-omniai/admin dev",
    "dev:desktop": "pnpm --filter @gw-link-omniai/desktop dev",
    "dev:mobile": "pnpm --filter @gw-link-omniai/mobile dev"
  },
  "devDependencies": {
    "@types/node": "^20.11.30",
    "typescript": "^5.4.5"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@gw-link-omniai/shared": [
        "packages/shared/src/index.ts"
      ]
    }
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
build/
.next/
.expo/
.turbo/
.tauri/
target/
coverage/
.env
.env.*
!.env.example
.DS_Store
.superpowers/
```

Create `README.md`:

```md
# GW-LINK OmniAI

GW-LINK OmniAI is a multi-platform AI creation product for text chat, image generation, and video generation.

## Repository Layout

- `apps/api` - product API and GW-LINK AI gateway adapter boundary
- `apps/admin` - internal operations admin web app
- `apps/desktop` - Windows, macOS, and Linux desktop app shell
- `apps/mobile` - iOS and Android app shell
- `packages/shared` - shared product contracts and helpers
- `docs/superpowers/specs` - approved product specs
- `docs/superpowers/plans` - implementation plans

## First-Time Setup

```bash
pnpm install
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
```

- [ ] **Step 4: Create placeholder package manifests for workspace test**

Create `packages/shared/package.json`:

```json
{
  "name": "@gw-link-omniai/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

Create `apps/api/package.json`:

```json
{
  "name": "@gw-link-omniai/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gw-link-omniai/shared": "workspace:*",
    "fastify": "^4.26.2"
  },
  "devDependencies": {
    "tsx": "^4.7.1",
    "vitest": "^1.6.0"
  }
}
```

Create `apps/admin/package.json`:

```json
{
  "name": "@gw-link-omniai/admin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gw-link-omniai/shared": "workspace:*",
    "next": "^14.2.3",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@testing-library/react": "^15.0.7",
    "@types/react": "^18.2.74",
    "@types/react-dom": "^18.2.24",
    "jsdom": "^24.0.0",
    "vitest": "^1.6.0"
  }
}
```

Create `apps/desktop/package.json`:

```json
{
  "name": "@gw-link-omniai/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "tauri": "tauri",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gw-link-omniai/shared": "workspace:*",
    "@tauri-apps/api": "^2.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/react": "^15.0.7",
    "@types/react": "^18.2.74",
    "@types/react-dom": "^18.2.24",
    "@vitejs/plugin-react": "^4.2.1",
    "jsdom": "^24.0.0",
    "vite": "^5.2.8",
    "vitest": "^1.6.0"
  }
}
```

Create `apps/mobile/package.json`:

```json
{
  "name": "@gw-link-omniai/mobile",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "expo start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gw-link-omniai/shared": "workspace:*",
    "expo": "^51.0.0",
    "react": "^18.2.0",
    "react-native": "^0.74.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.74",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 5: Run the workspace integrity test**

Run:

```bash
node --test tests/workspace.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore README.md tests/workspace.test.mjs packages/shared/package.json apps/api/package.json apps/admin/package.json apps/desktop/package.json apps/mobile/package.json
git commit -m "chore: create monorepo workspace"
```

## Task 2: Shared Product Contracts

**Files:**
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/models.ts`
- Create: `packages/shared/src/credits.ts`
- Create: `packages/shared/src/__tests__/credits.test.ts`

- [ ] **Step 1: Write the failing credit estimation tests**

Create `packages/shared/src/__tests__/credits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateCreditCost } from "../credits";

describe("estimateCreditCost", () => {
  it("estimates text cost from token count", () => {
    expect(
      estimateCreditCost({
        capability: "text",
        estimatedInputTokens: 600,
        estimatedOutputTokens: 1400
      })
    ).toEqual({ credits: 2, unit: "credit" });
  });

  it("estimates image cost from image count and quality multiplier", () => {
    expect(
      estimateCreditCost({
        capability: "image",
        imageCount: 4,
        quality: "high"
      })
    ).toEqual({ credits: 8, unit: "credit" });
  });

  it("estimates video cost from duration seconds and resolution multiplier", () => {
    expect(
      estimateCreditCost({
        capability: "video",
        durationSeconds: 6,
        resolution: "1080p"
      })
    ).toEqual({ credits: 18, unit: "credit" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test
```

Expected: FAIL because `packages/shared/src/credits.ts` does not exist.

- [ ] **Step 3: Implement shared contracts and credit estimation**

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": [
    "src"
  ]
}
```

Create `packages/shared/src/models.ts`:

```ts
export type ModelCapability = "text" | "image" | "video";

export type ModelVisibility = "visible" | "hidden" | "maintenance";

export type PlanCode = "free" | "pro" | "studio";

export interface ProductModel {
  id: string;
  displayName: string;
  capability: ModelCapability;
  tags: string[];
  visibility: ModelVisibility;
  minimumPlan: PlanCode;
  creditUnitCost: number;
}

export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface GenerationTask {
  id: string;
  capability: ModelCapability;
  status: GenerationTaskStatus;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  creditEstimate: CreditAmount;
}

export interface CreditAmount {
  credits: number;
  unit: "credit";
}
```

Create `packages/shared/src/credits.ts`:

```ts
import type { CreditAmount } from "./models";

export type CreditEstimateInput =
  | {
      capability: "text";
      estimatedInputTokens: number;
      estimatedOutputTokens: number;
    }
  | {
      capability: "image";
      imageCount: number;
      quality: "standard" | "high";
    }
  | {
      capability: "video";
      durationSeconds: number;
      resolution: "720p" | "1080p";
    };

export function estimateCreditCost(input: CreditEstimateInput): CreditAmount {
  if (input.capability === "text") {
    const totalTokens = input.estimatedInputTokens + input.estimatedOutputTokens;
    return { credits: Math.max(1, Math.ceil(totalTokens / 1000)), unit: "credit" };
  }

  if (input.capability === "image") {
    const qualityMultiplier = input.quality === "high" ? 2 : 1;
    return { credits: input.imageCount * qualityMultiplier, unit: "credit" };
  }

  const resolutionMultiplier = input.resolution === "1080p" ? 3 : 2;
  return {
    credits: Math.ceil(input.durationSeconds) * resolutionMultiplier,
    unit: "credit"
  };
}
```

Create `packages/shared/src/index.ts`:

```ts
export type {
  CreditAmount,
  GenerationTask,
  GenerationTaskStatus,
  ModelCapability,
  ModelVisibility,
  PlanCode,
  ProductModel
} from "./models";
export { estimateCreditCost } from "./credits";
export type { CreditEstimateInput } from "./credits";
```

- [ ] **Step 4: Run shared tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/shared test
pnpm --filter @gw-link-omniai/shared typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat: add shared product contracts"
```

## Task 3: Product API Skeleton and Gateway Boundary

**Files:**
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/models.ts`
- Create: `apps/api/src/services/modelCatalog.ts`
- Create: `apps/api/src/services/gatewayClient.ts`
- Create: `apps/api/src/__tests__/server.test.ts`

- [ ] **Step 1: Write failing API route tests**

Create `apps/api/src/__tests__/server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../server";

describe("product API", () => {
  it("returns service health", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: "gw-link-omniai-api",
      status: "ok"
    });
  });

  it("returns product-facing model catalog", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/v1/models" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      models: [
        {
          id: "gw-text-balanced",
          displayName: "OmniAI Text Balanced",
          capability: "text",
          tags: ["recommended", "balanced"],
          visibility: "visible",
          minimumPlan: "free",
          creditUnitCost: 1
        },
        {
          id: "gw-image-creative",
          displayName: "OmniAI Image Creative",
          capability: "image",
          tags: ["creative", "high-quality"],
          visibility: "visible",
          minimumPlan: "pro",
          creditUnitCost: 2
        },
        {
          id: "gw-video-motion",
          displayName: "OmniAI Video Motion",
          capability: "video",
          tags: ["motion", "async-task"],
          visibility: "visible",
          minimumPlan: "studio",
          creditUnitCost: 3
        }
      ]
    });
  });
});
```

- [ ] **Step 2: Run the API tests to verify failure**

Run:

```bash
pnpm --filter @gw-link-omniai/api test
```

Expected: FAIL because the API source files do not exist.

- [ ] **Step 3: Implement the API skeleton**

Create `apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": [
      "node"
    ]
  },
  "include": [
    "src"
  ]
}
```

Create `apps/api/src/config.ts`:

```ts
export interface ApiConfig {
  port: number;
  gatewayBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: Number(env.PORT ?? 8787),
    gatewayBaseUrl: env.GW_LINK_GATEWAY_BASE_URL ?? "https://gateway.gw-link.local"
  };
}
```

Create `apps/api/src/services/modelCatalog.ts`:

```ts
import type { ProductModel } from "@gw-link-omniai/shared";

export function listProductModels(): ProductModel[] {
  return [
    {
      id: "gw-text-balanced",
      displayName: "OmniAI Text Balanced",
      capability: "text",
      tags: ["recommended", "balanced"],
      visibility: "visible",
      minimumPlan: "free",
      creditUnitCost: 1
    },
    {
      id: "gw-image-creative",
      displayName: "OmniAI Image Creative",
      capability: "image",
      tags: ["creative", "high-quality"],
      visibility: "visible",
      minimumPlan: "pro",
      creditUnitCost: 2
    },
    {
      id: "gw-video-motion",
      displayName: "OmniAI Video Motion",
      capability: "video",
      tags: ["motion", "async-task"],
      visibility: "visible",
      minimumPlan: "studio",
      creditUnitCost: 3
    }
  ];
}
```

Create `apps/api/src/services/gatewayClient.ts`:

```ts
import type { GenerationTask, ModelCapability } from "@gw-link-omniai/shared";

export interface GatewayGenerationRequest {
  capability: ModelCapability;
  modelId: string;
  prompt: string;
  userId: string;
}

export interface GatewayClient {
  submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask>;
}

export class GwLinkGatewayClient implements GatewayClient {
  constructor(private readonly baseUrl: string) {}

  async submitGeneration(request: GatewayGenerationRequest): Promise<GenerationTask> {
    const now = new Date().toISOString();

    return {
      id: `task_${request.capability}_${request.modelId}`,
      capability: request.capability,
      status: "queued",
      modelId: request.modelId,
      createdAt: now,
      updatedAt: now,
      creditEstimate: {
        credits: 1,
        unit: "credit"
      }
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
```

Create `apps/api/src/routes/health.ts`:

```ts
import type { FastifyInstance } from "fastify";

export async function registerHealthRoute(server: FastifyInstance): Promise<void> {
  server.get("/health", async () => ({
    service: "gw-link-omniai-api",
    status: "ok"
  }));
}
```

Create `apps/api/src/routes/models.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { listProductModels } from "../services/modelCatalog";

export async function registerModelRoutes(server: FastifyInstance): Promise<void> {
  server.get("/v1/models", async () => ({
    models: listProductModels()
  }));
}
```

Create `apps/api/src/server.ts`:

```ts
import Fastify from "fastify";
import { loadConfig } from "./config";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";

export function buildServer() {
  const server = Fastify({
    logger: false
  });

  void registerHealthRoute(server);
  void registerModelRoutes(server);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const server = buildServer();

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });

  console.log(`GW-LINK OmniAI API listening on ${config.port}`);
}
```

- [ ] **Step 4: Run API tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/api test
pnpm --filter @gw-link-omniai/api typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add product api skeleton"
```

## Task 4: Admin Web Shell

**Files:**
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/next.config.mjs`
- Create: `apps/admin/app/page.tsx`
- Create: `apps/admin/src/appShell.tsx`
- Create: `apps/admin/src/__tests__/appShell.test.tsx`

- [ ] **Step 1: Write the failing admin shell test**

Create `apps/admin/src/__tests__/appShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminAppShell } from "../appShell";

describe("AdminAppShell", () => {
  it("renders the operations modules required by the PRD", () => {
    render(<AdminAppShell />);

    expect(screen.getByText("GW-LINK OmniAI Admin")).toBeTruthy();
    expect(screen.getByText("Users")).toBeTruthy();
    expect(screen.getByText("Plans & Credits")).toBeTruthy();
    expect(screen.getByText("Model Display")).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Usage Metrics")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the admin test to verify failure**

Run:

```bash
pnpm --filter @gw-link-omniai/admin test
```

Expected: FAIL because `AdminAppShell` does not exist.

- [ ] **Step 3: Implement the admin shell**

Create `apps/admin/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ]
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": [
    "node_modules"
  ]
}
```

Create `apps/admin/next.config.mjs`:

```js
/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@gw-link-omniai/shared"]
};

export default nextConfig;
```

Create `apps/admin/src/appShell.tsx`:

```tsx
const modules = [
  "Users",
  "Plans & Credits",
  "Model Display",
  "Orders",
  "Usage Metrics"
];

export function AdminAppShell() {
  return (
    <main>
      <h1>GW-LINK OmniAI Admin</h1>
      <p>Operations console for the commercial AI creation product.</p>
      <section aria-label="Operations modules">
        {modules.map((module) => (
          <article key={module}>
            <h2>{module}</h2>
          </article>
        ))}
      </section>
    </main>
  );
}
```

Create `apps/admin/app/page.tsx`:

```tsx
import { AdminAppShell } from "../src/appShell";

export default function Page() {
  return <AdminAppShell />;
}
```

- [ ] **Step 4: Run admin tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/admin test
pnpm --filter @gw-link-omniai/admin typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat: add admin app shell"
```

## Task 5: Desktop App Shell

**Files:**
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/__tests__/App.test.tsx`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Write the failing desktop shell test**

Create `apps/desktop/src/__tests__/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";

describe("Desktop App", () => {
  it("renders the three core creation modes", () => {
    render(<App />);

    expect(screen.getByText("GW-LINK OmniAI")).toBeTruthy();
    expect(screen.getByText("Text Chat")).toBeTruthy();
    expect(screen.getByText("Image Generation")).toBeTruthy();
    expect(screen.getByText("Video Generation")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the desktop test to verify failure**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test
```

Expected: FAIL because `App` does not exist.

- [ ] **Step 3: Implement the desktop React shell and Tauri config**

Create `apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": [
      "vite/client",
      "node"
    ],
    "noEmit": true
  },
  "include": [
    "src",
    "vite.config.ts"
  ]
}
```

Create `apps/desktop/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GW-LINK OmniAI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/desktop/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true
  },
  test: {
    environment: "jsdom"
  }
});
```

Create `apps/desktop/src/App.tsx`:

```tsx
const creationModes = [
  "Text Chat",
  "Image Generation",
  "Video Generation"
];

export function App() {
  return (
    <main>
      <h1>GW-LINK OmniAI</h1>
      <p>One workspace for text, image, and video AI creation.</p>
      <nav aria-label="Creation modes">
        {creationModes.map((mode) => (
          <button key={mode} type="button">
            {mode}
          </button>
        ))}
      </nav>
    </main>
  );
}
```

Create `apps/desktop/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Create `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "GW-LINK OmniAI",
  "version": "0.1.0",
  "identifier": "com.gw-link.omniai",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "GW-LINK OmniAI",
        "width": 1200,
        "height": 800
      }
    ],
    "security": {
      "csp": null
    }
  }
}
```

Create `apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "gw-link-omniai-desktop"
version = "0.1.0"
description = "GW-LINK OmniAI desktop shell"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
tauri-build = "2"

[build-dependencies]
tauri-build = "2"
```

Create `apps/desktop/src-tauri/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run GW-LINK OmniAI desktop app");
}
```

- [ ] **Step 4: Run desktop tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/desktop test
pnpm --filter @gw-link-omniai/desktop typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat: add desktop app shell"
```

## Task 6: Mobile App Shell

**Files:**
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/app.json`
- Create: `apps/mobile/App.tsx`
- Create: `apps/mobile/src/homeModel.ts`
- Create: `apps/mobile/src/__tests__/homeModel.test.ts`

- [ ] **Step 1: Write the failing mobile home model test**

Create `apps/mobile/src/__tests__/homeModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getMobileHomeActions } from "../homeModel";

describe("getMobileHomeActions", () => {
  it("returns the mobile-first creation and history actions", () => {
    expect(getMobileHomeActions()).toEqual([
      "Text Chat",
      "Image Generation",
      "Video Generation",
      "Creation History",
      "Task Notifications"
    ]);
  });
});
```

- [ ] **Step 2: Run the mobile test to verify failure**

Run:

```bash
pnpm --filter @gw-link-omniai/mobile test
```

Expected: FAIL because `homeModel` does not exist.

- [ ] **Step 3: Implement the Expo shell**

Create `apps/mobile/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": [
    "App.tsx",
    "src"
  ]
}
```

Create `apps/mobile/app.json`:

```json
{
  "expo": {
    "name": "GW-LINK OmniAI",
    "slug": "gw-link-omniai",
    "version": "0.1.0",
    "orientation": "portrait",
    "scheme": "gwlinkomniai",
    "ios": {
      "bundleIdentifier": "com.gw-link.omniai"
    },
    "android": {
      "package": "com.gwlink.omniai"
    }
  }
}
```

Create `apps/mobile/src/homeModel.ts`:

```ts
export function getMobileHomeActions(): string[] {
  return [
    "Text Chat",
    "Image Generation",
    "Video Generation",
    "Creation History",
    "Task Notifications"
  ];
}
```

Create `apps/mobile/App.tsx`:

```tsx
import { SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { getMobileHomeActions } from "./src/homeModel";

export default function App() {
  return (
    <SafeAreaView>
      <View>
        <Text>GW-LINK OmniAI</Text>
        <Text>Text, image, and video AI creation on the go.</Text>
        {getMobileHomeActions().map((action) => (
          <TouchableOpacity key={action}>
            <Text>{action}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}
```

- [ ] **Step 4: Run mobile tests and typecheck**

Run:

```bash
pnpm --filter @gw-link-omniai/mobile test
pnpm --filter @gw-link-omniai/mobile typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat: add mobile app shell"
```

## Task 7: Architecture Notes and Full Workspace Validation

**Files:**
- Create: `docs/architecture/mvp-skeleton.md`
- Modify: `README.md`

- [ ] **Step 1: Write architecture notes**

Create `docs/architecture/mvp-skeleton.md`:

```md
# GW-LINK OmniAI MVP Skeleton Architecture

## Product Boundary

The MVP skeleton separates product experience from AI provider integration. Client apps call the product API. The product API owns user-facing model catalog rules, credit estimation, task records, and the adapter boundary to the existing GW-LINK AI gateway.

## Workspace Packages

- `packages/shared` contains stable product contracts used by all apps.
- `apps/api` exposes product API routes and adapts requests to the GW-LINK AI gateway.
- `apps/admin` is the internal operations console for users, plans, credits, model display, orders, and usage metrics.
- `apps/desktop` is the primary creation workspace for Windows, macOS, and Linux.
- `apps/mobile` is the iOS and Android companion app for light generation, history, sharing, and notifications.

## First Implementation Slice

This skeleton proves that the repository can host all planned product surfaces, share contracts safely, and run tests per package. Business features should be added in thin vertical slices: authentication, model catalog, text generation, image generation, video task submission, assets, credits, and orders.
```

- [ ] **Step 2: Update README with validation commands**

Replace `README.md` with:

```md
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
pnpm install
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
```

- [ ] **Step 3: Run full validation**

Run:

```bash
node --test tests/workspace.test.mjs
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document mvp skeleton architecture"
```

## Task 8: Plan Completion Check

**Files:**
- Modify: no source files

- [ ] **Step 1: Inspect git status**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 2: Inspect commit history**

Run:

```bash
git log --oneline -6
```

Expected: shows the PRD commit followed by skeleton commits:

```text
docs: document mvp skeleton architecture
feat: add mobile app shell
feat: add desktop app shell
feat: add admin app shell
feat: add product api skeleton
feat: add shared product contracts
```

- [ ] **Step 3: Record next implementation slices**

After this plan is complete, create separate implementation plans for these vertical slices:

1. Authentication and account session.
2. Model catalog and gateway adapter integration.
3. Text chat flow.
4. Image generation flow.
5. Video async task flow.
6. Credits, subscriptions, and orders.
7. Asset library and cross-device sync.
8. Admin operations workflows.

## Self-Review

- Spec coverage: This plan covers the PRD's engineering foundation, all planned app surfaces, shared contracts, API boundary, admin shell, desktop shell, mobile shell, and gateway adapter boundary. It does not implement full business features because those are separate vertical slices.
- Placeholder scan: The plan contains concrete file paths, file contents, commands, expected outcomes, and commit messages.
- Type consistency: Shared types use `ModelCapability`, `ProductModel`, `GenerationTask`, and `CreditAmount`; API and client shell tasks reference these names consistently.
