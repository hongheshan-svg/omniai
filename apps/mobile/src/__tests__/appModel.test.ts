import { describe, it, expect, vi } from "vitest";
import type { ApiClient, AuthSession, CreationAsset, CreationAssetRequest, GenerationTask, LoginStartResponse, Order, SessionResponse } from "@gw-link-omniai/shared";
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
  let assets: CreationAsset[] = [];
  let orders: Order[] = [];
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
    listAssets: async () => assets,
    createAsset: async (request: CreationAssetRequest) => {
      const asset: CreationAsset = {
        id: `a${assets.length + 1}`,
        mode: request.mode,
        title: request.title,
        content: request.content,
        preview: { title: request.title, description: "已保存" },
        source: request.source,
        prompt: request.prompt,
        optimizedPrompt: request.optimizedPrompt,
        preset: request.preset,
        createdAt: "2026-07-02T00:00:00.000Z"
      };
      assets = [asset, ...assets];
      return asset;
    },
    getCreditBalance: async () => ({ credits: balance, unit: "credit" as const }),
    getSession: async (): Promise<SessionResponse> => ({ authenticated: true, user: USER, expiresAt: "2026-07-08T00:00:00.000Z" }),
    getGeneration: async () => { throw new Error("unused"); },
    topUpCredits: async () => { throw new Error("unused"); },
    listModels: async () => { throw new Error("unused"); },
    listPackages: async () => [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }],
    createOrder: async (packageId: string) => {
      const order: Order = {
        id: `order-${orders.length + 1}`,
        packageId,
        credits: 100,
        amountCents: 990,
        currency: "CNY",
        status: "pending",
        checkoutRef: `checkout-${orders.length + 1}`,
        createdAt: "2026-07-03T00:00:00.000Z"
      };
      orders = [order, ...orders];
      return order;
    },
    listOrders: async () => orders,
    devCompletePayment: async (orderId: string) => {
      orders = orders.map((o) => (o.id === orderId ? { ...o, status: "paid" as const, paidAt: "2026-07-03T02:30:00.000Z" } : o));
      balance += 100;
      return orders.find((o) => o.id === orderId)!;
    }
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

  it("refreshes a running task to its latest state", async () => {
    const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
    const succeeded = textTask("t1", "p");
    const client = createFakeClient({
      listGenerations: async () => [running],
      getGeneration: async () => succeeded
    });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    expect(ctrl.getState().tasks[0].status).toBe("running");
    await ctrl.refreshTask("t1");
    expect(ctrl.getState().tasks[0].status).toBe("succeeded");
  });

  it("signs out on a 401 during refresh", async () => {
    const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
    const client = createFakeClient({
      listGenerations: async () => [running],
      getGeneration: async () => { throw new ApiError("unauth", 401); }
    });
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.refreshTask("t1");
    expect(ctrl.getState().stage).toBe("signedOut");
    expect(await store.load()).toBeNull();
  });

  it("maps a non-401 refresh error to a friendly message", async () => {
    const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
    const client = createFakeClient({
      listGenerations: async () => [running],
      getGeneration: async () => { throw new ApiError("boom", 500); }
    });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.refreshTask("t1");
    expect(ctrl.getState().actionError).toBe("刷新失败，请稍后重试");
    expect(ctrl.getState().stage).toBe("signedIn");
  });

  it("loads assets on login", async () => {
    const seeded: CreationAsset = {
      id: "a-seed",
      mode: "text",
      title: "文本资产",
      content: { kind: "text", text: "已生成", format: "plain" },
      preview: { title: "文本资产", description: "已保存" },
      source: { taskId: "t0", taskStatus: "succeeded" },
      prompt: "p",
      optimizedPrompt: "p",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      createdAt: "2026-07-02T00:00:00.000Z"
    };
    const client = createFakeClient({ listAssets: async () => [seeded] });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    expect(ctrl.getState().assets).toHaveLength(1);
    expect(ctrl.getState().assets[0].id).toBe("a-seed");
  });

  it("saves a succeeded task as an asset and refreshes the list", async () => {
    const refreshed: CreationAsset = {
      id: "a-refreshed",
      mode: "text",
      title: "文本资产",
      content: { kind: "text", text: "已生成", format: "plain" },
      preview: { title: "文本资产", description: "已保存" },
      source: { taskId: "t1", taskStatus: "succeeded" },
      prompt: "存这个",
      optimizedPrompt: "存这个",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      createdAt: "2026-07-02T00:00:00.000Z"
    };
    let created = false;
    const client = createFakeClient({
      createAsset: async (request: CreationAssetRequest) => {
        created = true;
        return {
          id: "a-created",
          mode: request.mode,
          title: request.title,
          content: request.content,
          preview: { title: request.title, description: "已保存" },
          source: request.source,
          prompt: request.prompt,
          optimizedPrompt: request.optimizedPrompt,
          preset: request.preset,
          createdAt: "2026-07-02T00:00:00.000Z"
        };
      },
      listAssets: async () => (created ? [refreshed] : [])
    });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    expect(ctrl.getState().assets).toHaveLength(0);
    await ctrl.saveAsset(textTask("t1", "存这个"));
    expect(ctrl.getState().assets).toHaveLength(1);
    // id proves the list came from the post-save listAssets refresh, not createAsset's return
    expect(ctrl.getState().assets[0].id).toBe("a-refreshed");
  });

  it("signs out on a 401 during saveAsset", async () => {
    const client = createFakeClient({ createAsset: async () => { throw new ApiError("unauth", 401); } });
    const store = createFakeTokenStore();
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.saveAsset(textTask("t1", "p"));
    expect(ctrl.getState().stage).toBe("signedOut");
    expect(await store.load()).toBeNull();
  });

  it("maps a non-401 saveAsset error to a friendly message", async () => {
    const client = createFakeClient({ createAsset: async () => { throw new ApiError("boom", 500); } });
    const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await ctrl.startLogin("test@example.com");
    await ctrl.verifyLogin("000000");
    await ctrl.saveAsset(textTask("t1", "p"));
    expect(ctrl.getState().actionError).toBe("保存失败，请稍后重试");
    expect(ctrl.getState().stage).toBe("signedIn");
  });

  it("auto-polls a running task to completion", async () => {
    vi.useFakeTimers();
    try {
      const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
      const succeeded = textTask("t1", "p");
      const client = createFakeClient({ listGenerations: async () => [running], getGeneration: async () => succeeded });
      const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
      await ctrl.startLogin("test@example.com");
      await ctrl.verifyLogin("000000");
      expect(ctrl.getState().tasks[0].status).toBe("running");
      ctrl.startAutoPoll();
      await vi.advanceTimersByTimeAsync(5000);
      expect(ctrl.getState().tasks[0].status).toBe("succeeded");
      ctrl.stopAutoPoll();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling after stopAutoPoll", async () => {
    vi.useFakeTimers();
    try {
      const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
      const getGeneration = vi.fn(async () => running);
      const client = createFakeClient({ listGenerations: async () => [running], getGeneration });
      const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
      await ctrl.startLogin("test@example.com");
      await ctrl.verifyLogin("000000");
      ctrl.startAutoPoll();
      await vi.advanceTimersByTimeAsync(5000);
      const callsAfterFirst = getGeneration.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);
      ctrl.stopAutoPoll();
      await vi.advanceTimersByTimeAsync(15000);
      expect(getGeneration.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signs out and stops polling on a 401 during a poll", async () => {
    vi.useFakeTimers();
    try {
      const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
      const getGeneration = vi.fn(async () => { throw new ApiError("unauth", 401); });
      const store = createFakeTokenStore();
      const client = createFakeClient({ listGenerations: async () => [running], getGeneration });
      const ctrl = createMobileAppController({ apiClient: client, tokenStore: store });
      await ctrl.startLogin("test@example.com");
      await ctrl.verifyLogin("000000");
      ctrl.startAutoPoll();
      await vi.advanceTimersByTimeAsync(5000);
      expect(ctrl.getState().stage).toBe("signedOut");
      expect(await store.load()).toBeNull();
      const callsAfter = getGeneration.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15000);
      expect(getGeneration.mock.calls.length).toBe(callsAfter);
    } finally {
      vi.useRealTimers();
    }
  });

  it("startAutoPoll is idempotent (one interval)", async () => {
    vi.useFakeTimers();
    try {
      const running: GenerationTask = { ...textTask("t1", "p"), status: "running", result: undefined };
      const getGeneration = vi.fn(async () => running);
      const client = createFakeClient({ listGenerations: async () => [running], getGeneration });
      const ctrl = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
      await ctrl.startLogin("test@example.com");
      await ctrl.verifyLogin("000000");
      ctrl.startAutoPoll();
      ctrl.startAutoPoll();
      await vi.advanceTimersByTimeAsync(5000);
      expect(getGeneration).toHaveBeenCalledTimes(1);
      ctrl.stopAutoPoll();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads packages and orders after verifyLogin", async () => {
    const controller = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
    await controller.startLogin("test@example.com");
    await controller.verifyLogin("000000");
    expect(controller.getState().packages).toHaveLength(1);
    expect(controller.getState().orders).toEqual([]);
  });

  it("buys a package: balance grows and a paid order appears", async () => {
    const controller = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
    await controller.startLogin("test@example.com");
    await controller.verifyLogin("000000");
    await controller.buyPackage("credits-100");
    const state = controller.getState();
    expect(state.balance).toBe(200);
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]?.status).toBe("paid");
  });

  it("signs out when buyPackage hits 401", async () => {
    const client = createFakeClient({
      createOrder: async () => { throw new ApiError("Authentication required", 401); }
    });
    const controller = createMobileAppController({ apiClient: client, tokenStore: createFakeTokenStore() });
    await controller.startLogin("test@example.com");
    await controller.verifyLogin("000000");
    await controller.buyPackage("credits-100");
    expect(controller.getState().stage).toBe("signedOut");
  });

  it("selects and clears the expanded order", () => {
    const controller = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
    controller.selectOrder("order-1");
    expect(controller.getState().selectedOrderId).toBe("order-1");
    controller.selectOrder(null);
    expect(controller.getState().selectedOrderId).toBeNull();
  });

  it("resets checkout state on sign out", async () => {
    const controller = createMobileAppController({ apiClient: createFakeClient(), tokenStore: createFakeTokenStore() });
    await controller.startLogin("test@example.com");
    await controller.verifyLogin("000000");
    await controller.buyPackage("credits-100");
    await controller.signOut();
    const state = controller.getState();
    expect(state.packages).toEqual([]);
    expect(state.orders).toEqual([]);
    expect(state.selectedOrderId).toBeNull();
  });
});
