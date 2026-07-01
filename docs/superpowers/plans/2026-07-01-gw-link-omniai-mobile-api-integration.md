# GW-LINK OmniAI Mobile API 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect mobile app to real HTTP API with login, generation, task listing, and balance display

**Architecture:** Lift apiClient from desktop to shared (framework-free); mobile adds single-screen App with login→generation→tasks→balance flow, AsyncStorage token persistence. Core flow only—no refresh/save/topup/asset library.

**Tech Stack:** React Native 0.74, Expo 51, @react-native-async-storage/async-storage ^2.1.0, vitest, shared apiClient

## Global Constraints

- Expo SDK 51, React Native 0.74 (apps/mobile)
- apiClient is framework-free (only fetch + shared types)
- AsyncStorage key: `"gw-link-omniai.token"`
- TokenStore interface matches desktop signature: `{ save(token): Promise<void>, load(): Promise<string | null>, clear(): Promise<void> }`
- Mobile App is single-screen (~300 lines): login form → signed-in (balance header + generation form + task list)
- Error messages: 401 → "邮箱未注册或验证码错误" (login) or signedOut+clearToken (generation); 402 → "积分不足，无法生成"; other → "登录/生成失败，请稍后重试"; network → "网络错误"
- Startup restores token via getSession, clears if invalid (silent, non-blocking)
- **Non-goals**: task refresh button, save to asset library, asset list, topup, image/video rendering, multi-screen navigation

---

## Task 1: Lift apiClient to shared

**Files:**
- Move: `apps/desktop/src/apiClient.ts` → `packages/shared/src/apiClient.ts`
- Move: `apps/desktop/src/__tests__/apiClient.test.ts` → `packages/shared/src/__tests__/apiClient.test.ts`
- Modify: `packages/shared/src/index.ts` (export apiClient)
- Modify: `apps/desktop/src/App.tsx` (change import)
- Modify: `apps/desktop/src/apiModel.ts` (change import)

**Interfaces:**
- Consumes: existing `apps/desktop/src/apiClient.ts` (160 lines, ApiError class + createApiClient function)
- Produces: `packages/shared/src/apiClient.ts` (same content, new location); desktop imports from `"@gw-link-omniai/shared"`

- [ ] **Step 1: Move apiClient.ts to shared**

```bash
git mv apps/desktop/src/apiClient.ts packages/shared/src/apiClient.ts
```

Expected: file moved

- [ ] **Step 2: Move apiClient.test.ts to shared**

```bash
git mv apps/desktop/src/__tests__/apiClient.test.ts packages/shared/src/__tests__/apiClient.test.ts
```

Expected: test file moved

- [ ] **Step 3: Update shared index.ts to export apiClient**

在 `packages/shared/src/index.ts` 末尾添加：

```typescript
export { createApiClient, ApiError, type ApiClient, type ApiClientOptions } from "./apiClient.js";
```

- [ ] **Step 4: Update desktop App.tsx import**

在 `apps/desktop/src/App.tsx` 中，找到：

```typescript
import { createApiClient, type ApiClient } from "./apiClient";
```

替换为：

```typescript
import { createApiClient, type ApiClient } from "@gw-link-omniai/shared";
```

- [ ] **Step 5: Update desktop apiModel.ts import**

在 `apps/desktop/src/apiModel.ts` 中，找到：

```typescript
import { createApiClient } from "./apiClient";
```

替换为：

```typescript
import { createApiClient } from "@gw-link-omniai/shared";
```

- [ ] **Step 6: Run shared tests**

```bash
pnpm --filter @gw-link-omniai/shared test
```

Expected: all tests pass (14 original + apiClient tests = 17+)

- [ ] **Step 7: Run desktop tests**

```bash
pnpm --filter @gw-link-omniai/desktop test
```

Expected: 48/48 pass (import change, functionality unchanged)

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/apiClient.ts packages/shared/src/__tests__/apiClient.test.ts packages/shared/src/index.ts apps/desktop/src/App.tsx apps/desktop/src/apiModel.ts
git commit -m "refactor(shared): lift apiClient from desktop to shared

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Mobile tokenStore + AsyncStorage dependency

