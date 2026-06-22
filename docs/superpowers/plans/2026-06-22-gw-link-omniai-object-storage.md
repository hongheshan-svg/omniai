# GW-LINK OmniAI Object Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store generated image bytes in an `ObjectStore` and serve them at a real URL (`${publicBaseUrl}/files/<id>`) instead of an inline base64 data URL.

**Architecture:** An `ObjectStore` seam (interface + `InMemoryObjectStore` default + `LocalFileObjectStore` when a dir is configured), mirroring the repository seam. The image provider gains an injected `objectStore`: with a store, it `put`s the bytes and returns the stored URL; without one, it falls back to the Slice-8 data URL. A public `GET /files/:id` route streams the bytes. One `ObjectStore` instance is shared between the image provider (`put`) and the file route (`get`). The generation service, persistence, credits, desktop, and `packages/shared` are unchanged.

**Tech Stack:** TypeScript (strict, ESM), Fastify 4, Node 20 (`node:fs/promises`, `node:crypto`), Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-22-gw-link-omniai-object-storage-design.md` (approved).

## Global Constraints (apply to every task)

1. No cloud storage / SDK. Only `InMemoryObjectStore` + `LocalFileObjectStore` (Node fs).
2. No change to the generation service, persistence (repositories/schema), credit logic, desktop, or `packages/shared`.
3. Object id = `${randomUUID()}.${ext}` where ext maps from content type (`image/png`→`png`, `image/jpeg`→`jpg`, `image/webp`→`webp`, else `bin`); the URL is `${publicBaseUrl}/files/${id}` (publicBaseUrl trailing slash stripped).
4. `GET /files/:id` is PUBLIC (no auth guard); hit → 200 + correct `content-type` + bytes; miss → 404 `{ error: "File not found" }`.
5. Image provider: b64 + injected store → store bytes (`image/png`) → stored URL; b64 + no store → `data:image/png;base64,<b64>` (Slice-8 fallback); provider-returned `url` → passthrough (not stored). Other provider behavior (queued fallback, key only in `Authorization` header, 502 on error) unchanged.
6. The default `ObjectStore` constructed in `buildServer` must be config-free (`new InMemoryObjectStore()` with the built-in default `publicBaseUrl`), so it never triggers `loadConfig` (keeps the "does not load env config when an auth service is injected" test green).
7. Each task ends green: `pnpm --filter @gw-link-omniai/api test` + `... typecheck` before committing. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- Create: `apps/api/src/services/objectStore.ts` (+ `__tests__/objectStore.test.ts`) (Task 1).
- Modify: `apps/api/src/config.ts` (+ `__tests__/config.test.ts` and the `ApiConfig` literal sites) (Task 2).
- Modify: `apps/api/src/services/openAiImageProvider.ts` (+ its test) (Task 3).
- Create: `apps/api/src/routes/files.ts`; modify `apps/api/src/server.ts` (+ `__tests__/server.test.ts`) (Task 4).
- Modify: `apps/api/src/services/appServices.ts` (+ `__tests__/appServices.test.ts`) (Task 5).
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md`, `.env.example` (Task 6).

---

## Task 1: ObjectStore (interface + in-memory + local-file)

**Files:**
- Create: `apps/api/src/services/objectStore.ts`
- Test: `apps/api/src/services/__tests__/objectStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StoredObject { bytes: Uint8Array; contentType: string; }
  export interface ObjectStore {
    put(bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }>;
    get(id: string): Promise<StoredObject | undefined>;
  }
  export interface ObjectStoreOptions { publicBaseUrl?: string; idGenerator?: () => string; }
  export class InMemoryObjectStore implements ObjectStore { /* ... */ }
  export class LocalFileObjectStore implements ObjectStore { constructor(dir: string, options?: ObjectStoreOptions) }
  export const DEFAULT_PUBLIC_BASE_URL = "http://localhost:8787";
  ```

