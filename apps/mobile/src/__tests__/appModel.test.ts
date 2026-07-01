import { describe, it, expect, vi } from "vitest";
import type { ApiClient, AuthSession, GenerationTask, LoginStartResponse, SessionResponse } from "@gw-link-omniai/shared";
import { ApiError } from "@gw-link-omniai/shared";
import type { TokenStore } from "../tokenStore.js";
import { createMobileAppController } from "../appModel.js";

const USER = {
  id: "u1",
  displayName: "测试用户",
  destination: "test@example.com",
  channel: "email" as const,
  plan: "free" as const,
  createdAt: "2026-07-01T00:00:00.000Z"
};

function textTask(id: string, prompt: string): GenerationTask {
  return {
    id,
    mode: "text",
    status: "succeeded",
    prompt,
    optimizedPrompt: prompt,
    preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
    resultPreview: { title: "生成结果", description: "已完成" },
    result: { kind: "text", text: "生成的内容", format: "plain" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

function createFakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  let balance = 100;
  let tasks: GenerationTask[] = [];
  const base: ApiClient = {
    startLogin: async (): Promise<LoginStartResponse> => ({
      challengeId: "ch-1",
      channel: "email",
      maskedDestination: "t***@example.com",
      expiresAt: "2026-07-01T12:00:00.000Z",
      devCode: "000000"
    }),
    verifyLogin: async (): Promise<AuthSession> => ({ token: "tok-1", user: USER, expiresAt: "2026-07-08T00:00:00.000Z" }),
    logout: async () => undefined,
    optimizePrompt: async () => { throw new Error("unused"); },
    createGeneration: async (request) => {
      const task = textTask(`t${tasks.length + 1}`, request.prompt);
      tasks = [task, ...tasks];
      balance -= 1;
      return task;
    },
    listGenerations: async () => tasks,
    listAssets: async () => { throw new Error("unused"); },
    createAsset: async () => { throw new Error("unused"); },
    getCreditBalance: async () => ({ credits: balance, unit: "credit" as const }),
    getSession: async (): Promise<SessionResponse> => ({ authenticated: true, user: USER, expiresAt: "2026-07-08T00:00:00.000Z" }),
    getGeneration: async () => { throw new Error("unused"); },
    topUpCredits: async () => { throw new Error("unused"); }
  };
  return { ...base, ...overrides };
}

function createFakeTokenStore(initial: string | null = null): TokenStore {
  let token = initial;
  return {
    save: async (value: string) => { token = value; },
    load: async () => token,
    clear: async () => { token = null; }
  };
}

describe("MobileAppController", () => {
  it("starts login and moves to signingIn", async () => {
    const ctrl = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    expect(ctrl.getState().stage).toBe("signingIn");
    expect(ctrl.getState().challengeId).toBe("ch-1");
  });

  it("maps a 401 on startLogin to the invalid-code message", async () => {
    const client = createFakeClient({ startLogin: async () => { throw new ApiError("bad", 401); } });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    expect(ctrl.getState().actionError).toBe("邮箱未注册或验证码错误");
    expect(ctrl.getState().stage).toBe("signedOut");
  });

  it("maps a non-ApiError on startLogin to the network message", async () => {
    const client = createFakeClient({ startLogin: async () => { throw new Error("net"); } });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    expect(ctrl.getState().actionError).toBe("网络错误");
  });

  it("verifies login, saves token, loads balance and tasks", async () => {
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: createFakeClient(), tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    const state = ctrl.getState();
    expect(state.stage).toBe("signedIn");
    expect(state.token).toBe("tok-1");
    expect(state.balance).toBe(100);
    expect(await store.load()).toBe("tok-1");
  });

  it("stays signed in without a login error when data load fails after verify", async () => {
    const client = createFakeClient({ getCreditBalance: async () => { throw new Error("transient"); } });
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    const state = ctrl.getState();
    expect(state.stage).toBe("signedIn");
    expect(state.token).toBe("tok-1");
    expect(state.actionError).toBeNull();
    expect(await store.load()).toBe("tok-1");
  });

  it("submits a generation, refreshing tasks and balance", async () => {
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: createFakeClient(), tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.submitGeneration({ prompt: "测试提示词", mode: "text" });
    const state = ctrl.getState();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].prompt).toBe("测试提示词");
    expect(state.balance).toBe(99);
  });

  it("maps a 402 on generation to the insufficient-credit message", async () => {
    const client = createFakeClient({ createGeneration: async () => { throw new ApiError("no credit", 402); } });
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.submitGeneration({ prompt: "p", mode: "text" });
    expect(ctrl.getState().actionError).toBe("积分不足，无法生成");
    expect(ctrl.getState().stage).toBe("signedIn");
  });

  it("signs out and clears the token on a 401 during generation", async () => {
    const client = createFakeClient({ createGeneration: async () => { throw new ApiError("unauth", 401); } });
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.submitGeneration({ prompt: "p", mode: "text" });
    expect(ctrl.getState().stage).toBe("signedOut");
    expect(ctrl.getState().token).toBeNull();
    expect(await store.load()).toBeNull();
  });

  it("restores a stored session on startup", async () => {
    const store = createFakeTokenStore("stored-tok");
    const ctrl = createMobileAppController({ apiClient: createFakeClient(), tokenStore: store });
    await ctrl.restore();
    const state = ctrl.getState();
    expect(state.stage).toBe("signedIn");
    expect(state.token).toBe("stored-tok");
    expect(state.balance).toBe(100);
  });

  it("clears an invalid stored token on startup", async () => {
    const client = createFakeClient({ getSession: async () => { throw new ApiError("unauth", 401); } });
    const store = createFakeTokenStore("bad-tok");
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.restore();
    expect(ctrl.getState().stage).toBe("signedOut");
    expect(await store.load()).toBeNull();
  });

  it("keeps the session when a data load fails after a valid getSession", async () => {
    const client = createFakeClient({ getCreditBalance: async () => { throw new Error("transient"); } });
    const store = createFakeTokenStore("stored-tok");
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.restore();
    expect(ctrl.getState().stage).toBe("signedIn");
    expect(await store.load()).toBe("stored-tok");
  });

  it("clears the token when getSession reports an unauthenticated session", async () => {
    const client = createFakeClient({ getSession: async () => ({ authenticated: false, user: null, expiresAt: null }) });
    const store = createFakeTokenStore("stored-tok");
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.restore();
    expect(ctrl.getState().stage).toBe("signedOut");
    expect(await store.load()).toBeNull();
  });

  it("notifies subscribers on state change", async () => {
    const ctrl = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
    const listener = vi.fn();
    const unsub = ctrl.subscribe(listener);
    await ctrl.startLogin("test@example.com");
    expect(listener).toHaveBeenCalled();
    unsub();
  });
});
