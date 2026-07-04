import type { ApiClient } from "@gw-link-omniai/shared";

export type AdminStage = "signedOut" | "codeSent" | "signedIn";

export interface AdminAuthState {
  stage: AdminStage;
  challengeId: string | null;
  token: string | null;
  error: string | null;
}

export interface AdminAuthController {
  getState(): AdminAuthState;
  subscribe(listener: () => void): () => void;
  startLogin(email: string): Promise<void>;
  verify(code: string): Promise<void>;
}

function loginError(): string {
  return "登录失败，请重试";
}

export function createAdminAuthController(client: ApiClient): AdminAuthController {
  let state: AdminAuthState = {
    stage: "signedOut",
    challengeId: null,
    token: null,
    error: null
  };
  const listeners = new Set<() => void>();

  function setState(patch: Partial<AdminAuthState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
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
    async startLogin(email) {
      setState({ error: null });
      try {
        const challenge = await client.startLogin({ destination: email });
        setState({ challengeId: challenge.challengeId, stage: "codeSent" });
      } catch {
        setState({ error: loginError() });
      }
    },
    async verify(code) {
      if (!state.challengeId) {
        return;
      }
      setState({ error: null });
      try {
        const session = await client.verifyLogin({ challengeId: state.challengeId, code });
        setState({ token: session.token, stage: "signedIn", challengeId: null });
      } catch {
        setState({ error: loginError() });
      }
    }
  };
}