- [ ] **Step 1: Write the failing tests** — create `apps/api/src/services/__tests__/objectStore.test.ts`:
  ```ts
  import { mkdtemp, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { afterEach, describe, expect, it } from "vitest";
  import { InMemoryObjectStore, LocalFileObjectStore } from "../objectStore";

  function bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  describe("InMemoryObjectStore", () => {
    it("stores bytes and serves them at a files URL", async () => {
      let n = 0;
      const store = new InMemoryObjectStore({ publicBaseUrl: "https://api.test", idGenerator: () => `id${(n += 1)}` });

      const { id, url } = await store.put(bytes("hello"), "image/png");

      expect(id).toBe("id1.png");
      expect(url).toBe("https://api.test/files/id1.png");
      const got = await store.get(id);
      expect(got?.contentType).toBe("image/png");
      expect(new TextDecoder().decode(got!.bytes)).toBe("hello");
    });

    it("maps content types to extensions", async () => {
      let n = 0;
      const store = new InMemoryObjectStore({ idGenerator: () => `id${(n += 1)}` });
      expect((await store.put(bytes("a"), "image/jpeg")).id).toBe("id1.jpg");
      expect((await store.put(bytes("b"), "image/webp")).id).toBe("id2.webp");
      expect((await store.put(bytes("c"), "application/x-other")).id).toBe("id3.bin");
    });

    it("returns undefined for an unknown id", async () => {
      const store = new InMemoryObjectStore();
      expect(await store.get("missing.png")).toBeUndefined();
    });

    it("does not share mutable references with stored bytes", async () => {
      const store = new InMemoryObjectStore({ idGenerator: () => "x" });
      const input = bytes("hello");
      const { id } = await store.put(input, "image/png");
      input[0] = 0;
      const got = await store.get(id);
      expect(new TextDecoder().decode(got!.bytes)).toBe("hello");
    });
  });

  describe("LocalFileObjectStore", () => {
    let dir: string;
    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    it("round-trips bytes through the filesystem", async () => {
      dir = await mkdtemp(join(tmpdir(), "objstore-"));
      let n = 0;
      const store = new LocalFileObjectStore(dir, { publicBaseUrl: "https://api.test", idGenerator: () => `id${(n += 1)}` });

      const { id, url } = await store.put(bytes("pixels"), "image/png");

      expect(url).toBe("https://api.test/files/id1.png");
      const got = await store.get(id);
      expect(got?.contentType).toBe("image/png");
      expect(new TextDecoder().decode(got!.bytes)).toBe("pixels");
      expect(await store.get("missing.png")).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/objectStore.test.ts`
  Expected: FAIL (`objectStore` module does not exist).

- [ ] **Step 3: Implement it** — create `apps/api/src/services/objectStore.ts`:
  ```ts
  import { randomUUID } from "node:crypto";
  import { mkdir, readFile, writeFile } from "node:fs/promises";
  import { join } from "node:path";

  export interface StoredObject {
    bytes: Uint8Array;
    contentType: string;
  }

  export interface ObjectStore {
    put(bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }>;
    get(id: string): Promise<StoredObject | undefined>;
  }

  export interface ObjectStoreOptions {
    publicBaseUrl?: string;
    idGenerator?: () => string;
  }

  export const DEFAULT_PUBLIC_BASE_URL = "http://localhost:8787";

  const EXT_BY_TYPE: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
  };

  const TYPE_BY_EXT: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp"
  };

  function extensionForContentType(contentType: string): string {
    return EXT_BY_TYPE[contentType] ?? "bin";
  }

  function contentTypeForId(id: string): string {
    const ext = id.split(".").pop() ?? "";
    return TYPE_BY_EXT[ext] ?? "application/octet-stream";
  }

  function buildId(idGenerator: () => string, contentType: string): string {
    return `${idGenerator()}.${extensionForContentType(contentType)}`;
  }

  function buildUrl(publicBaseUrl: string, id: string): string {
    return `${publicBaseUrl.replace(/\/$/, "")}/files/${id}`;
  }

  export class InMemoryObjectStore implements ObjectStore {
    private readonly objects = new Map<string, StoredObject>();
    private readonly publicBaseUrl: string;
    private readonly idGenerator: () => string;

    constructor(options: ObjectStoreOptions = {}) {
      this.publicBaseUrl = options.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL;
      this.idGenerator = options.idGenerator ?? randomUUID;
    }

    async put(bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }> {
      const id = buildId(this.idGenerator, contentType);
      this.objects.set(id, { bytes: Uint8Array.from(bytes), contentType });
      return { id, url: buildUrl(this.publicBaseUrl, id) };
    }

    async get(id: string): Promise<StoredObject | undefined> {
      const object = this.objects.get(id);
      return object ? { bytes: Uint8Array.from(object.bytes), contentType: object.contentType } : undefined;
    }
  }

  export class LocalFileObjectStore implements ObjectStore {
    private readonly publicBaseUrl: string;
    private readonly idGenerator: () => string;

    constructor(private readonly dir: string, options: ObjectStoreOptions = {}) {
      this.publicBaseUrl = options.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL;
      this.idGenerator = options.idGenerator ?? randomUUID;
    }

    async put(bytes: Uint8Array, contentType: string): Promise<{ id: string; url: string }> {
      const id = buildId(this.idGenerator, contentType);
      await mkdir(this.dir, { recursive: true });
      await writeFile(join(this.dir, id), bytes);
      return { id, url: buildUrl(this.publicBaseUrl, id) };
    }

    async get(id: string): Promise<StoredObject | undefined> {
      try {
        const bytes = await readFile(join(this.dir, id));
        return { bytes: new Uint8Array(bytes), contentType: contentTypeForId(id) };
      } catch {
        return undefined;
      }
    }
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/objectStore.test.ts`
  Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/services/objectStore.ts apps/api/src/services/__tests__/objectStore.test.ts
  git commit -m "feat(api): add ObjectStore (in-memory + local-file)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: Config — publicBaseUrl + objectStoreDir

