# GW-LINK OmniAI Session Token Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the desktop bearer token and restore the session on startup (validated via `getSession`), so users aren't forced to re-login after every restart.

**Architecture:** An injectable `TokenStore` (default `localStorage`) holds the token. `apiClient` gains `getSession`. On mount, `App` loads any stored token, validates it via `getSession`, and restores the session (loading tasks/assets/balance) when authenticated — clearing the token otherwise. The token is saved on login and cleared on logout/401. Frontend-only; no backend or `packages/shared` change.

**Tech Stack:** TypeScript (strict, ESM), React 18, Vite, Vitest + @testing-library/react + jsdom, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-22-gw-link-omniai-token-persistence-design.md` (approved).

## Global Constraints (apply to every task)

1. No backend (`apps/api`) or `packages/shared` change — `GET /v1/auth/session` and `SessionResponse` already exist.
2. `TokenStore` key is `"gw-link-omniai.token"`. The localStorage default is a no-op when `localStorage` is undefined (non-browser).
3. Startup restore: stored token → `getSession`; `authenticated && user` → restore session + `loadUserData`; otherwise (not authenticated OR error) → `tokenStore.clear()`, stay signed out. A `loadUserData` error (already authenticated) does NOT clear the token.
4. Save the token in `handleVerifyLogin` on success; clear it in `handleSignedOut` (covers logout + 401).
5. Each task ends green: `pnpm --filter @gw-link-omniai/desktop test` + `... typecheck` before committing. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- Modify: `apps/desktop/src/apiClient.ts` (+ `__tests__/apiClient.test.ts`) — `getSession` (Task 1).
- Create: `apps/desktop/src/tokenStore.ts` (+ `__tests__/tokenStore.test.ts`) (Task 2).
- Modify: `apps/desktop/src/App.tsx` (+ `__tests__/App.test.tsx`) — restore wiring (Task 3).
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md` (Task 4).

---

## Task 1: `apiClient.getSession`

