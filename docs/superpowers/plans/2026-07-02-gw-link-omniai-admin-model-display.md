# Admin Model Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the admin console's Model Display module to the live public `/v1/models` endpoint.

**Architecture:** Add `listModels()` to the shared apiClient (public GET, no token). Add a framework-free admin `catalogModel` formatting helper. Add an admin client component `ModelCatalogSection` (injected client, fetch on mount, render the visible model catalog) wired into `AdminAppShell`'s Model Display module. Admin tests render under jsdom + @testing-library/react with a fake client.

**Tech Stack:** Next.js 14, React 18, vitest + jsdom + @testing-library/react, shared apiClient.

## Global Constraints

- `/v1/models` is public (no token); `listModels()` sends no Authorization header.
- `ProductModel` fields: `id`, `displayName`, `capability` (`text|image|video`), `tags`, `visibility` (`visible|hidden|maintenance`), `minimumPlan` (`free|pro|studio`), `creditUnitCost`.
- Capability labels: `text`→`文本`, `image`→`图片`, `video`→`视频`.
- `formatModelSummary(model)` returns `` `${capabilityLabel} · ${minimumPlan} · ${creditUnitCost} 积分` ``.
- Error copy EXACT: load failure → `"模型目录加载失败，请稍后重试"`; loading → `"加载中…"`.
- `ModelCatalogSection` takes an optional `client` prop; default `createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL })`.
- `AdminAppShell` gains an optional `client` prop threaded to `ModelCatalogSection`; the existing appShell test must pass a fake client so it stays network-free.
- Non-goals: admin auth, cross-user endpoints (Users/Plans/Orders/Usage stay placeholders), hidden/maintenance model views, model editing.
- Each task green before commit.

---

## Task 1: shared apiClient.listModels

**Files:**
- Modify: `packages/shared/src/apiClient.ts`
- Test: `packages/shared/src/__tests__/apiClient.test.ts`