**Files:**
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/__tests__/config.test.ts`
- Modify (keep typecheck green): `apps/api/src/__tests__/server.test.ts`, `apps/api/src/__tests__/dbPersistence.test.ts`, `apps/api/src/services/__tests__/appServices.test.ts`, `apps/api/src/routes/__tests__/assets.test.ts`, `apps/api/src/routes/__tests__/generations.test.ts`

**Interfaces:**
- Produces: `ApiConfig.publicBaseUrl: string` (default `http://localhost:${port}`), `ApiConfig.objectStoreDir?: string`.

- [ ] **Step 1: Write the failing config tests** — in `apps/api/src/__tests__/config.test.ts`:
  - In "returns default API configuration", add `publicBaseUrl: "http://localhost:8787"` to the expected object (do NOT add `objectStoreDir` — undefined is ignored by `toEqual`).
  - In "returns supplied API configuration" (PORT 9000), add `publicBaseUrl: "http://localhost:9000"` to the expected object.
  - Add new tests:
  ```ts
  it("defaults the public base URL to localhost on the configured port", () => {
    expect(loadConfig({ PORT: "9000" }).publicBaseUrl).toBe("http://localhost:9000");
  });

  it("uses an explicit public base URL", () => {
    expect(loadConfig({ GW_LINK_PUBLIC_BASE_URL: "https://api.example.com" }).publicBaseUrl).toBe(
      "https://api.example.com"
    );
  });

  it("includes the object store dir when provided", () => {
    expect(loadConfig({ GW_LINK_OBJECT_STORE_DIR: "/var/data/objects" }).objectStoreDir).toBe(
      "/var/data/objects"
    );
  });

  it("omits the object store dir when not provided", () => {
    expect(loadConfig({}).objectStoreDir).toBeUndefined();
  });
  ```

