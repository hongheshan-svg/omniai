# GW-LINK OmniAI Admin Model Display 接入设计规格

**日期**: 2026-07-02
**Slice**: 16 — Admin Model Display 接入 API

---

## 摘要

把 admin 运营台的 **Model Display** 模块接到公开的 `/v1/models` 端点：shared apiClient 增加 `listModels()`，admin 新增客户端组件 `ModelCatalogSection`（注入 client、挂载拉取、渲染可见模型目录），替换 `appShell` 里 Model Display 占位。其余 4 个运营模块（Users / Plans & Credits / Orders / Usage Metrics）保持占位，因为后端尚无 admin 鉴权 / 跨用户端点。

## 动机

admin 是最后一个纯 fixture 平台——`AdminAppShell` 是静态壳（标题 + 匿名 banner + 5 个空模块）。后端目前只有 per-user 鉴权端点（generations/assets/credits）+ 公开 `/v1/models`。唯一无需新建后端即可接入的是 Model Display → `/v1/models`（返回可见模型、仅产品字段）。本切片让 admin 首次展示真实数据，并给 shared apiClient 补上 `listModels`（desktop/mobile 未来也可用）。

**非目标**：
- admin 鉴权、跨用户运营端点（Users/Plans/Orders/Usage 仍占位——需要后端 admin API + 权限模型，后续切片）
- 隐藏 / 维护状态模型的 admin 视图（`/v1/models` 只返回 visible 模型）
- 模型编辑 / 可见性开关（只读展示）
- NEXT_PUBLIC_API_BASE_URL 之外的部署配置

## 设计

### 1. shared apiClient.listModels

在 `packages/shared/src/apiClient.ts` 的 `ApiClient` 接口加：

```typescript
listModels(): Promise<ProductModel[]>;
```

实现（公开端点，不带 token）：

```typescript
async listModels() {
  const { models } = await send<{ models: ProductModel[] }>("/v1/models");
  return models;
}
```

`ProductModel` 从 `@gw-link-omniai/shared` 的 contracts 导入（apiClient 已在 shared 内，import from `./models` 或已有的类型导入块）。`send` 无 token 时不带 Authorization 头（现有行为）。

单测（`packages/shared/src/__tests__/apiClient.test.ts`）：fetch mock 返回 `{ models: [...] }` → `listModels()` 解包返回数组；请求为 `GET http://api.test/v1/models`，无 authorization 头。

### 2. admin catalogModel（framework-free）

新增 `apps/admin/src/catalogModel.ts`：

```typescript
import type { ProductModel, ModelCapability } from "@gw-link-omniai/shared";

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

单测（`apps/admin/src/__tests__/catalogModel.test.ts`）：`formatModelSummary` 对 text/free/1 → `"文本 · free · 1 积分"`，image/pro/2 → `"图片 · pro · 2 积分"`，video/studio/3 → `"视频 · studio · 3 积分"`；`getModelCapabilityLabel` 三值。

### 3. admin ModelCatalogSection 组件

新增 `apps/admin/src/ModelCatalogSection.tsx`（`"use client"`）：

```typescript
"use client";
import { useEffect, useState } from "react";
import { createApiClient, type ApiClient, type ProductModel } from "@gw-link-omniai/shared";
import { formatModelSummary } from "./catalogModel";

export function ModelCatalogSection({ client }: { client?: ApiClient }) {
  const [models, setModels] = useState<ProductModel[] | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    const api = client ?? createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL });
    let cancelled = false;
    api
      .listModels()
      .then((loaded) => {
        if (!cancelled) setModels(loaded);
      })
      .catch(() => {
        if (!cancelled) setError(true);
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

`appShell.tsx` 的 Model Display article 内渲染 `<ModelCatalogSection client={client} />`，并给 `AdminAppShell` 加可选 `client` prop 透传：

```typescript
export function AdminAppShell({ client }: { client?: ApiClient } = {}) {
  // ... Model Display article:
  //   <article key="Model Display"><h2>Model Display</h2><ModelCatalogSection client={client} /></article>
}
```

其余 4 个模块仍渲染为空 `<article><h2>{module}</h2></article>`。

### 数据流

`ModelCatalogSection` 挂载 → `client.listModels()`（默认 client 读 `NEXT_PUBLIC_API_BASE_URL`，缺省 `http://localhost:8787`）→ 成功 setModels 渲染列表 / 失败 setError 显示错误文案。无鉴权（`/v1/models` 公开），无 401 处理。

## 错误处理

- `listModels` 失败（网络 / 非 2xx）→ 组件显示 `"模型目录加载失败，请稍后重试"`；不泄露内部错误。
- 加载中显示 `"加载中…"`。

## 测试策略

admin 用 jsdom + `@testing-library/react`（可渲染，与现有 `appShell.test.tsx` 一致）。

1. **catalogModel.test.ts**：`formatModelSummary` 三种 capability/plan/cost 组合 + `getModelCapabilityLabel`。
2. **ModelCatalogSection.test.tsx**：
   - fake client `listModels` 返回 2 个模型 → `await screen.findByText(displayName)` 命中，summary 文案命中。
   - fake client `listModels` 抛错 → `await screen.findByText("模型目录加载失败，请稍后重试")`。
3. **现有 appShell.test.tsx 更新**：`render(<AdminAppShell />)` 会经 ModelCatalogSection 触发默认 client 的真实 fetch（jsdom 无 server）。改为传入返回 `[]` 的 fake client：`render(<AdminAppShell client={fakeClient} />)`，保持网络无关且绿；5 个模块标签 + banner 断言不变（Model Display 标签仍在）。
4. **shared apiClient.test.ts**：新增 listModels 测试。
5. 全量：`pnpm test` + `pnpm typecheck` 全绿。

## 文档

- README `### Provider Adapter Foundation` 之后或合适位置加一小节：admin Model Display 接入公开 `/v1/models`。
- mvp-skeleton 加 `## Admin Model Display Slice` 段落。

## 任务分解

1. **shared apiClient.listModels** + 测试。
2. **admin catalogModel**（`formatModelSummary` / `getModelCapabilityLabel`）+ 测试。
3. **admin ModelCatalogSection** 组件 + 接入 `appShell`（`client` prop 透传）+ 更新现有 appShell 测试 + 新组件渲染测试。
4. **文档**（README + mvp-skeleton）。

## 交付清单

- [ ] `apiClient.listModels()` + shared 测试
- [ ] `catalogModel.ts`（formatModelSummary/getModelCapabilityLabel）+ 测试
- [ ] `ModelCatalogSection.tsx` + appShell 接入 + appShell 测试更新 + 组件渲染测试
- [ ] 文档（README + mvp-skeleton）
- [ ] `pnpm test` + `pnpm typecheck` 全绿