**Files:**
- Modify: `apps/desktop/src/apiClient.ts`
- Test: `apps/desktop/src/__tests__/apiClient.test.ts`
- Modify (keep typecheck green): `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: `ApiClient.getSession(token: string): Promise<SessionResponse>`.

- [ ] **Step 1: Write the failing test** — in `apps/desktop/src/__tests__/apiClient.test.ts`, add (file already has `jsonResponse` + `baseUrl = "http://api.test"`):
  ```ts
  it("fetches the session with the bearer token", async () => {
    const session = {
      authenticated: true,
      user: {
        id: "user_email_creator",
        displayName: "creator",
        destination: "creator@example.com",
        channel: "email",
        plan: "free",
        createdAt: "2026-06-22T00:00:00.000Z"
      },
      expiresAt: "2026-06-29T00:00:00.000Z"
    };
    const fetchMock = vi.fn(async () => jsonResponse(session));
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const result = await client.getSession("tok-1");

    expect(result).toEqual(session);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/v1/auth/session");
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/apiClient.test.ts -t "fetches the session"`
  Expected: FAIL (`getSession` is not a function).

- [ ] **Step 3: Implement it** — in `apps/desktop/src/apiClient.ts`:
  - Add `SessionResponse` to the `@gw-link-omniai/shared` import.
  - Add to the `ApiClient` interface (after `getCreditBalance`):
    ```ts
    getSession(token: string): Promise<SessionResponse>;
    ```
  - Add the implementation in the returned object (after `getCreditBalance`):
    ```ts
    getSession(token) {
      return send<SessionResponse>("/v1/auth/session", { token });
    }
    ```

- [ ] **Step 4: Keep `App.test.tsx` typecheck green** — adding `getSession` to `ApiClient` breaks `createFakeClient` (TS2741). Add a default to the `base` fake object in `apps/desktop/src/__tests__/App.test.tsx` (after `getCreditBalance`):
  ```ts
  getSession: async () => ({ authenticated: false, user: null, expiresAt: null })
  ```

- [ ] **Step 5: Run desktop tests + typecheck**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/apiClient.test.ts` then `pnpm --filter @gw-link-omniai/desktop typecheck`
  Expected: PASS / green.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/desktop/src/apiClient.ts apps/desktop/src/__tests__/apiClient.test.ts apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): add apiClient.getSession

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: `TokenStore`

**Files:**
- Create: `apps/desktop/src/tokenStore.ts`
- Test: `apps/desktop/src/__tests__/tokenStore.test.ts`

**Interfaces:**
- Produces: `TokenStore { load(): string | undefined; save(token: string): void; clear(): void }`; `createLocalStorageTokenStore(): TokenStore`.

- [ ] **Step 1: Write the failing test** — create `apps/desktop/src/__tests__/tokenStore.test.ts`:
  ```ts
  import { afterEach, describe, expect, it } from "vitest";
  import { createLocalStorageTokenStore } from "../tokenStore";

  afterEach(() => localStorage.clear());

  describe("createLocalStorageTokenStore", () => {
    it("saves, loads, and clears a token", () => {
      const store = createLocalStorageTokenStore();
      expect(store.load()).toBeUndefined();

      store.save("tok-1");
      expect(store.load()).toBe("tok-1");

      store.clear();
      expect(store.load()).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/tokenStore.test.ts`
  Expected: FAIL (`tokenStore` module does not exist).

- [ ] **Step 3: Implement it** — create `apps/desktop/src/tokenStore.ts`:
  ```ts
  export interface TokenStore {
    load(): string | undefined;
    save(token: string): void;
    clear(): void;
  }

  const TOKEN_KEY = "gw-link-omniai.token";

  export function createLocalStorageTokenStore(): TokenStore {
    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    return {
      load: () => storage?.getItem(TOKEN_KEY) ?? undefined,
      save: (token) => storage?.setItem(TOKEN_KEY, token),
      clear: () => storage?.removeItem(TOKEN_KEY)
    };
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/tokenStore.test.ts`
  Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop typecheck` (green).
  ```bash
  git add apps/desktop/src/tokenStore.ts apps/desktop/src/__tests__/tokenStore.test.ts
  git commit -m "feat(desktop): add localStorage TokenStore

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: App startup restore + save/clear

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getSession` (Task 1), `TokenStore` + `createLocalStorageTokenStore` (Task 2).

- [ ] **Step 1: Wire persistence into `App.tsx`:**
  - Change the React import to include `useEffect`: `import { useEffect, useMemo, useState } from "react";`.
  - Add the token-store import: `import { createLocalStorageTokenStore, type TokenStore } from "./tokenStore";`.
  - Change the component signature + add the store memo:
    ```ts
    export function App({ client, tokenStore }: { client?: ApiClient; tokenStore?: TokenStore } = {}) {
      const api = useMemo(() => client ?? createApiClient(), [client]);
      const store = useMemo(() => tokenStore ?? createLocalStorageTokenStore(), [tokenStore]);
    ```
  - Add a `loadUserData` helper (above `handleSignedOut`):
    ```ts
    async function loadUserData(authToken: string) {
      const [loadedTasks, loadedAssets, loadedBalance] = await Promise.all([
        api.listGenerations(authToken),
        api.listAssets(authToken),
        api.getCreditBalance(authToken)
      ]);
      setTasks(loadedTasks);
      setAssets(loadedAssets);
      setBalance(loadedBalance);
    }
    ```
  - In `handleSignedOut`, add `store.clear();` as the first statement.
  - In `handleVerifyLogin`, after `setToken(authSession.token);` add `store.save(authSession.token);`, and replace the inline `Promise.all([...])` + `setTasks/setAssets/setBalance` block with `await loadUserData(authSession.token);`.
  - Add the startup restore effect (after the `loadUserData` helper / before the early `if (!session.authenticated)` return, anywhere in the component body among the other hooks):
    ```ts
    useEffect(() => {
      let cancelled = false;
      async function restoreSession() {
        const stored = store.load();
        if (!stored) {
          return;
        }
        try {
          const restored = await api.getSession(stored);
          if (cancelled) {
            return;
          }
          if (restored.authenticated && restored.user) {
            setToken(stored);
            setSession({ authenticated: true, user: restored.user, expiresAt: restored.expiresAt });
            await loadUserData(stored);
          } else {
            store.clear();
          }
        } catch {
          store.clear();
        }
      }
      void restoreSession();
      return () => {
        cancelled = true;
      };
    }, [api, store]);
    ```

- [ ] **Step 2: Update the App tests** — in `apps/desktop/src/__tests__/App.test.tsx`:
  - Add a localStorage reset to the existing `afterEach` (so the default-store path can't leak tokens between tests). Next to `afterEach(cleanup);` add:
    ```ts
    afterEach(() => localStorage.clear());
    ```
  - Add `import type { TokenStore } from "../tokenStore";` and a fake-store helper near `createFakeClient`:
    ```ts
    function createFakeTokenStore(initial?: string): TokenStore {
      let token = initial;
      return {
        load: () => token,
        save: (value: string) => {
          token = value;
        },
        clear: () => {
          token = undefined;
        }
      };
    }
    ```
  - Add tests (after the existing balance tests):
    ```ts
    it("restores the session on startup from a stored token", async () => {
      const client = createFakeClient({
        getSession: async () => ({ authenticated: true, user: authSession.user, expiresAt: authSession.expiresAt })
      });
      const store = createFakeTokenStore("tok-1");

      render(<App client={client} tokenStore={store} />);

      expect(await screen.findByRole("button", { name: "Signed in as creator" })).toBeTruthy();
      expect(await screen.findByText("积分：100")).toBeTruthy();
    });

    it("clears a stored token that no longer authenticates", async () => {
      const client = createFakeClient({
        getSession: async () => ({ authenticated: false, user: null, expiresAt: null })
      });
      const store = createFakeTokenStore("stale");

      render(<App client={client} tokenStore={store} />);

      expect(await screen.findByRole("button", { name: "发送验证码" })).toBeTruthy();
      expect(store.load()).toBeUndefined();
    });

    it("saves the token on login and clears it on logout", async () => {
      const client = createFakeClient();
      const store = createFakeTokenStore();
      render(<App client={client} tokenStore={store} />);

      fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
      await screen.findByText("开发验证码：123456");
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await screen.findByRole("button", { name: "Signed in as creator" });
      expect(store.load()).toBe("tok-1");

      fireEvent.click(screen.getByRole("button", { name: "登出" }));
      await screen.findByRole("button", { name: "发送验证码" });
      expect(store.load()).toBeUndefined();
    });
    ```
    (`authSession.token` is `"tok-1"` in the existing fixture, so the login test asserts `"tok-1"`. `authSession.user.displayName` is `creator`, giving the "Signed in as creator" CTA. The balance fake returns 100.)

- [ ] **Step 3: Run the desktop App test**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`
  Expected: PASS (restore/clear/save tests green; existing tests still green — they render without a `tokenStore`, the default localStorage starts empty each test via `afterEach`, so no auto-restore).

- [ ] **Step 4: Full desktop check + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`. Both green.
  ```bash
  git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): persist token and restore session on startup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update `README.md`** — in the "Desktop ↔ API" section, the bullet that says the bearer session is "held in memory — re-login after restart" should be updated to reflect persistence. Change that clause to:
  ```markdown
  - The bearer session is persisted via an injectable `TokenStore` (default
    `localStorage`); on startup the desktop validates the stored token with
    `GET /v1/auth/session` and restores the session, so a restart no longer
    requires re-login (invalid/expired tokens are cleared).
  ```

- [ ] **Step 2: Update `docs/architecture/mvp-skeleton.md`** — append:
  ```markdown
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
  ```

- [ ] **Step 3: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 4: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md
  git commit -m "docs: document the session token persistence slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] No edits under `apps/api/` or `packages/shared/`.
- [ ] Startup with a valid stored token restores the session (no login form); with an invalid token, the token is cleared and the login form shows.
- [ ] Login saves the token; logout clears it.
- [ ] Manual check (optional): `pnpm dev:api` + `pnpm dev:desktop`, log in, restart the desktop app, confirm you're still signed in.