- [ ] **Step 2: Run config tests to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/config.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement the config fields** — in `apps/api/src/config.ts`:
  - Add to the `ApiConfig` interface: `publicBaseUrl: string;` and `objectStoreDir?: string;`.
  - In `loadConfig`, compute the port once and use it for the default public base URL. Replace the body of `loadConfig` so it reads:
    ```ts
    export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
      const port = parsePort(env.PORT);
      return {
        port,
        gatewayBaseUrl: env.GW_LINK_GATEWAY_BASE_URL ?? "https://gateway.gw-link.local",
        authDevCodesEnabled: parseAuthDevCodesEnabled(env),
        modelConfigPath: env.GW_LINK_MODEL_CONFIG_PATH ?? "config/models.json",
        initialCredits: parseInitialCredits(env.GW_LINK_INITIAL_CREDITS),
        publicBaseUrl: env.GW_LINK_PUBLIC_BASE_URL ?? `http://localhost:${port}`,
        objectStoreDir: env.GW_LINK_OBJECT_STORE_DIR,
        databaseUrl: env.DATABASE_URL,
        corsOrigins: parseCorsOrigins(env.GW_LINK_CORS_ORIGINS)
      };
    }
    ```

- [ ] **Step 4: Keep the other `ApiConfig` literals compiling** — add `publicBaseUrl: "http://localhost:8787",` to each object literal that constructs an `ApiConfig` (they all set `port: 8787`):
  - `apps/api/src/services/__tests__/appServices.test.ts` — `baseConfig()` return object.
  - `apps/api/src/__tests__/dbPersistence.test.ts` — `smokeConfig()` return object.
  - `apps/api/src/__tests__/server.test.ts` — BOTH inline `config: { ... }` objects.
  - `apps/api/src/routes/__tests__/assets.test.ts` — the `testConfig` object.
  - `apps/api/src/routes/__tests__/generations.test.ts` — all THREE inline `config: { ... }` objects.
  (Do not add `objectStoreDir` — it is optional.)

- [ ] **Step 5: Run config tests + full api suite**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/config.test.ts` then `pnpm --filter @gw-link-omniai/api test`
  Expected: PASS (config tests pass; no other suite broke).

- [ ] **Step 6: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/config.ts apps/api/src/__tests__/config.test.ts apps/api/src/__tests__/server.test.ts apps/api/src/__tests__/dbPersistence.test.ts apps/api/src/services/__tests__/appServices.test.ts apps/api/src/routes/__tests__/assets.test.ts apps/api/src/routes/__tests__/generations.test.ts
  git commit -m "feat(api): add GW_LINK_PUBLIC_BASE_URL and GW_LINK_OBJECT_STORE_DIR config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: Image provider stores bytes

**Files:**
- Modify: `apps/api/src/services/openAiImageProvider.ts`
- Test: `apps/api/src/services/__tests__/openAiImageProvider.test.ts`

**Interfaces:**
- Consumes: `ObjectStore` (Task 1).
- Produces: `OpenAiCompatibleImageProviderOptions.objectStore?: ObjectStore`.

- [ ] **Step 1: Write the failing test** — in `apps/api/src/services/__tests__/openAiImageProvider.test.ts`, add (the `imageRequest`/`jsonResponse` helpers already exist):
  ```ts
  it("stores the image bytes and returns the stored URL when an object store is configured", async () => {
    const { InMemoryObjectStore } = await import("../objectStore");
    const store = new InMemoryObjectStore({ publicBaseUrl: "https://api.test", idGenerator: () => "obj1" });
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] }));
    const provider = new OpenAiCompatibleImageProvider({
      fetch: fetchMock as unknown as typeof fetch,
      env: { OPENAI_API_KEY: "sk-test" },
      objectStore: store
    });

    const result = await provider.submitGeneration(imageRequest());

    expect(result.result).toEqual({
      kind: "image",
      url: "https://api.test/files/obj1.png",
      alt: "一只在霓虹城市里的猫"
    });
    const stored = await store.get("obj1.png");
    expect(new TextDecoder().decode(stored!.bytes)).toBe("hello");
  });
  ```
  (Add `objectStore` to the import line: `import { OpenAiCompatibleImageProvider } from "../openAiImageProvider";` stays; the store is imported dynamically in the test as shown, or add a top-level `import { InMemoryObjectStore } from "../objectStore";` and drop the dynamic import.)

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/openAiImageProvider.test.ts -t "stores the image bytes"`
  Expected: FAIL (no `objectStore` option; returns a data URL).

- [ ] **Step 3: Implement it** — in `apps/api/src/services/openAiImageProvider.ts`:
  - Add `import type { ObjectStore } from "./objectStore";`.
  - Add `objectStore?: ObjectStore;` to `OpenAiCompatibleImageProviderOptions`.
  - Add a private field `private readonly objectStore?: ObjectStore;` and set it in the constructor: `this.objectStore = options.objectStore;`.
  - Replace the b64 branch of the URL resolution so it stores when a store is present:
    ```ts
    const first = payload.data?.[0];
    let imageUrl: string | undefined;
    if (first && typeof first.b64_json === "string" && first.b64_json.length > 0) {
      if (this.objectStore) {
        const stored = await this.objectStore.put(Buffer.from(first.b64_json, "base64"), "image/png");
        imageUrl = stored.url;
      } else {
        imageUrl = `data:image/png;base64,${first.b64_json}`;
      }
    } else if (first && typeof first.url === "string" && first.url.length > 0) {
      imageUrl = first.url;
    }
    ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/services/__tests__/openAiImageProvider.test.ts`
  Expected: PASS (new store test + all existing tests — the no-store tests still return a data URL).

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/api typecheck` (green).
  ```bash
  git add apps/api/src/services/openAiImageProvider.ts apps/api/src/services/__tests__/openAiImageProvider.test.ts
  git commit -m "feat(api): store generated image bytes via ObjectStore

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: File route + buildServer wiring

**Files:**
- Create: `apps/api/src/routes/files.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `ObjectStore`, `InMemoryObjectStore` (Task 1); `OpenAiCompatibleImageProvider` (Task 3).
- Produces: `registerFileRoutes(server, objectStore)`; `BuildServerOptions.objectStore?: ObjectStore`.

