import type {
  AuthSession,
  CreationAsset,
  CreationAssetRequest,
  CreditAmount,
  GenerationTask,
  GenerationTaskRequest,
  LoginStartRequest,
  LoginStartResponse,
  LoginVerifyRequest,
  PromptOptimization,
  PromptOptimizationRequest
} from "@gw-link-omniai/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ApiClient {
  startLogin(request: LoginStartRequest): Promise<LoginStartResponse>;
  verifyLogin(request: LoginVerifyRequest): Promise<AuthSession>;
  logout(token: string): Promise<void>;
  optimizePrompt(request: PromptOptimizationRequest): Promise<PromptOptimization>;
  createGeneration(request: GenerationTaskRequest, token: string): Promise<GenerationTask>;
  listGenerations(token: string): Promise<GenerationTask[]>;
  listAssets(token: string): Promise<CreationAsset[]>;
  createAsset(request: CreationAssetRequest, token: string): Promise<CreationAsset>;
  getCreditBalance(token: string): Promise<CreditAmount>;
}

const DEFAULT_BASE_URL = "http://localhost:8787";

function resolveBaseUrl(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  const env = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env;
  return env?.VITE_API_BASE_URL ?? DEFAULT_BASE_URL;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = resolveBaseUrl(options.baseUrl).replace(/\/$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch;

  async function send<T>(
    path: string,
    init: { method?: string; body?: unknown; token?: string } = {}
  ): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (init.token) {
      headers.authorization = `Bearer ${init.token}`;
    }

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
    });

    if (!response.ok) {
      let message = response.statusText || `Request failed with status ${response.status}`;
      try {
        const errorBody = (await response.json()) as { error?: unknown };
        if (errorBody && typeof errorBody.error === "string") {
          message = errorBody.error;
        }
      } catch {
        // non-JSON body; keep the status-derived message
      }
      throw new ApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  return {
    startLogin(request) {
      return send<LoginStartResponse>("/v1/auth/start-login", { method: "POST", body: request });
    },
    verifyLogin(request) {
      return send<AuthSession>("/v1/auth/verify-login", { method: "POST", body: request });
    },
    async logout(token) {
      await send<{ ok: boolean }>("/v1/auth/logout", { method: "POST", token });
    },
    async optimizePrompt(request) {
      const { optimization } = await send<{ optimization: PromptOptimization }>(
        "/v1/prompt/optimize",
        { method: "POST", body: request }
      );
      return optimization;
    },
    async createGeneration(request, token) {
      const { task } = await send<{ task: GenerationTask }>("/v1/generations", {
        method: "POST",
        body: request,
        token
      });
      return task;
    },
    async listGenerations(token) {
      const { tasks } = await send<{ tasks: GenerationTask[] }>("/v1/generations", { token });
      return tasks;
    },
    async listAssets(token) {
      const { assets } = await send<{ assets: CreationAsset[] }>("/v1/assets", { token });
      return assets;
    },
    async createAsset(request, token) {
      const { asset } = await send<{ asset: CreationAsset }>("/v1/assets", {
        method: "POST",
        body: request,
        token
      });
      return asset;
    },
    async getCreditBalance(token) {
      const { balance } = await send<{ balance: CreditAmount }>("/v1/credits/balance", { token });
      return balance;
    }
  };
}
