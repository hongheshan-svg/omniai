import { ApiError, type ApiClient, type CreationMode, type GenerationTask, type PresetSuggestion } from "@gw-link-omniai/shared";
import type { TokenStore } from "./tokenStore";

export type Stage = "signedOut" | "signingIn" | "signedIn";

export interface MobileAppState {
  stage: Stage;
  challengeId: string | null;
  token: string | null;
  balance: number | null;
  tasks: GenerationTask[];
  actionError: string | null;
}

export interface MobileAppController {
  getState(): MobileAppState;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  startLogin(email: string): Promise<void>;
  verifyLogin(code: string): Promise<void>;
  submitGeneration(input: { prompt: string; mode: CreationMode }): Promise<void>;
  signOut(): Promise<void>;
}

const DEFAULT_PRESET: PresetSuggestion = {
  modelId: "gw-text-balanced",
  parameters: {},
  creditEstimate: { credits: 1, unit: "credit" }
};

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
    actionError: null
  };
  const listeners = new Set<() => void>();

  function setState(patch: Partial<MobileAppState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  }

  async function loadUserData(token: string): Promise<void> {
    const [balance, tasks] = await Promise.all([
      apiClient.getCreditBalance(token),
      apiClient.listGenerations(token)
    ]);
    setState({ balance: balance.credits, tasks });
  }

  async function signOutInternal(): Promise<void> {
    await tokenStore.clear();
    setState({ token: null, stage: "signedOut", balance: null, tasks: [], challengeId: null });
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
      try {
        const session = await apiClient.verifyLogin({ challengeId: state.challengeId, code });
        await tokenStore.save(session.token);
        setState({ token: session.token, stage: "signedIn", challengeId: null });
        await loadUserData(session.token);
      } catch (err) {
        setState({ actionError: loginError(err) });
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
    async signOut() {
      await signOutInternal();
    }
  };
}