- [ ] **Step 1: Write the failing tests** — in `apps/api/src/__tests__/server.test.ts`, add an import:
  ```ts
  import { InMemoryObjectStore } from "../services/objectStore";
  ```
  and two tests inside the `describe("product API", ...)` block:
  ```ts
  it("serves a stored file at /files/:id", async () => {
    const store = new InMemoryObjectStore({ publicBaseUrl: "http://localhost:8787", idGenerator: () => "obj1" });
    const { id } = await store.put(new TextEncoder().encode("hello"), "image/png");
    const server = buildServer({ objectStore: store });

    const response = await server.inject({ method: "GET", url: `/files/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.body).toBe("hello");
  });

  it("returns 404 for an unknown file id", async () => {
    const server = buildServer({ objectStore: new InMemoryObjectStore() });
    const response = await server.inject({ method: "GET", url: "/files/missing.png" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "File not found" });
  });
  ```

- [ ] **Step 2: Run them to verify they fail**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/server.test.ts -t "files"`
  Expected: FAIL (route 404 for the stored file because the route + option don't exist yet).

- [ ] **Step 3: Create the route** — create `apps/api/src/routes/files.ts`:
  ```ts
  import type { FastifyInstance } from "fastify";
  import type { ObjectStore } from "../services/objectStore";

  export function registerFileRoutes(server: FastifyInstance, objectStore: ObjectStore): void {
    server.get("/files/:id", async (request, reply) => {
      const { id } = request.params as { id: string };
      const object = await objectStore.get(id);

      if (!object) {
        return reply.status(404).send({ error: "File not found" });
      }

      return reply.header("content-type", object.contentType).send(Buffer.from(object.bytes));
    });
  }
  ```

- [ ] **Step 4: Wire it into `buildServer`** — in `apps/api/src/server.ts`:
  - Add imports:
    ```ts
    import { registerFileRoutes } from "./routes/files";
    import { InMemoryObjectStore, type ObjectStore } from "./services/objectStore";
    ```
  - Add `objectStore?: ObjectStore;` to `BuildServerOptions`.
  - Construct the default config-free store and use it in the default composite's image provider. Replace the existing `const providerAdapter = ...` block with:
    ```ts
    const objectStore = options.objectStore ?? new InMemoryObjectStore();
    const providerAdapter =
      options.providerAdapter ??
      new CompositeProviderAdapter({
        text: new OpenAiCompatibleTextProvider(),
        image: new OpenAiCompatibleImageProvider({ objectStore })
      });
    ```
  - Register the file route alongside the others (after `registerAuthRoutes`):
    ```ts
    registerFileRoutes(server, objectStore);
    ```

- [ ] **Step 5: Run the server tests + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api exec vitest run src/__tests__/server.test.ts` then `pnpm --filter @gw-link-omniai/api typecheck`
  Expected: PASS (file route hit/404; "does not load environment config when an auth service is injected" still passes because the default store is config-free).

- [ ] **Step 6: Commit**
  ```bash
  git add apps/api/src/routes/files.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
  git commit -m "feat(api): serve stored files at GET /files/:id

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 5: Compose object storage in the production wiring + e2e

**Files:**
- Modify: `apps/api/src/services/appServices.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/__tests__/dbPersistence.test.ts` (its direct `createDbServices` call gains the new required `objectStore` option)
- Test: `apps/api/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `ObjectStore`, `InMemoryObjectStore`, `LocalFileObjectStore` (Task 1).
- Produces: `AppServices.objectStore: ObjectStore`; `createDbServices(...)` option `objectStore: ObjectStore` (returned).

- [ ] **Step 1: Wire the object store through `appServices.ts`:**
  - Add imports:
    ```ts
    import { InMemoryObjectStore, LocalFileObjectStore, type ObjectStore } from "./objectStore";
    ```
  - Add `objectStore: ObjectStore;` to the `AppServices` interface.
  - Change `createDbServices` to take `objectStore` in its options and pass it to the image provider + return it:
    - Add `objectStore: ObjectStore` to the options type (alongside `authDevCodesEnabled`, `initialCredits`, `providerAdapter?`).
    - In the `GenerationServiceImpl` construction, change the default composite's image provider to `new OpenAiCompatibleImageProvider({ objectStore: options.objectStore })`.
    - Add `objectStore: options.objectStore` to the returned object (alongside `creditService`), and add it to the return type annotation.
  - In `createServices`, build the store from config and thread it:
    - In the in-memory branch, before the `return`, add:
      ```ts
      const objectStore = config.objectStoreDir
        ? new LocalFileObjectStore(config.objectStoreDir, { publicBaseUrl: config.publicBaseUrl })
        : new InMemoryObjectStore({ publicBaseUrl: config.publicBaseUrl });
      ```
      Pass `objectStore` to the in-memory `InMemoryGenerationService`'s composite image provider (`new OpenAiCompatibleImageProvider({ objectStore })`), and add `objectStore,` to the returned object.
    - In the DB branch, build the same `objectStore` and pass it into `createDbServices(client.db, modelCatalog, { authDevCodesEnabled: config.authDevCodesEnabled, initialCredits: config.initialCredits, objectStore })`; the returned `services` already carries `objectStore`, so the existing `return { ...services, modelCatalog, ... }` surfaces it.

- [ ] **Step 1b: Fix the direct `createDbServices` caller** — in `apps/api/src/__tests__/dbPersistence.test.ts`, add `import { InMemoryObjectStore } from "../services/objectStore";` and add `objectStore: new InMemoryObjectStore()` to the options object in the `createDbServices(database.db, modelCatalog, { ... })` call (it now requires `objectStore`). The FakeProviderAdapter used there does not store anything, so an in-memory store just satisfies the signature.

- [ ] **Step 2: Pass the store to `buildServer` in the production entry** — in `apps/api/src/server.ts`'s `if (import.meta.url === ...)` block, add `objectStore: services.objectStore` to the `buildServer({ ... })` call.

- [ ] **Step 3: Add the e2e image-to-file test** — in `apps/api/src/__tests__/server.test.ts`, add a test inside the `describe("product API", ...)` block (the `CompositeProviderAdapter`, `OpenAiCompatibleImageProvider`, `OpenAiCompatibleTextProvider`, `ConfigModelCatalog`, `InMemoryObjectStore`, `authenticate` are all imported/available):
  ```ts
  it("stores a generated image and serves it from /files", async () => {
    const modelConfig: ModelCatalogConfig = {
      providers: [
        {
          id: "openai-main",
          displayName: "OpenAI Main",
          protocol: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          models: [
            {
              id: "gw-image-creative",
              providerModelId: "gpt-image-1",
              displayName: "OmniAI Image Creative",
              capability: "image",
              tags: ["creative"],
              visibility: "visible",
              minimumPlan: "free",
              creditUnitCost: 2
            }
          ]
        }
      ]
    };
    const imageFetch = async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const objectStore = new InMemoryObjectStore({ publicBaseUrl: "http://localhost:8787" });
    const server = buildServer({
      objectStore,
      modelCatalog: new ConfigModelCatalog(modelConfig),
      providerAdapter: new CompositeProviderAdapter({
        text: new OpenAiCompatibleTextProvider(),
        image: new OpenAiCompatibleImageProvider({
          fetch: imageFetch as unknown as typeof fetch,
          env: { OPENAI_API_KEY: "sk-test" },
          objectStore
        })
      })
    });
    const token = await authenticate(server);

    const createResponse = await server.inject({
      method: "POST",
      url: "/v1/generations",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: "image",
        prompt: "一只猫",
        optimizedPrompt: "一只在霓虹城市里的猫",
        preset: {
          modelId: "gw-image-creative",
          parameters: { quality: "high" },
          creditEstimate: { credits: 2, unit: "credit" }
        }
      }
    });

    const url = (createResponse.json() as { task: { result: { url: string } } }).task.result.url;
    expect(url).toMatch(/^http:\/\/localhost:8787\/files\/.+\.png$/);

    const fileResponse = await server.inject({ method: "GET", url: url.replace("http://localhost:8787", "") });
    expect(fileResponse.statusCode).toBe(200);
    expect(fileResponse.headers["content-type"]).toContain("image/png");
    expect(fileResponse.body).toBe("hello");
  });
  ```

- [ ] **Step 4: Run the api suite + typecheck**

  Run: `pnpm --filter @gw-link-omniai/api test` then `pnpm --filter @gw-link-omniai/api typecheck`. Both green (the `appServices.test` instance checks still pass; the e2e proves end-to-end store→serve).

- [ ] **Step 5: Commit**
  ```bash
  git add apps/api/src/services/appServices.ts apps/api/src/server.ts apps/api/src/__tests__/server.test.ts
  git commit -m "feat(api): compose object storage and serve generated images end-to-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 6: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env.example`** — add after the provider-keys block:
  ```bash
  # Public base URL the API is reachable at, used to build generated-file URLs
  # (default http://localhost:<PORT>).
  # GW_LINK_PUBLIC_BASE_URL=https://api.example.com

  # Directory for the local object store (generated image files). When unset,
  # the store is in-memory (lost on restart). When set, files persist on disk.
  # GW_LINK_OBJECT_STORE_DIR=.data/objects
  ```

