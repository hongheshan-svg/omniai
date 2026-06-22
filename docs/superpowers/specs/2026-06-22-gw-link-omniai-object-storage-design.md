# GW-LINK OmniAI 对象存储 设计

文档版本：V0.1
文档日期：2026-06-22
文档类型：阶段实现设计
适用阶段：Stage 13 - Object Storage（生成图片落存储，result 携真实 URL）

## 1. 背景

Slice 8 让图片真实生成，但结果以**内联 base64 data URL** 承载——进 DB jsonb 与 API 响应较重，非生产级。本阶段引入对象存储：图片字节落到存储后端，`GenerationTask.result` 的 image `url` 改为指向真实文件 URL。

按本项目「仓库 seam（接口 + 内存/Drizzle 双实现）」范式，本片建 `ObjectStore` 抽象 + 内存/本地双实现 + API 公开文件路由；云后端（Supabase Storage / S3）作为同一接口的后续实现。**不引入云依赖**。

## 2. 目标

1. `ObjectStore` 接口 + `InMemoryObjectStore`（默认）+ `LocalFileObjectStore`（配置目录时）。
2. 图片 provider 注入 store：b64 字节 → 存储 → result.url = `${publicBaseUrl}/files/<id>`；无 store → 内联 data URL 回退（Slice 8 行为不破）。
3. 公开路由 `GET /files/:id` 流式返回字节（不可猜随机 id）。
4. 配置 `GW_LINK_PUBLIC_BASE_URL`、`GW_LINK_OBJECT_STORE_DIR`。
5. 生成服务 / 持久化 / 扣费 / 桌面**不改**。

验收标准：配置图片 provider key 后提交图片生成，result.url 形如 `${base}/files/<id>`（非 data URL）；`GET` 该 URL 返回图片字节与正确 content-type；未知 id → 404；无 store 时回退 data URL；`pnpm test`、`pnpm typecheck` 全绿。

## 3. 非目标

1. 云存储后端（Supabase Storage / S3，同接口后续）。
2. 按用户 ACL / 签名 URL / 过期 / 配额（公开 capability URL 即可）。
3. 图片以外的文件类型（文本/视频资产文件）。
4. 抓取并转存 provider 返回的远程 url（透传该 url，不落存储）。
5. 桌面改动（`<img src>` 对 data: 与 http URL 一视同仁）。

## 4. 数据行为

1. **存储**：图片 provider 拿到 `b64_json` 且注入了 `objectStore` → `store.put(Buffer.from(b64, "base64"), "image/png")` → 得 `{ id, url }` → `result = { kind:"image", url, alt }`。
2. **回退**：无 `objectStore` → `url = "data:image/png;base64," + b64`（Slice 8）。provider 返回的 url（透传分支）→ 直接用，不落存储。
3. **id**：`${randomUUID()}.${ext}`，ext 由 contentType 映射（`image/png`→`png`、`image/jpeg`→`jpg`、`image/webp`→`webp`，未知→`bin`）。不可猜、自带类型。
4. **url**：`${publicBaseUrl}/files/${id}`（store 构造时注入 `publicBaseUrl`）。
5. **取回**：`GET /files/:id` → `store.get(id)` → 命中返回字节 + content-type（按扩展名推），未命中 404。
6. **持久化**：`GenerationTask.result.url` 存的是文件 URL 字符串（非 base64），经现有 jsonb 列原样存取，无需改生成服务/仓库。

## 5. 组件设计

### 5.1 ObjectStore

`apps/api/src/services/objectStore.ts`：
```ts
export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface ObjectStore {
  put(bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }>;
  get(id: string): Promise<StoredObject | undefined>;
}

export interface ObjectStoreOptions {
  publicBaseUrl?: string;       // default "http://localhost:8787"
  idGenerator?: () => string;   // default randomUUID
}
```
- contentType↔扩展名映射在模块内（`extensionForContentType`/`contentTypeForId`）。
- `InMemoryObjectStore`：`Map<string, StoredObject>`；`put` 生成 id（含扩展名）、存 `structuredClone`-安全的字节副本、返回 `{ id, url }`；`get` 返回副本。
- `LocalFileObjectStore(dir, options)`：`put` `mkdir -p dir` 后写 `<dir>/<id>`；`get` 读 `<dir>/<id>`（不存在→undefined），contentType 由 id 扩展名推。
- 默认 `publicBaseUrl` 为常量 `http://localhost:8787`（配置无关，避免 buildServer 默认构造触发 `loadConfig`）。

### 5.2 图片 provider 集成