**Files:**
- Create: `apps/mobile/src/tokenStore.ts`
- Create: `apps/mobile/src/__tests__/tokenStore.test.ts`
- Modify: `apps/mobile/package.json` (add AsyncStorage dependency)

**Interfaces:**
- Consumes: none (new component)
- Produces: `createAsyncStorageTokenStore(): TokenStore` where `TokenStore = { save(token: string): Promise<void>, load(): Promise<string | null>, clear(): Promise<void> }`

- [ ] **Step 1: Write failing tokenStore tests**

创建 `apps/mobile/src/__tests__/tokenStore.test.ts`:

```typescript
import { describe, it, beforeEach, mock } from "vitest";
import { expect } from "vitest";
import { createAsyncStorageTokenStore } from "../tokenStore.js";

// Mock AsyncStorage
const mockStorage = new Map<string, string>();
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    setItem: async (k: string, v: string) => { mockStorage.set(k, v); },
    getItem: async (k: string) => mockStorage.get(k) ?? null,
    removeItem: async (k: string) => { mockStorage.delete(k); },
  },
}));

describe("TokenStore", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it("saves and loads token", async () => {
    const store = createAsyncStorageTokenStore();
    await store.save("test-token-123");
    const loaded = await store.load();
    expect(loaded).toBe("test-token-123");
  });

  it("load returns null when no token", async () => {
    const store = createAsyncStorageTokenStore();
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it("clear removes token", async () => {
    const store = createAsyncStorageTokenStore();
    await store.save("test-token");
    await store.clear();
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @gw-link-omniai/mobile test
```

Expected: FAIL (module not found or function not defined)

- [ ] **Step 3: Add AsyncStorage dependency**

在 `apps/mobile/package.json` 的 `dependencies` 中添加：

```json
"@react-native-async-storage/async-storage": "^2.1.0"
```

然后安装：

```bash
pnpm install
```

- [ ] **Step 4: Write tokenStore implementation**

创建 `apps/mobile/src/tokenStore.ts`:

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "gw-link-omniai.token";

