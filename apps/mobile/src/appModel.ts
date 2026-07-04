import { ApiError, buildAssetRequestFromTask, type ApiClient, type CreationAsset, type CreationMode, type CreditPackage, type GenerationTask, type Order, type PresetSuggestion } from "@gw-link-omniai/shared";
import type { TokenStore } from "./tokenStore";

export type Stage = "signedOut" | "signingIn" | "signedIn";

export interface MobileAppState {
  stage: Stage;
  challengeId: string | null;
  token: string | null;
  balance: number | null;
  tasks: GenerationTask[];
  assets: CreationAsset[];
  packages: CreditPackage[];
  orders: Order[];
  selectedOrderId: string | null;
  actionError: string | null;
}

export interface MobileAppController {
  getState(): MobileAppState;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  startLogin(email: string): Promise<void>;
  verifyLogin(code: string): Promise<void>;
  submitGeneration(input: { prompt: string; mode: CreationMode }): Promise<void>;
  refreshTask(taskId: string): Promise<void>;
  startAutoPoll(): void;
  stopAutoPoll(): void;
  saveAsset(task: GenerationTask): Promise<void>;
  signOut(): Promise<void>;
  buyPackage(packageId: string): Promise<void>;
  selectOrder(orderId: string | null): void;
}

const DEFAULT_PRESET: PresetSuggestion = {
  modelId: "gw-text-balanced",
  parameters: {},
  creditEstimate: { credits: 1, unit: "credit" }
};

const POLL_INTERVAL_MS = 5000;

function loginError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 401 ? "邮箱未注册或验证码错误" : "登录失败，请稍后重试";
  }
  return "网络错误";
}

function generationError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 402 ? "积分不足，无法生成" : "生成失败，请稍后重试";
  }
  return "网络错误";
}

function refreshError(err: unknown): string {
  if (err instanceof ApiError) {
    return "刷新失败，请稍后重试";
  }
  return "网络错误";
}

function assetError(err: unknown): string {
  if (err instanceof ApiError) {
    return "保存失败，请稍后重试";
  }
  return "网络错误";
}

function purchaseError(err: unknown): string {
  if (err instanceof ApiError) {
    return "购买失败，请稍后重试";
  }
  return "网络错误";
}

export function createMobileAppController(deps: {
  apiClient: ApiClient;
  tokenStore: TokenStore;
}): MobileAppController {
  const { apiClient, tokenStore } = deps;

  let state: MobileAppState = {
    stage: "signedOut",
    challengeId: null,
    token: null,
    balance: null,
    tasks: [],
    assets: [],
    packages: [],
    orders: [],
    selectedOrderId: null,
    actionError: null
  };
  const listeners = new Set<() => void>();
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  function setState(patch: Partial<MobileAppState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  }

  async function loadUserData(token: string): Promise<void> {
    const [balance, tasks, assets, packages, orders] = await Promise.all([
      apiClient.getCreditBalance(token),
      apiClient.listGenerations(token),
      apiClient.listAssets(token),
      apiClient.listPackages(),
      apiClient.listOrders(token)
    ]);
    setState({ balance: balance.credits, tasks, assets, packages, orders });
  }

  function stopPolling(): void {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  async function pollRunning(): Promise<void> {
    const token = state.token;
    if (!token) {
      return;
    }
    const runningIds = state.tasks.filter((task) => task.status === "running").map((task) => task.id);
    for (const id of runningIds) {
      try {
        const updated = await apiClient.getGeneration(id, token);
        setState({ tasks: state.tasks.map((task) => (task.id === updated.id ? updated : task)) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          stopPolling();
          await signOutInternal();
          return;
        }
        // transient poll error: stay quiet, retry next tick
      }
    }
  }

  async function signOutInternal(): Promise<void> {
    stopPolling();
    await tokenStore.clear();
    setState({ token: null, stage: "signedOut", balance: null, tasks: [], assets: [], packages: [], orders: [], selectedOrderId: null, challengeId: null });
  }

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async restore() {
      const stored = await tokenStore.load();
      if (!stored) {
        return;
      }
      try {
        const session = await apiClient.getSession(stored);
        if (!session.authenticated || !session.user) {
          await tokenStore.clear();
          return;
        }
        setState({ token: stored, stage: "signedIn" });
      } catch {
        await tokenStore.clear();
        return;
      }
      try {
        await loadUserData(stored);
      } catch {
        // Session restored; a transient data-load failure must not clear the token.
      }
    },
    async startLogin(email) {
      setState({ actionError: null });
      try {
        const challenge = await apiClient.startLogin({ destination: email });
        setState({ challengeId: challenge.challengeId, stage: "signingIn" });
      } catch (err) {
        setState({ actionError: loginError(err) });
      }
    },
    async verifyLogin(code) {
      if (!state.challengeId) {
        return;
      }
      setState({ actionError: null });
      let token: string;
      try {
        const session = await apiClient.verifyLogin({ challengeId: state.challengeId, code });
        token = session.token;
        await tokenStore.save(session.token);
        setState({ token: session.token, stage: "signedIn", challengeId: null });
      } catch (err) {
        setState({ actionError: loginError(err) });
        return;
      }
      try {
        await loadUserData(token);
      } catch {
        // Signed in; a transient data-load failure must not surface as a login error.
      }
    },
    async submitGeneration({ prompt, mode }) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        await apiClient.createGeneration({ mode, prompt, optimizedPrompt: prompt, preset: DEFAULT_PRESET }, token);
        const [tasks, balance] = await Promise.all([
          apiClient.listGenerations(token),
          apiClient.getCreditBalance(token)
        ]);
        setState({ tasks, balance: balance.credits });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await signOutInternal();
          return;
        }
        setState({ actionError: generationError(err) });
      }
    },
    async refreshTask(taskId) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        const updated = await apiClient.getGeneration(taskId, token);
        setState({ tasks: state.tasks.map((task) => (task.id === updated.id ? updated : task)) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await signOutInternal();
          return;
        }
        setState({ actionError: refreshError(err) });
      }
    },
    startAutoPoll() {
      if (pollHandle !== null) {
        return;
      }
      pollHandle = setInterval(() => {
        void pollRunning();
      }, POLL_INTERVAL_MS);
    },
    stopAutoPoll() {
      stopPolling();
    },
    async saveAsset(task) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        await apiClient.createAsset(buildAssetRequestFromTask(task), token);
        const assets = await apiClient.listAssets(token);
        setState({ assets });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await signOutInternal();
          return;
        }
        setState({ actionError: assetError(err) });
      }
    },
    async signOut() {
      await signOutInternal();
    },
    async buyPackage(packageId) {
      const token = state.token;
      if (!token) {
        return;
      }
      setState({ actionError: null });
      try {
        const order = await apiClient.createOrder(packageId, token);
        await apiClient.devCompletePayment(order.id, token);
        const [balance, orders] = await Promise.all([
          apiClient.getCreditBalance(token),
          apiClient.listOrders(token)
        ]);
        setState({ balance: balance.credits, orders });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await signOutInternal();
          return;
        }
        setState({ actionError: purchaseError(err) });
      }
    },
    selectOrder(orderId) {
      setState({ selectedOrderId: orderId });
    }
  };
}
