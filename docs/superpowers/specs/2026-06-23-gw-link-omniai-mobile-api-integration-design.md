# GW-LINK OmniAI Mobile API 集成设计规格

**日期**: 2026-06-23  
**作者**: AI assistant (Opus 4.8)  
**状态**: 草稿  
**Slice**: 13 — Mobile API 集成

---

## 摘要

将 GW-LINK OmniAI 核心流程接入 React Native 移动端：提升 apiClient 到 shared（复用跨端），mobile 新增单屏 App（登录→生成→任务列表→余额显示）+ AsyncStorage 令牌持久化。范围覆盖核心流程（登录/生成/查询/扣费），不含刷新按钮/保存资产/资产库/充值（留后续 Slice）。

---

## 动机

**为什么要做**：桌面端已打通完整流程（Slices 1-12），mobile 端仅有 Expo skeleton（Slice 4）但未接 API。用户需要移动端也能登录、发起生成、查看任务、显示余额，核心体验与桌面一致。

**为什么是现在**：后端（auth/generation/credit/object storage）已稳定，桌面端验证了设计，现在是最佳时机把 apiClient 提升到 shared 并接入 mobile。

**不做什么（非目标）**：
- 任务刷新按钮/手动刷新（Slice 14 再做）
- 保存生成结果到资产库、资产列表展示（Slice 15）
- 充值/支付（Slice 16）
- 图片/视频结果渲染（Slice 17，当前仅显示文本结果预览）
- 多屏 navigation / tabs（单屏够核心流程）
- iOS Keychain / Android Keystore（AsyncStorage 先行，Slice 18 安全加固）

---

## 设计

### 架构概览

```
packages/shared/
  └─ src/
     ├─ apiClient.ts          ← 从 desktop 提升（framework-free）
     └─ __tests__/
        └─ apiClient.test.ts  ← 随文件移动

apps/desktop/
  └─ src/
     ├─ App.tsx               ← 改 import: from "@gw-link-omniai/shared"
     └─ apiModel.ts           ← 改 import

apps/mobile/
  └─ src/
     ├─ App.tsx               ← 新增（单屏，~300 行）
     ├─ tokenStore.ts         ← 新增（AsyncStorage 实现）
     └─ __tests__/
        ├─ tokenStore.test.ts ← 新增
        └─ App.test.tsx       ← 新增
```

---

### 1. shared apiClient 提升

#### 目标
把 `apps/desktop/src/apiClient.ts` 提升到 `packages/shared/src/apiClient.ts`，使其可被 desktop 和 mobile 共享。

#### 改动
- **移动文件**：
  - `apps/desktop/src/apiClient.ts` → `packages/shared/src/apiClient.ts`（内容不变）
  - `apps/desktop/src/__tests__/apiClient.test.ts` → `packages/shared/src/__tests__/apiClient.test.ts`（内容不变）
- **更新 desktop 导入**：
  - `apps/desktop/src/App.tsx`: `import { createApiClient } from "@gw-link-omniai/shared"`
  - `apps/desktop/src/apiModel.ts`: 同上
  - 去掉 `import { ... } from "./apiClient"`

#### 验证
- `pnpm test` 全绿（desktop 测试保持绿，shared 新增 apiClient 测试通过）
- `pnpm typecheck` 无错误

---

### 2. mobile tokenStore

#### 接口定义

```typescript
// apps/mobile/src/tokenStore.ts
export interface TokenStore {
  save(token: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}
```

镜像桌面 `apps/desktop/src/tokenStore.ts` 接口（签名一致），便于未来提升到 shared（如需跨端复用）。

#### AsyncStorage 实现

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "gw-link-omniai.token";

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

#### 依赖
`apps/mobile/package.json` 新增：
```json
{
  "dependencies": {
    "@react-native-async-storage/async-storage": "^2.1.0"
  }
}
```

#### 测试

```typescript
// apps/mobile/src/__tests__/tokenStore.test.ts
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";
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

  it("save and load token", async () => {
    const store = createAsyncStorageTokenStore();
    await store.save("test-token-123");
    const loaded = await store.load();
    assert.strictEqual(loaded, "test-token-123");
  });

  it("load returns null when no token", async () => {
    const store = createAsyncStorageTokenStore();
    const loaded = await store.load();
    assert.strictEqual(loaded, null);
  });

  it("clear removes token", async () => {
    const store = createAsyncStorageTokenStore();
    await store.save("test-token");
    await store.clear();
    const loaded = await store.load();
    assert.strictEqual(loaded, null);
  });
});
```

---

### 3. mobile App.tsx

#### 组件结构