export interface TokenStore {
  save(token: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

export function createAsyncStorageTokenStore(): TokenStore {
  return {
    async save(token: string): Promise<void> {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    },
    async load(): Promise<string | null> {
      return await AsyncStorage.getItem(TOKEN_KEY);
    },
    async clear(): Promise<void> {
      await AsyncStorage.removeItem(TOKEN_KEY);
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @gw-link-omniai/mobile test
```

Expected: 3/3 pass (save+load, load null, clear)

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @gw-link-omniai/mobile typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/tokenStore.ts apps/mobile/src/__tests__/tokenStore.test.ts apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(mobile): add AsyncStorage tokenStore

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Mobile App.tsx

**Files:**
- Create: `apps/mobile/App.tsx` (root, not src/)
- Create: `apps/mobile/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `createApiClient` from `@gw-link-omniai/shared`, `createAsyncStorageTokenStore` from `./src/tokenStore`, types from `@gw-link-omniai/shared`
- Produces: `App` component (single-screen: login form → signed-in with balance+generation+tasks)

- [ ] **Step 1: Write failing App tests**

创建 `apps/mobile/src/__tests__/App.test.tsx`:

```typescript
import { describe, it, beforeEach, vi } from "vitest";
import { expect } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import App from "../../App";
import type { ApiClient } from "@gw-link-omniai/shared";
import type { TokenStore } from "../tokenStore";

// Fake apiClient
function createFakeClient(): ApiClient {
  let balance = 100;
  const tasks: any[] = [];
  return {
    async startLogin() {
      return { challengeId: "ch-1", channel: "email", maskedDestination: "t***@example.com", expiresAt: "2026-07-01T12:00:00Z", devCode: "000000" };
    },
    async verifyLogin() {
      return { token: "tok-1", user: { id: "u1", displayName: "测试用户", destination: "test@example.com", channel: "email", plan: "free", createdAt: "2026-07-01T00:00:00Z" }, expiresAt: "2026-07-08T00:00:00Z" };
    },
    async getSession() {
      return { authenticated: true, user: { id: "u1", displayName: "测试用户", destination: "test@example.com", channel: "email", plan: "free", createdAt: "2026-07-01T00:00:00Z" }, expiresAt: "2026-07-08T00:00:00Z" };
    },
    async getCreditBalance() {
      return { credits: balance, unit: "credit" as const };
    },
    async listGenerations() {
      return tasks;
    },
    async createGeneration(req: any) {
      const task = { id: `t${tasks.length + 1}`, mode: req.mode, status: "succeeded", prompt: req.prompt, optimizedPrompt: req.optimizedPrompt, preset: req.preset, resultPreview: { title: "生成结果", description: "已完成" }, result: { kind: "text", text: "生成的内容", format: "plain" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      tasks.push(task);
      balance -= 1;
      return task;
    },
    async logout() {},
    async optimizePrompt() { throw new Error("Not implemented in test"); },
    async listAssets() { throw new Error("Not implemented in test"); },
    async createAsset() { throw new Error("Not implemented in test"); },
    async getGeneration() { throw new Error("Not implemented in test"); },
    async topUpCredits() { throw new Error("Not implemented in test"); },
  };
}

// Fake tokenStore
function createFakeTokenStore(): TokenStore {
  let stored: string | null = null;
  return {
    async save(token: string) { stored = token; },
    async load() { return stored; },
    async clear() { stored = null; },
  };
}

describe("Mobile App", () => {
  it("login flow", async () => {
    const client = createFakeClient();
    const store = createFakeTokenStore();
    const { getByPlaceholderText, getByText } = render(<App apiClient={client} tokenStore={store} />);

    // Start login
    fireEvent.changeText(getByPlaceholderText("email@example.com"), "test@example.com");
    fireEvent.press(getByText("发送验证码"));

    await waitFor(() => expect(getByText("请输入邮箱中的验证码")).toBeTruthy());

    // Verify login
    fireEvent.changeText(getByPlaceholderText("123456"), "000000");
    fireEvent.press(getByText("验证登录"));

    await waitFor(() => expect(getByText(/积分：100/)).toBeTruthy());
  });

  it("submit generation", async () => {
    const client = createFakeClient();
    const store = createFakeTokenStore();
    await store.save("tok-1");
    const { getByPlaceholderText, getByText } = render(<App apiClient={client} tokenStore={store} />);

    await waitFor(() => expect(getByText(/积分：100/)).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText("描述你想生成的内容"), "测试提示词");
    fireEvent.press(getByText("生成"));

    await waitFor(() => expect(getByText(/积分：99/)).toBeTruthy());
    await waitFor(() => expect(getByText(/测试提示词/)).toBeTruthy());
  });

  it("restore session on startup", async () => {
    const client = createFakeClient();
    const store = createFakeTokenStore();
    await store.save("tok-1");

    const { getByText } = render(<App apiClient={client} tokenStore={store} />);

    await waitFor(() => expect(getByText(/积分：100/)).toBeTruthy());
  });

  it("clear token on getSession 401", async () => {
    const client = createFakeClient();
    client.getSession = async () => { throw { status: 401, message: "Unauthorized" }; };
    const store = createFakeTokenStore();
    await store.save("bad-token");

    render(<App apiClient={client} tokenStore={store} />);

    await waitFor(async () => {
      const loaded = await store.load();
      expect(loaded).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @gw-link-omniai/mobile test
```

Expected: FAIL (App component not found)

- [ ] **Step 3: Write minimal App implementation**

创建 `apps/mobile/App.tsx`:

```typescript
import React, { useState, useEffect } from "react";
import { SafeAreaView, View, Text, TextInput, Button, FlatList, StyleSheet } from "react-native";
import { Picker } from "@react-native-picker/picker";
import { createApiClient, ApiError, type ApiClient, type GenerationTask } from "@gw-link-omniai/shared";
import { createAsyncStorageTokenStore, type TokenStore } from "./src/tokenStore";

type Stage = "signedOut" | "signingIn" | "signedIn";

interface AppProps {
  apiClient?: ApiClient;
  tokenStore?: TokenStore;
}

export default function App({
  apiClient = createApiClient(),
  tokenStore = createAsyncStorageTokenStore(),
}: AppProps) {
  const [stage, setStage] = useState<Stage>("signedOut");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"text" | "image" | "video">("text");
  const [preset] = useState({ modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" as const } });
  const [actionError, setActionError] = useState<string | null>(null);

  // 启动恢复
  useEffect(() => {
    const restoreSession = async () => {
      const storedToken = await tokenStore.load();
      if (!storedToken) return;
      try {
        await apiClient.getSession(storedToken);
        setToken(storedToken);
        await loadUserData(storedToken);
        setStage("signedIn");
      } catch {
        await tokenStore.clear();
      }
    };
    restoreSession();
  }, []);

  const loadUserData = async (authToken: string) => {
    const [balanceResp, tasksResp] = await Promise.all([
      apiClient.getCreditBalance(authToken),
      apiClient.listGenerations(authToken),
    ]);
    setBalance(balanceResp.credits);
    setTasks(tasksResp);
  };

  const handleStartLogin = async () => {
    setActionError(null);
    try {
      const challenge = await apiClient.startLogin({ destination: email });
      setChallengeId(challenge.challengeId);
      setStage("signingIn");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setActionError("邮箱未注册或验证码错误");
        } else {
          setActionError("登录失败，请稍后重试");
        }
      } else {
        setActionError("网络错误");
      }
    }
  };

  const handleVerifyLogin = async () => {
    if (!challengeId) return;
    setActionError(null);
    try {
      const session = await apiClient.verifyLogin({ challengeId, code });
      setToken(session.token);
      await tokenStore.save(session.token);
      await loadUserData(session.token);
      setStage("signedIn");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setActionError("邮箱未注册或验证码错误");
        } else {
          setActionError("登录失败，请稍后重试");
        }
      } else {
        setActionError("网络错误");
      }
    }
  };

  const handleSignedOut = async () => {
    setToken(null);
    setBalance(null);
    setTasks([]);
    await tokenStore.clear();
    setStage("signedOut");
  };

  const handleSubmitGeneration = async () => {
    if (!token) return;
    setActionError(null);
    try {
      await apiClient.createGeneration({ mode, prompt, optimizedPrompt: prompt, preset }, token);
      const tasksResp = await apiClient.listGenerations(token);
      setTasks(tasksResp);
      const balanceResp = await apiClient.getCreditBalance(token);
      setBalance(balanceResp.credits);
      setPrompt("");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          await handleSignedOut();
        } else if (err.status === 402) {
          setActionError("积分不足，无法生成");
        } else {
          setActionError("生成失败，请稍后重试");
        }
      } else {
        setActionError("网络错误");
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {stage === "signedOut" && (
        <View>
          <Text>邮箱登录</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="email@example.com"
            style={styles.input}
          />
          <Button title="发送验证码" onPress={handleStartLogin} />
          {actionError && <Text style={styles.error}>{actionError}</Text>}
        </View>
      )}

      {stage === "signingIn" && (
        <View>
          <Text>请输入邮箱中的验证码</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            style={styles.input}
          />
          <Button title="验证登录" onPress={handleVerifyLogin} />
          {actionError && <Text style={styles.error}>{actionError}</Text>}
        </View>
      )}

      {stage === "signedIn" && (
        <>
          <View style={styles.header}>
            <Text>积分：{balance ?? "..."}</Text>
            <Button title="登出" onPress={handleSignedOut} />
          </View>
          <View style={styles.form}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="描述你想生成的内容"
              multiline
              style={styles.input}
            />
            <Picker selectedValue={mode} onValueChange={(v) => setMode(v as "text" | "image" | "video")}>
              <Picker.Item label="文本" value="text" />
              <Picker.Item label="图片" value="image" />
              <Picker.Item label="视频" value="video" />
            </Picker>
            <Button title="生成" onPress={handleSubmitGeneration} />
            {actionError && <Text style={styles.error}>{actionError}</Text>}
          </View>
          <FlatList
            data={tasks}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.task}>
                <Text>ID: {item.id}</Text>
                <Text>状态: {item.status}</Text>
                <Text>提示词: {item.prompt}</Text>
                {item.result?.kind === "text" && (
                  <Text numberOfLines={2}>结果: {item.result.text}</Text>
                )}
              </View>
            )}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  form: { marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 8, marginBottom: 8 },
  task: { padding: 8, borderBottomWidth: 1, borderColor: "#ccc" },
  error: { color: "red", marginTop: 8 },
});
```

- [ ] **Step 4: Add @react-native-picker/picker dependency**

在 `apps/mobile/package.json` 的 `dependencies` 中添加：

```json
"@react-native-picker/picker": "^2.4.0"
```

然后安装：

```bash
pnpm install
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @gw-link-omniai/mobile test
```

Expected: 7/7 pass (tokenStore 3 + App 4)

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @gw-link-omniai/mobile typecheck
```

Expected: no errors

- [ ] **Step 7: Run full workspace tests**

```bash
pnpm test
```

Expected: shared/mobile/desktop/api/admin all green

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/App.tsx apps/mobile/src/__tests__/App.test.tsx apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(mobile): add single-screen App with login/generation/tasks/balance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

**Interfaces:**
- Consumes: completed Slice 13 implementation
- Produces: updated documentation

- [ ] **Step 1: Update README.md**

在 README.md 的 "Credit Foundation" 段落后添加（在 "Real Image Generation" 之前）：

```markdown
### Mobile API Integration

The eleventh product-first slice connects the mobile app to the product API.

- apiClient lifted to `packages/shared` (framework-free, consumed by desktop and mobile)
- Mobile adds a single-screen App: login form → signed-in (balance header + generation form + task list)
- AsyncStorage token persistence: startup validates stored token with `GET /v1/auth/session` and restores session (invalid tokens cleared)
- Core flow operational: login, generate, list tasks, show balance
- Not included: task refresh button, save to asset library, asset list, topup, image/video rendering (later slices)
```

- [ ] **Step 2: Update mvp-skeleton.md**

在 `docs/architecture/mvp-skeleton.md` 末尾添加新段落：

```markdown
## Mobile API Integration Slice

`apiClient` lifted from `apps/desktop` to `packages/shared` (framework-free); both desktop
and mobile import from `@gw-link-omniai/shared`. Mobile adds a single-screen `App.tsx`
(login form → signed-in with balance header + generation form + task FlatList) and
AsyncStorage-backed `tokenStore` (mirrors desktop interface). Startup restores token via
`getSession`; invalid tokens cleared silently. Core flow operational: login, generate
(text/image/video), list tasks, show balance. Task refresh, save to assets, asset library,
topup, and image/video rendering remain later slices. Mobile now has feature parity with
desktop for core generation workflow.
```

- [ ] **Step 3: Run full workspace validation**

```bash
pnpm test
pnpm typecheck
```

Expected: all tests pass, no typecheck errors

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document mobile API integration (Slice 13)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Task 1: apiClient → shared (spec section 1)
- ✅ Task 2: mobile tokenStore + AsyncStorage (spec section 2)
- ✅ Task 3: mobile App.tsx (spec section 3)
- ✅ Task 4: documentation (spec交付清单)

**Placeholder scan:**
- ✅ No TBD/TODO
- ✅ All code blocks complete
- ✅ All test assertions concrete
- ✅ All commands with expected output

**Type consistency:**
- ✅ TokenStore interface matches across tasks
- ✅ ApiClient interface from shared
- ✅ Error handling consistent (401/402/network)
- ✅ Stage type consistent ("signedOut" | "signingIn" | "signedIn")

---

## Execution Notes

- Each task is independently testable (TDD flow)
- Task 1 moves files, updates imports (desktop tests stay green)
- Task 2 adds mobile tokenStore (vitest mocks AsyncStorage)
- Task 3 adds mobile App (~300 lines, single screen, fake apiClient/tokenStore in tests)
- Task 4 updates docs
- Total: 4 commits, ~450 new mobile lines (App + tokenStore + tests)
