# GW-LINK OmniAI Desktop Credit Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the user's credit balance in the desktop header (loaded on login, refreshed after each generation) and handle the insufficient-balance `402` with a friendly Chinese message.

**Architecture:** Add `apiClient.getCreditBalance(token)` (GET `/v1/credits/balance`, unwrap `{ balance }`); a framework-free `formatCreditBalance(balance)` → "积分：N"; and wire `App.tsx` to load/refresh/display the balance and map a `402` from `createGeneration` to "积分不足，无法生成". Frontend-only; no backend or `packages/shared` change.

**Tech Stack:** TypeScript (strict, ESM), React 18, Vite, Vitest + @testing-library/react + jsdom, pnpm workspaces, Node 20.

**Spec:** `docs/superpowers/specs/2026-06-22-gw-link-omniai-desktop-credit-balance-design.md` (approved).

## Global Constraints (apply to every task)

1. No backend (`apps/api`) or `packages/shared` change — `GET /v1/credits/balance` and `CreditAmount` already exist.
2. Balance label is exactly `积分：${balance.credits}` (e.g. "积分：100"). The 402 message is exactly "积分不足，无法生成".
3. Balance loads in `handleVerifyLogin` (in the existing `Promise.all`), refreshes after a successful `handleSubmitGeneration`, and clears on `handleSignedOut`. Asset save does NOT refresh balance.
4. `402` handling is reactive (no proactive button disabling): in `handleSubmitGeneration`'s catch, after the existing `401 → handleSignedOut` branch, add `402 → setActionError("积分不足，无法生成")` and return.
5. Each task ends green: `pnpm --filter @gw-link-omniai/desktop test` + `... typecheck` before committing. Final task runs root `pnpm test` + `pnpm typecheck`.

## File Structure

- Modify: `apps/desktop/src/apiClient.ts` — add `getCreditBalance`.
- Modify: `apps/desktop/src/__tests__/apiClient.test.ts` — `getCreditBalance` test.
- Create: `apps/desktop/src/creditModel.ts` — `formatCreditBalance`.
- Create: `apps/desktop/src/__tests__/creditModel.test.ts` — its test.
- Modify: `apps/desktop/src/App.tsx` — balance state/display/refresh/402.
- Modify: `apps/desktop/src/__tests__/App.test.tsx` — fake `getCreditBalance` + balance/402 tests.
- Modify: `README.md`, `docs/architecture/mvp-skeleton.md` — docs.

---

## Task 1: `apiClient.getCreditBalance`

**Files:**
- Modify: `apps/desktop/src/apiClient.ts`
- Test: `apps/desktop/src/__tests__/apiClient.test.ts`
- Modify (keep typecheck green): `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: `ApiClient.getCreditBalance(token: string): Promise<CreditAmount>`.

- [ ] **Step 1: Write the failing test** — in `apps/desktop/src/__tests__/apiClient.test.ts`, add (match the file's existing `baseUrl` constant and `jsonResponse` helper — the apiClient test file already uses them for the other methods):
  ```ts
  it("fetches the credit balance with the bearer token and unwraps the envelope", async () => {
    const balance = { credits: 100, unit: "credit" };
    const fetchMock = vi.fn(async () => jsonResponse({ balance }));
    const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

    const result = await client.getCreditBalance("tok-1");

    expect(result).toEqual(balance);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/v1/credits/balance");
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });
  ```
  (If the file's `baseUrl` differs from `http://api.test`, adjust the asserted URL literal to match.)

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/apiClient.test.ts -t "credit balance"`
  Expected: FAIL (`getCreditBalance` is not a function).

- [ ] **Step 3: Implement it** — in `apps/desktop/src/apiClient.ts`:
  - Add `CreditAmount` to the `@gw-link-omniai/shared` import.
  - Add to the `ApiClient` interface (after `createAsset`):
    ```ts
    getCreditBalance(token: string): Promise<CreditAmount>;
    ```
  - Add the implementation in the returned object (after `createAsset`):
    ```ts
    async getCreditBalance(token) {
      const { balance } = await send<{ balance: CreditAmount }>("/v1/credits/balance", { token });
      return balance;
    }
    ```

- [ ] **Step 4: Keep `App.test.tsx` typecheck green** — adding `getCreditBalance` to the `ApiClient` interface breaks `createFakeClient` (TS2741). Add a minimal stub to the base fake object in `apps/desktop/src/__tests__/App.test.tsx` (Task 3 replaces it with a stateful version):
  ```ts
  getCreditBalance: async () => ({ credits: 100, unit: "credit" as const }),
  ```
  Place it as the last property of the `base` object (after `listAssets`).

- [ ] **Step 5: Run desktop tests + typecheck**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/apiClient.test.ts` then `pnpm --filter @gw-link-omniai/desktop typecheck`
  Expected: PASS / green.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/desktop/src/apiClient.ts apps/desktop/src/__tests__/apiClient.test.ts apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): add apiClient.getCreditBalance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 2: `formatCreditBalance`