```typescript
// apps/mobile/App.tsx
import React, { useState, useEffect } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  StyleSheet,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { createApiClient } from "@gw-link-omniai/shared";
import { createAsyncStorageTokenStore, type TokenStore } from "./src/tokenStore";

type Stage = "signedOut" | "signingIn" | "signedIn";

interface AppProps {
  apiClient?: ReturnType<typeof createApiClient>;
  tokenStore?: TokenStore;
}

export default function App({
  apiClient = createApiClient("http://localhost:3000"),
  tokenStore = createAsyncStorageTokenStore(),
}: AppProps) {
  // 状态：stage, email, challengeId, code, token, balance, tasks, prompt, mode, preset, actionError
  // 登录流程：handleStartLogin, handleVerifyLogin, handleSignedOut
  // 生成流程：handleSubmitGeneration
  // 启动恢复：useEffect(() => { loadTokenAndRestore() }, [])
  // 辅助：loadUserData (balance + tasks)

  // ... 实现略，见下文详细说明
}
```

#### 状态定义

```typescript
const [stage, setStage] = useState<Stage>("signedOut");
const [email, setEmail] = useState("");
const [challengeId, setChallengeId] = useState<string | null>(null);
const [code, setCode] = useState("");
const [token, setToken] = useState<string | null>(null);
const [balance, setBalance] = useState<number | null>(null);
const [tasks, setTasks] = useState<GenerationTask[]>([]);
const [prompt, setPrompt] = useState("");
const [mode, setMode] = useState<"text" | "image" | "video">("text");
const [preset, setPreset] = useState<"quick" | "balanced" | "quality">("balanced");
const [actionError, setActionError] = useState<string | null>(null);
```

#### 登录流程

**startLogin**:
```typescript
const handleStartLogin = async () => {
  setActionError(null);
  try {
    const challenge = await apiClient.startLogin(email);
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
```

**verifyLogin**:
```typescript
const handleVerifyLogin = async () => {
  if (!challengeId) return;
  setActionError(null);
  try {
    const session = await apiClient.verifyLogin(challengeId, code);
    setToken(session.token);
    await tokenStore.save(session.token);
    await loadUserData(session.token);
    setStage("signedIn");
  } catch (err) {
    // 同 startLogin 错误处理
  }
};
```

**loadUserData**（辅助）:
```typescript
const loadUserData = async (authToken: string) => {
  const [balanceResp, tasksResp] = await Promise.all([
    apiClient.getCreditBalance(authToken),
    apiClient.getGenerations(authToken),
  ]);
  setBalance(balanceResp.balance.credits);
  setTasks(tasksResp.tasks);
};
```

**signedOut**:
```typescript
const handleSignedOut = async () => {
  setToken(null);
  setBalance(null);
  setTasks([]);
  await tokenStore.clear();
  setStage("signedOut");
};
```

#### 生成流程

```typescript
const handleSubmitGeneration = async () => {
  if (!token) return;
  setActionError(null);
  try {
    await apiClient.createGeneration(token, { prompt, mode, preset });
    // 刷新任务列表
    const tasksResp = await apiClient.getGenerations(token);
    setTasks(tasksResp.tasks);
    // 刷新余额
    const balanceResp = await apiClient.getCreditBalance(token);
    setBalance(balanceResp.balance.credits);
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
```

#### 启动恢复

```typescript
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
      // 令牌失效，清除
      await tokenStore.clear();
    }
  };
  restoreSession();
}, []);
```

#### UI 渲染

**signedOut 视图**:
```tsx
{stage === "signedOut" && (
  <View>
    <Text>邮箱登录</Text>
    <TextInput value={email} onChangeText={setEmail} placeholder="email@example.com" />
    <Button title="发送验证码" onPress={handleStartLogin} />
    {actionError && <Text style={styles.error}>{actionError}</Text>}
  </View>
)}
```

**signingIn 视图**:
```tsx
{stage === "signingIn" && (
  <View>
    <Text>请输入邮箱中的验证码</Text>
    <TextInput value={code} onChangeText={setCode} placeholder="123456" />
    <Button title="验证登录" onPress={handleVerifyLogin} />
    {actionError && <Text style={styles.error}>{actionError}</Text>}
  </View>
)}
```

**signedIn 视图**:
```tsx
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
      />
      <Picker selectedValue={mode} onValueChange={setMode}>
        <Picker.Item label="文本" value="text" />
        <Picker.Item label="图片" value="image" />
        <Picker.Item label="视频" value="video" />
      </Picker>
      <Picker selectedValue={preset} onValueChange={setPreset}>
        <Picker.Item label="快速" value="quick" />
        <Picker.Item label="均衡" value="balanced" />
        <Picker.Item label="高质量" value="quality" />
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
```

#### 样式

```typescript
const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  form: { marginBottom: 16 },
  task: { padding: 8, borderBottomWidth: 1, borderColor: "#ccc" },
  error: { color: "red", marginTop: 8 },
});
```

#### 测试