`OpenAiCompatibleImageProvider` 选项增 `objectStore?: ObjectStore`。§4.1–4.2 逻辑：b64 + store → `put` → url；b64 + 无 store → data URL；透传 url → 原样。其余不变（queued 回退、key 仅入头、错误 502）。

### 5.3 文件路由

`apps/api/src/routes/files.ts`：`registerFileRoutes(server, objectStore)`：
```ts
server.get("/files/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const object = await objectStore.get(id);
  if (!object) {
    return reply.status(404).send({ error: "File not found" });
  }
  return reply.header("content-type", object.contentType).send(Buffer.from(object.bytes));
});
```
**公开**（不挂 `createAuthGuard`）；与 `/health`、`/v1/models` 一样无需认证。

### 5.4 配置

`apps/api/src/config.ts` `loadConfig` 增：
- `publicBaseUrl: string` ← `GW_LINK_PUBLIC_BASE_URL ?? \`http://localhost:${port}\``。
- `objectStoreDir?: string` ← `GW_LINK_OBJECT_STORE_DIR`（可选）。

### 5.5 组装

- `buildServer`：选项增 `objectStore?: ObjectStore`；默认 `new InMemoryObjectStore()`（配置无关）；该实例注入 composite 的 image provider（`new OpenAiCompatibleImageProvider({ objectStore })`）并注册 `registerFileRoutes(server, objectStore)`。
- `appServices`：`createServices` 构造 `ObjectStore`（`config.objectStoreDir ? new LocalFileObjectStore(dir, { publicBaseUrl }) : new InMemoryObjectStore({ publicBaseUrl })`），注入 image provider，`AppServices` 增 `objectStore`；`createDbServices` 接收并使用同一 store；生产入口把 `services.objectStore` 传给 `buildServer`（route 与 provider 同源）。
- 生成服务、持久化、扣费、桌面：不改。

## 6. 错误处理

1. 未知文件 id → 404 `{ error: "File not found" }`。
2. `store.put` 失败（如本地写盘失败）→ 抛错 → provider 502 → 不落任务。
3. 公开按不可猜 id（capability URL）；按用户 ACL / 签名过期留后续。
4. 不泄露存储内部路径 / provider key。

## 7. 测试策略

1. **ObjectStore 单测**（InMemory + LocalFile[临时目录]）：`put`→`get` round-trip（字节相等、contentType 经扩展名往返）；`url` 形如 `${base}/files/<uuid>.png`；未知 id → undefined；不同 contentType→不同扩展名。
2. **图片 provider 单测**：注入 store → succeeded、`result.url` 为 `${base}/files/<id>`（非 data URL）、store 内存有该字节；不注入 store → data URL（Slice 8 既有测试不变）。
3. **文件路由测试**：`GET /files/<id>` 命中 → 200 + content-type + 字节；未知 id → 404。
4. **e2e**（server.test）：注入 ObjectStore + image provider（mock fetch 返回 b64）→ 提交图片生成 → `result.url` 指向 `/files/`；再 `GET` 该 url → 200 + 字节。
5. **config 单测**：`publicBaseUrl` 默认（含 port）/ `GW_LINK_PUBLIC_BASE_URL` 覆盖；`objectStoreDir` 透传。
6. 全量：`pnpm test`、`pnpm typecheck`。

## 8. 风险与约束

1. **内存 store 重启丢失**：默认内存实现重启丢字节（与内存仓库一致）；配置 `GW_LINK_OBJECT_STORE_DIR` 用本地文件持久。
2. **公开文件**：任何持有 id 者可取；适合生成图基础片，ACL/签名后续。
3. **本地文件非分布式**：多实例不共享本地目录；云后端（同接口）解决，后续。
4. **图片以外**：仅图片字节；其它资产文件后续。

## 9. 验收清单

- [ ] `ObjectStore` 接口 + `InMemoryObjectStore` + `LocalFileObjectStore` + 单测。
- [ ] 图片 provider 注入 store（b64→存储 url；无 store→data URL；透传 url 原样）+ 单测。
- [ ] `GET /files/:id` 公开路由（命中/404）+ 测试。
- [ ] 配置 `GW_LINK_PUBLIC_BASE_URL` / `GW_LINK_OBJECT_STORE_DIR` + config 单测。
- [ ] 组装：单一 store 注入 provider + 文件路由（buildServer/appServices/生产入口）。
- [ ] e2e 图片生成 url 指向 /files + GET 取回字节。
- [ ] 生成服务/持久化/扣费/桌面/`packages/shared` 不改。
- [ ] README、`mvp-skeleton.md` 更新。
- [ ] `pnpm test`、`pnpm typecheck` 通过。