**Files:**
- Create: `apps/desktop/src/creditModel.ts`
- Test: `apps/desktop/src/__tests__/creditModel.test.ts`

**Interfaces:**
- Produces: `formatCreditBalance(balance: CreditAmount): string`.

- [ ] **Step 1: Write the failing test** — create `apps/desktop/src/__tests__/creditModel.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { formatCreditBalance } from "../creditModel";

  describe("formatCreditBalance", () => {
    it("formats a credit amount as a Chinese label", () => {
      expect(formatCreditBalance({ credits: 100, unit: "credit" })).toBe("积分：100");
    });

    it("formats a zero balance", () => {
      expect(formatCreditBalance({ credits: 0, unit: "credit" })).toBe("积分：0");
    });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/creditModel.test.ts`
  Expected: FAIL (`creditModel` module does not exist).

- [ ] **Step 3: Implement it** — create `apps/desktop/src/creditModel.ts`:
  ```ts
  import type { CreditAmount } from "@gw-link-omniai/shared";

  export function formatCreditBalance(balance: CreditAmount): string {
    return `积分：${balance.credits}`;
  }
  ```

- [ ] **Step 4: Run it to verify it passes**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/creditModel.test.ts`
  Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop typecheck` (green).
  ```bash
  git add apps/desktop/src/creditModel.ts apps/desktop/src/__tests__/creditModel.test.ts
  git commit -m "feat(desktop): add formatCreditBalance helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 3: App balance display + refresh + 402

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getCreditBalance` (Task 1), `formatCreditBalance` (Task 2).

- [ ] **Step 1: Wire the balance into `App.tsx`:**
  - Add `CreditAmount` to the `@gw-link-omniai/shared` type import (alongside `CreationAsset`, `CreationMode`, ...).
  - Add the helper import:
    ```ts
    import { formatCreditBalance } from "./creditModel";
    ```
  - Add state (after the `assets` state line):
    ```ts
    const [balance, setBalance] = useState<CreditAmount | undefined>(undefined);
    ```
  - In `handleSignedOut`, add `setBalance(undefined);` (next to `setAssets([]);`).
  - In `handleVerifyLogin`, extend the `Promise.all` to load the balance:
    ```ts
    const [loadedTasks, loadedAssets, loadedBalance] = await Promise.all([
      api.listGenerations(authSession.token),
      api.listAssets(authSession.token),
      api.getCreditBalance(authSession.token)
    ]);
    setTasks(loadedTasks);
    setAssets(loadedAssets);
    setBalance(loadedBalance);
    ```
  - In `handleSubmitGeneration`, after `setTasks(await api.listGenerations(token));`, refresh the balance:
    ```ts
    setBalance(await api.getCreditBalance(token));
    ```
  - In `handleSubmitGeneration`'s catch, after the existing `401` branch, add the 402 branch:
    ```ts
    if (error instanceof ApiError && error.status === 402) {
      setActionError("积分不足，无法生成");
      return;
    }
    ```
  - In the signed-in `return`'s `<header>` (the one with the 登出 button), render the balance after the session CTA button:
    ```tsx
    {balance ? <p>{formatCreditBalance(balance)}</p> : null}
    ```