```typescript
// apps/mobile/src/__tests__/App.test.tsx
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import App from "../App";

// Fake apiClient & tokenStore
const createFakeClient = () => ({ ... }); // 同 desktop 模式
const createFakeTokenStore = () => {
  let stored: string | null = null;
  return {
    save: async (t: string) => { stored = t; },
    load: async () => stored,
    clear: async () => { stored = null; },
  };
};

describe("Mobile App", () => {
  it("login flow", async () => {
    const client = createFakeClient();
    const store = createFakeTokenStore();
    const { getByPlaceholderText, getByText } = render(
      <App apiClient={client} tokenStore={store} />
    );
    
    fireEvent.changeText(getByPlaceholderText("email@example.com"), "test@example.com");
    fireEvent.press(getByText("发送验证码"));
    
    await waitFor(() => getByText("请输入邮箱中的验证码"));
    
    fireEvent.changeText(getByPlaceholderText("123456"), "000000");
    fireEvent.press(getByText("验证登录"));
    
    await waitFor(() => getByText(/积分/));
  });

  it("submit generation", async () => {
    // ... 类似 desktop App 测试
  });

  it("restore session on startup", async () => {
    const store = createFakeTokenStore();
    await store.save("stored-token");
    const client = createFakeClient();
    
    const { getByText } = render(<App apiClient={client} tokenStore={store} />);
    
    await waitFor(() => getByText(/积分/));
  });

  it("clear token on 401", async () => {
    // ... 类似 desktop
  });
});
```

---

### 4. 文档更新

#### README.md

在 "Current State" 下新增 bullet:

```markdown
- **Mobile API Integration** (Slice 13): apiClient 提升到 shared，mobile 单屏 App 接入核心流程（登录/生成/任务/余额），AsyncStorage 令牌持久化。刷新/保存/充值留后续。
```

#### mvp-skeleton.md

在 "Implementation Status" 表格中新增 Slice 13 行：

```markdown
| 13 | Mobile API Integration | ✅ | apiClient → shared, mobile App (login/gen/tasks/balance), AsyncStorage token, no refresh/save/topup |
```

---

## 错误处理

- **startLogin / verifyLogin**: 401 → "邮箱未注册或验证码错误"；其余 → "登录失败，请稍后重试"；网络错误 → "网络错误"
- **submitGeneration**: 401 → `handleSignedOut` + 清除令牌；402 → "积分不足，无法生成"；其余 → "生成失败，请稍后重试"
- **启动恢复 getSession**: 失败 → 清除令牌（不阻塞 UI，静默降级到 signedOut）
- **不泄露内部错误**：catch 块中仅显示用户友好消息

---

## 测试策略

1. **shared apiClient 测试**：移动后 desktop 测试保持绿（仅改 import），shared 新增 apiClient 测试通过
2. **tokenStore 测试**：save→load 读回、clear→load null、初始 load 为 null
3. **App 测试**：
   - 登录流程（startLogin → signingIn → verifyLogin → signedIn + 余额/任务加载）
   - 生成提交（signedIn → submitGeneration → 任务列表刷新 + 余额刷新）
   - 启动恢复（stored token → getSession → signedIn + 数据加载）
   - 401 处理（submitGeneration 401 → signedOut + token 清除）
4. **全量验证**：
   - `pnpm test` 全绿（shared 14/14 + mobile 新增测试）
   - `pnpm typecheck` 无错误

---

## 依赖

- **新增**：`@react-native-async-storage/async-storage` ^2.1.0 (apps/mobile)
- **unchanged**：Expo SDK 51, React Native 0.74

---

## 非功能性需求

- **性能**：启动恢复异步，不阻塞 UI；getSession 失败静默清除令牌
- **安全**：令牌存储 AsyncStorage（明文，keychain/Keystore 留 Slice 18）；401 立即清除令牌
- **可测试性**：apiClient / tokenStore 注入，便于 fake 替换
- **可扩展性**：单屏设计为核心流程最小化，刷新/保存/充值/多屏 navigation 留后续 Slice

---

## 交付清单

- [ ] `packages/shared/src/apiClient.ts` + `__tests__/apiClient.test.ts` 从 desktop 移动
- [ ] `apps/desktop/src/App.tsx` + `apiModel.ts` 改 import，测试绿
- [ ] `apps/mobile/src/tokenStore.ts` + `__tests__/tokenStore.test.ts` 实现 + 测试
- [ ] `apps/mobile/src/App.tsx` + `__tests__/App.test.tsx` 实现单屏 + 测试
- [ ] `apps/mobile/package.json` 新增 AsyncStorage 依赖
- [ ] README.md + mvp-skeleton.md 更新
- [ ] `pnpm test` 全绿
- [ ] `pnpm typecheck` 无错误

---

## 后续 Slice

- **Slice 14**: 任务刷新按钮（mobile + desktop）
- **Slice 15**: 保存生成结果到资产库 + 资产列表
- **Slice 16**: 充值/支付流程
- **Slice 17**: 图片/视频结果渲染
- **Slice 18**: 安全加固（iOS Keychain / Android Keystore）