- [ ] **Step 2: Update `README.md`** — in the "Real Image Generation" section, replace the bullet that says the image `url` is an inline data URL with:
  ```markdown
  - With a provider key, `POST /v1/generations` for an image model calls the
    OpenAI-compatible `images/generations` endpoint and stores the image in an
    object store, returning a `succeeded` task whose `result.url` points at
    `GET /files/<id>` (public, opaque id). Without an object store configured the
    image falls back to an inline `data:` URL.
  ```
  And add a short note: `Set GW_LINK_OBJECT_STORE_DIR to persist files on disk (in-memory otherwise); GW_LINK_PUBLIC_BASE_URL sets the file URL host.`

- [ ] **Step 3: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
  ## Object Storage Slice

  Generated images are stored in an `ObjectStore` (interface + `InMemoryObjectStore`
  default + `LocalFileObjectStore` when `GW_LINK_OBJECT_STORE_DIR` is set), mirroring
  the repository seam. The image provider takes an injected store: it `put`s the
  decoded bytes and returns `${GW_LINK_PUBLIC_BASE_URL}/files/<id>` (opaque id with a
  content-type extension), falling back to an inline `data:` URL when no store is
  given. A public `GET /files/:id` route streams the bytes. One store instance is
  shared between the image provider and the file route. The generation service,
  persistence, credits, desktop, and shared contracts are unchanged. Cloud backends
  (Supabase Storage / S3) behind the same interface, per-user ACL / signed URLs, and
  non-image files remain later slices.
  ```

- [ ] **Step 4: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 5: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md .env.example
  git commit -m "docs: document the object storage slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] No edits to the generation service, repositories/schema, credit logic, desktop, or `packages/shared`.
- [ ] Image generation with a store → `result.url` is `${publicBaseUrl}/files/<id>`; `GET /files/<id>` → 200 + image bytes; unknown id → 404; no store → data URL fallback.
- [ ] The default `buildServer` object store is config-free (the env-config test still passes).
- [ ] Manual check (optional): `OPENAI_API_KEY=… GW_LINK_OBJECT_STORE_DIR=.data/objects pnpm dev:api` + `pnpm dev:desktop`, generate an image, confirm it renders from a `/files/...` URL and the file exists under `.data/objects`.