**Interfaces:**
- Produces: `ApiClient.listModels(): Promise<ProductModel[]>`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/__tests__/apiClient.test.ts` (the file already has `jsonResponse`, `baseUrl`, and imports `vi`, `it`, `expect`):

```typescript
it("fetches the public model catalog without a token", async () => {
  const models = [
    { id: "gw-text-balanced", displayName: "均衡文本", capability: "text", tags: [], visibility: "visible", minimumPlan: "free", creditUnitCost: 1 }
  ];
  const fetchMock = vi.fn(async () => jsonResponse({ models }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  const result = await client.listModels();

  expect(result).toEqual(models);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://api.test/v1/models");
  expect(init.method ?? "GET").toBe("GET");
  expect((init.headers as Record<string, string>).authorization).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/apiClient.test.ts`
Expected: FAIL — `client.listModels is not a function`.

- [ ] **Step 3: Implement listModels**

In `packages/shared/src/apiClient.ts`, add `ProductModel` to the type import block:

```typescript
import type {
  AuthSession,
  CreationAsset,
  CreationAssetRequest,
  CreditAmount,
  GenerationTask,
  GenerationTaskRequest,
  LoginStartRequest,
  LoginStartResponse,
  LoginVerifyRequest,
  ProductModel,
  PromptOptimization,
  PromptOptimizationRequest,
  SessionResponse
} from "@gw-link-omniai/shared";
```

Add to the `ApiClient` interface (after `topUpCredits`):

```typescript
  topUpCredits(amount: number, token: string): Promise<CreditAmount>;
  listModels(): Promise<ProductModel[]>;
}
```

Add the implementation to the returned object (after the `topUpCredits` method):

```typescript
    async topUpCredits(amount, token) {
      const { balance } = await send<{ balance: CreditAmount }>("/v1/credits/topup", {
        method: "POST",
        body: { amount },
        token
      });
      return balance;
    },
    async listModels() {
      const { models } = await send<{ models: ProductModel[] }>("/v1/models");
      return models;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/shared exec vitest run src/__tests__/apiClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @gw-link-omniai/shared typecheck`
Expected: no errors.

```bash
git add packages/shared/src/apiClient.ts packages/shared/src/__tests__/apiClient.test.ts
git commit -m "feat(shared): add apiClient.listModels for the public model catalog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: admin catalogModel

**Files:**
- Create: `apps/admin/src/catalogModel.ts`
- Test: `apps/admin/src/__tests__/catalogModel.test.ts`

**Interfaces:**
- Produces: `getModelCapabilityLabel(capability: ModelCapability): string`; `formatModelSummary(model: ProductModel): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/__tests__/catalogModel.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { ProductModel } from "@gw-link-omniai/shared";
import { formatModelSummary, getModelCapabilityLabel } from "../catalogModel";

function model(overrides: Partial<ProductModel>): ProductModel {
  return {
    id: "m1",
    displayName: "M1",
    capability: "text",
    tags: [],
    visibility: "visible",
    minimumPlan: "free",
    creditUnitCost: 1,
    ...overrides
  };
}

describe("catalogModel", () => {
  it("labels capabilities in Chinese", () => {
    expect(getModelCapabilityLabel("text")).toBe("文本");
    expect(getModelCapabilityLabel("image")).toBe("图片");
    expect(getModelCapabilityLabel("video")).toBe("视频");
  });

  it("formats a model summary line", () => {
    expect(formatModelSummary(model({ capability: "text", minimumPlan: "free", creditUnitCost: 1 }))).toBe("文本 · free · 1 积分");
    expect(formatModelSummary(model({ capability: "image", minimumPlan: "pro", creditUnitCost: 2 }))).toBe("图片 · pro · 2 积分");
    expect(formatModelSummary(model({ capability: "video", minimumPlan: "studio", creditUnitCost: 3 }))).toBe("视频 · studio · 3 积分");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/admin exec vitest run src/__tests__/catalogModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement catalogModel**

Create `apps/admin/src/catalogModel.ts`:

```typescript
import type { ModelCapability, ProductModel } from "@gw-link-omniai/shared";

const capabilityLabels: Record<ModelCapability, string> = {
  text: "文本",
  image: "图片",
  video: "视频"
};

export function getModelCapabilityLabel(capability: ModelCapability): string {
  return capabilityLabels[capability];
}

export function formatModelSummary(model: ProductModel): string {
  return `${capabilityLabels[model.capability]} · ${model.minimumPlan} · ${model.creditUnitCost} 积分`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/admin exec vitest run src/__tests__/catalogModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/catalogModel.ts apps/admin/src/__tests__/catalogModel.test.ts
git commit -m "feat(admin): add catalogModel formatting helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: admin ModelCatalogSection + appShell wiring

**Files:**
- Create: `apps/admin/src/ModelCatalogSection.tsx`
- Test: `apps/admin/src/__tests__/ModelCatalogSection.test.tsx`
- Modify: `apps/admin/src/appShell.tsx`
- Modify: `apps/admin/src/__tests__/appShell.test.tsx`

**Interfaces:**
- Consumes: `apiClient.listModels()` (Task 1); `formatModelSummary` (Task 2); `type ApiClient`, `type ProductModel`, `createApiClient` from `@gw-link-omniai/shared`.
- Produces: `ModelCatalogSection({ client?: ApiClient })`; `AdminAppShell({ client?: ApiClient })`.

- [ ] **Step 1: Write the failing component test**

Create `apps/admin/src/__tests__/ModelCatalogSection.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiClient, ProductModel } from "@gw-link-omniai/shared";
import { ModelCatalogSection } from "../ModelCatalogSection";

const models: ProductModel[] = [
  { id: "gw-text-balanced", displayName: "均衡文本", capability: "text", tags: [], visibility: "visible", minimumPlan: "free", creditUnitCost: 1 },
  { id: "gw-image-creative", displayName: "创意图片", capability: "image", tags: [], visibility: "visible", minimumPlan: "pro", creditUnitCost: 2 }
];

function fakeClient(overrides: Partial<ApiClient>): ApiClient {
  return { listModels: async () => models, ...overrides } as unknown as ApiClient;
}

describe("ModelCatalogSection", () => {
  it("renders the fetched model catalog", async () => {
    render(<ModelCatalogSection client={fakeClient({})} />);
    expect(await screen.findByText("均衡文本")).toBeTruthy();
    expect(screen.getByText("文本 · free · 1 积分")).toBeTruthy();
    expect(screen.getByText("创意图片")).toBeTruthy();
    expect(screen.getByText("图片 · pro · 2 积分")).toBeTruthy();
  });

  it("shows an error message when loading fails", async () => {
    const client = fakeClient({ listModels: async () => { throw new Error("boom"); } });
    render(<ModelCatalogSection client={client} />);
    expect(await screen.findByText("模型目录加载失败，请稍后重试")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/admin exec vitest run src/__tests__/ModelCatalogSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ModelCatalogSection**

Create `apps/admin/src/ModelCatalogSection.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { createApiClient, type ApiClient, type ProductModel } from "@gw-link-omniai/shared";
import { formatModelSummary } from "./catalogModel";

export function ModelCatalogSection({ client }: { client?: ApiClient } = {}) {
  const [models, setModels] = useState<ProductModel[] | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    const api = client ?? createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL });
    let cancelled = false;
    api
      .listModels()
      .then((loaded) => {
        if (!cancelled) {
          setModels(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (error) {
    return <p>模型目录加载失败，请稍后重试</p>;
  }
  if (!models) {
    return <p>加载中…</p>;
  }
  return (
    <ul aria-label="Model catalog">
      {models.map((model) => (
        <li key={model.id}>
          <span>{model.displayName}</span>
          <span>{formatModelSummary(model)}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/admin exec vitest run src/__tests__/ModelCatalogSection.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Wire ModelCatalogSection into appShell**

Replace `apps/admin/src/appShell.tsx` with:

```typescript
import type { ApiClient } from "@gw-link-omniai/shared";
import { getAdminSessionBanner } from "./sessionModel";
import { ModelCatalogSection } from "./ModelCatalogSection";

const modules = ["Users", "Plans & Credits", "Model Display", "Orders", "Usage Metrics"];

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function AdminAppShell({ client }: { client?: ApiClient } = {}) {
  return (
    <main>
      <h1>GW-LINK OmniAI Admin</h1>
      <p>{getAdminSessionBanner(anonymousSession)}</p>
      <p>Operations console for the commercial AI creation product.</p>
      <section aria-label="Operations modules">
        {modules.map((module) => (
          <article key={module}>
            <h2>{module}</h2>
            {module === "Model Display" ? <ModelCatalogSection client={client} /> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Update the existing appShell test to pass a fake client**

In `apps/admin/src/__tests__/appShell.test.tsx`, update the first test so the render is network-free. Add an import and pass a fake client returning `[]`:

Add to the imports at the top:

```typescript
import type { ApiClient } from "@gw-link-omniai/shared";
```

Change the first test's `render(<AdminAppShell />)` to:

```typescript
  it("renders the operations modules required by the PRD and auth banner", () => {
    const client = { listModels: async () => [] } as unknown as ApiClient;
    render(<AdminAppShell client={client} />);

    expect(screen.getByText("GW-LINK OmniAI Admin")).toBeTruthy();
    expect(screen.getByText("Admin login required")).toBeTruthy();
    expect(screen.getByText("Users")).toBeTruthy();
    expect(screen.getByText("Plans & Credits")).toBeTruthy();
    expect(screen.getByText("Model Display")).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Usage Metrics")).toBeTruthy();
  });
```

(The second test — `getAdminSessionBanner` — is unchanged.)

- [ ] **Step 7: Run the admin suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/admin test`
Expected: PASS — catalogModel (2) + ModelCatalogSection (2) + appShell (2) = 6.

Run: `pnpm --filter @gw-link-omniai/admin typecheck`
Expected: no errors.

- [ ] **Step 8: Run full workspace**

Run: `pnpm test`
Expected: all packages green.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/ModelCatalogSection.tsx apps/admin/src/__tests__/ModelCatalogSection.test.tsx apps/admin/src/appShell.tsx apps/admin/src/__tests__/appShell.test.tsx
git commit -m "feat(admin): render the live model catalog in Model Display

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README.md**

After the `### Provider Adapter Foundation` section (or at the end of the slice list, before `## Validation`), add:

```markdown
### Admin Model Display

The admin console's Model Display module renders the live product model catalog.

- The shared apiClient gains `listModels()` (public `GET /v1/models`, no token).
- `ModelCatalogSection` (a client component) fetches the catalog on mount and lists
  each visible model's name and a `capability · minimumPlan · creditUnitCost` summary.
- `NEXT_PUBLIC_API_BASE_URL` overrides the API base (defaults to `http://localhost:8787`).
- The other admin modules (Users, Plans & Credits, Orders, Usage Metrics) remain
  placeholders — they need admin auth and cross-user endpoints (a later slice).
```

- [ ] **Step 2: Update mvp-skeleton.md**

At the end of `docs/architecture/mvp-skeleton.md`, add:

```markdown
## Admin Model Display Slice

The admin operations console makes its first live API call: the shared apiClient
gains `listModels()` (public `GET /v1/models`, no token — product fields only), and
a client component `ModelCatalogSection` fetches and renders the visible model
catalog inside the Model Display module (name + `capability · plan · creditUnitCost`
summary via the framework-free `catalogModel` helper). `AdminAppShell` threads an
optional injected `client` for testability. The other four modules (Users, Plans &
Credits, Orders, Usage Metrics) stay placeholders because the API has no admin auth
or cross-user endpoints yet — those remain a later slice.
```

- [ ] **Step 3: Full workspace validation**

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document admin Model Display slice (Slice 16)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ apiClient.listModels + test (spec §1) → Task 1
- ✅ catalogModel formatModelSummary/getModelCapabilityLabel + test (spec §2) → Task 2
- ✅ ModelCatalogSection + appShell wiring + appShell test update + component test (spec §3) → Task 3
- ✅ error/loading copy (spec §错误处理) → Task 3 Step 3
- ✅ docs (spec §文档) → Task 4
- ✅ non-goals honored (no admin auth, no cross-user endpoints, no editing)

**Placeholder scan:** none — all code/commands/expected outputs concrete.

**Type consistency:** `listModels(): Promise<ProductModel[]>` consistent across interface, impl, test, and component usage. `formatModelSummary`/`getModelCapabilityLabel` signatures match between catalogModel and its consumers. `AdminAppShell`/`ModelCatalogSection` both take `client?: ApiClient`. Error copy strings identical across spec, component, and tests.