- [ ] **Step 2: Make the fake client stateful + add the tests** — in `apps/desktop/src/__tests__/App.test.tsx`:
  - Add `ApiError` to the import from `../apiClient` (it currently imports only the `ApiClient` type):
    ```ts
    import { ApiError, type ApiClient } from "../apiClient";
    ```
  - In `createFakeClient`, add a `balance` counter next to `let tasks`/`let assets`:
    ```ts
    let balance = 100;
    ```
  - In the fake `createGeneration`, after `tasks = [task, ...tasks];` and before `return task;`, mirror the backend deduction for a succeeded text task:
    ```ts
    if (task.status === "succeeded" && task.result?.kind === "text") {
      balance -= 1;
    }
    ```
  - Replace the Task-1 stub `getCreditBalance` with the stateful version:
    ```ts
    getCreditBalance: async () => ({ credits: balance, unit: "credit" as const }),
    ```
  - Add these tests (after the "saves a succeeded text task to the asset library" test):
    ```ts
    it("shows the credit balance in the header after login", async () => {
      const client = createFakeClient();
      await signIn(client);

      expect(await screen.findByText("积分：100")).toBeTruthy();
    });

    it("refreshes the balance after a generation", async () => {
      const client = createFakeClient();
      await signIn(client);
      await screen.findByText("积分：100");

      fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
      await screen.findByLabelText("提示词优化结果");
      fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

      expect(await screen.findByText("积分：99")).toBeTruthy();
    });

    it("shows a friendly message when generation is rejected for insufficient credits", async () => {
      const client = createFakeClient({
        createGeneration: async () => {
          throw new ApiError("Insufficient credits", 402);
        }
      });
      await signIn(client);

      fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
      await screen.findByLabelText("提示词优化结果");
      fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

      expect(await screen.findByText("积分不足，无法生成")).toBeTruthy();
      // still signed in
      expect(screen.getByRole("button", { name: "Signed in as creator" })).toBeTruthy();
    });
    ```

- [ ] **Step 3: Run the desktop App test**

  Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`
  Expected: PASS (balance shows 100 after login, 99 after a generation, friendly 402 message; existing tests still green — `signIn` is unaffected since the balance `<p>` is additive).

- [ ] **Step 4: Full desktop check + commit**

  Run: `pnpm --filter @gw-link-omniai/desktop test` then `pnpm --filter @gw-link-omniai/desktop typecheck`. Both green.
  ```bash
  git add apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
  git commit -m "feat(desktop): show credit balance and handle insufficient-credit 402

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Task 4: Documentation + final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update `README.md`** — in the "Credit Foundation" section, add a bullet after the `GET /v1/credits/balance` bullet:
  ```markdown
  - The desktop shows the balance in the header (loaded on login, refreshed after
    each generation) and shows a friendly "积分不足，无法生成" message when a
    generation is rejected for insufficient credits (`402`).
  ```
  And remove/replace the trailing "desktop balance display / 402 handling are later slices" clause from the last bullet of that section so it no longer claims the desktop work is deferred (change it to note only concurrent-atomicity and payment/top-up remain later).

- [ ] **Step 2: Update `docs/architecture/mvp-skeleton.md`** — append a section:
  ```markdown
  ## Desktop Credit Balance Slice

  The desktop closes the credit-foundation loop on the client. `apiClient`
  gains `getCreditBalance`, a framework-free `formatCreditBalance` renders
  "积分：N", and `App.tsx` loads the balance on login (in the same `Promise.all`
  as tasks/assets), refreshes it after each generation, clears it on sign-out,
  and maps an insufficient-credit `402` from `POST /v1/generations` to a friendly
  "积分不足，无法生成" message (reactive — no proactive button disabling, since the
  client's `creditEstimate` may differ from the server's authoritative
  `creditUnitCost`). No backend or shared-contract change. Top-up/payment and
  admin/mobile balance display remain later slices.
  ```

- [ ] **Step 3: Full workspace verification**

  Run from the repo root: `pnpm test` then `pnpm typecheck`. Both green.

- [ ] **Step 4: Commit**
  ```bash
  git add README.md docs/architecture/mvp-skeleton.md
  git commit -m "docs: document the desktop credit balance slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Final Verification (after all tasks)

- [ ] `pnpm test` + `pnpm typecheck` pass across all packages.
- [ ] No edits under `apps/api/` or `packages/shared/`.
- [ ] Header shows "积分：100" after login, "积分：99" after a succeeded text generation, cleared after logout.
- [ ] A `402` from generation shows "积分不足，无法生成" without signing the user out.
- [ ] Manual check (optional): `GW_LINK_INITIAL_CREDITS=2 pnpm dev:api` + `pnpm dev:desktop`, log in (header shows 积分：2), generate twice with a provider key, then a third generation shows the insufficient-credit message.
