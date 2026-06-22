import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AuthSession,
  CreationAsset,
  GenerationTask,
  LoginStartResponse,
  PromptOptimization
} from "@gw-link-omniai/shared";
import { App } from "../App";
import { ApiError, type ApiClient } from "../apiClient";
import type { TokenStore } from "../tokenStore";
import { getDesktopSessionCta } from "../sessionModel";

afterEach(cleanup);
afterEach(() => localStorage.clear());

const textOptimization: PromptOptimization = {
  id: "o1",
  mode: "text",
  originalPrompt: "帮我写一个咖啡店新品发布文案",
  optimizedPrompt: "请生成一段新品推广文案。",
  sections: [{ label: "写作目标", value: "发布新品" }],
  preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
  createdAt: "2026-06-21T00:00:00.000Z"
};

const imageOptimization: PromptOptimization = {
  id: "o2",
  mode: "image",
  originalPrompt: "一只猫",
  optimizedPrompt: "一只在霓虹城市里的猫",
  sections: [{ label: "画面", value: "霓虹城市" }],
  preset: { modelId: "gw-image-creative", parameters: { quality: "high" }, creditEstimate: { credits: 2, unit: "credit" } },
  createdAt: "2026-06-22T00:00:00.000Z"
};

const authSession: AuthSession = {
  token: "tok-1",
  user: {
    id: "user_email_creator",
    displayName: "creator",
    destination: "creator@example.com",
    channel: "email",
    plan: "free",
    createdAt: "2026-06-21T00:00:00.000Z"
  },
  expiresAt: "2026-06-28T00:00:00.000Z"
};

function createFakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  let tasks: GenerationTask[] = [];
  let assets: CreationAsset[] = [];
  let balance = 100;
  const base: ApiClient = {
    startLogin: async (): Promise<LoginStartResponse> => ({
      challengeId: "c1",
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: "2026-06-21T00:05:00.000Z",
      devCode: "123456"
    }),
    verifyLogin: async () => authSession,
    logout: async () => undefined,
    optimizePrompt: async () => textOptimization,
    createGeneration: async (request) => {
      const result =
        request.mode === "image"
          ? { kind: "image" as const, url: "data:image/png;base64,aGVsbG8=", alt: request.optimizedPrompt }
          : { kind: "text" as const, text: "真实生成文案", format: "markdown" as const };
      const task: GenerationTask = {
        id: `task-${tasks.length + 1}`,
        mode: request.mode,
        status: "succeeded",
        prompt: request.prompt,
        optimizedPrompt: request.optimizedPrompt,
        preset: request.preset,
        resultPreview: { title: "生成任务", description: "已生成。" },
        result,
        createdAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z"
      };
      tasks = [task, ...tasks];
      balance -= request.mode === "image" ? 2 : 1;
      return task;
    },
    listGenerations: async () => tasks,
    createAsset: async (request) => {
      const asset: CreationAsset = {
        id: `asset-${assets.length + 1}`,
        mode: request.mode,
        title: request.title,
        content: request.content,
        preview: { title: request.title, description: "已保存。" },
        source: request.source,
        prompt: request.prompt,
        optimizedPrompt: request.optimizedPrompt,
        preset: request.preset,
        createdAt: "2026-06-21T00:00:00.000Z"
      };
      assets = [asset, ...assets];
      return asset;
    },
    listAssets: async () => assets,
    getCreditBalance: async () => ({ credits: balance, unit: "credit" as const }),
    getSession: async () => ({ authenticated: false, user: null, expiresAt: null }),
    getGeneration: async (id: string) => {
      const found = tasks.find((task) => task.id === id);
      if (!found) {
        throw new ApiError("Generation task was not found", 404);
      }
      return found;
    },
    topUpCredits: async (amount: number) => {
      balance += amount;
      return { credits: balance, unit: "credit" as const };
    }
  };
  return { ...base, ...overrides };
}

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

async function signIn(client: ApiClient) {
  render(<App client={client} />);
  fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
  await screen.findByText("开发验证码：123456");
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("button", { name: "Signed in as creator" });
}

describe("Desktop App", () => {
  it("shows the sign-in entry when unauthenticated", () => {
    render(<App client={createFakeClient()} />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("登录邮箱或手机号")).toBeTruthy();
  });

  it("completes the passwordless login flow", async () => {
    const startLogin = vi.fn(async () => ({
      challengeId: "c1",
      channel: "email" as const,
      maskedDestination: "c***@example.com",
      expiresAt: "2026-06-21T00:05:00.000Z",
      devCode: "123456"
    }));
    const client = createFakeClient({ startLogin });
    render(<App client={client} />);
    fireEvent.change(screen.getByLabelText("登录邮箱或手机号"), {
      target: { value: "creator@example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
    await screen.findByText("开发验证码：123456");
    expect(startLogin).toHaveBeenCalledWith({ destination: "creator@example.com" });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByRole("button", { name: "Signed in as creator" });
    expect(screen.getByRole("button", { name: "Signed in as creator" })).toBeTruthy();
    const modeNavigation = screen.getByRole("navigation", { name: "Studio modes" });
    expect(within(modeNavigation).getByRole("button", { name: "文本创作" })).toBeTruthy();
  });

  it("optimizes then submits a generation into the task center", async () => {
    const client = createFakeClient();
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    await within(taskCenter).findByText("已完成");
    expect(within(taskCenter).getByText("gw-text-balanced")).toBeTruthy();
  });

  it("shows the generated text in the task center", async () => {
    const client = createFakeClient();
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    await within(taskCenter).findByText("真实生成文案");
    expect(within(taskCenter).getByText("已完成")).toBeTruthy();
  });

  it("saves a succeeded text task to the asset library", async () => {
    const client = createFakeClient();
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    fireEvent.click(await within(taskCenter).findByRole("button", { name: "保存到资产库" }));

    const assetLibrary = screen.getByLabelText("资产库");
    await within(assetLibrary).findByText("文本资产");
    expect(within(assetLibrary).getByText("已保存。")).toBeTruthy();
  });

  it("renders a generated image in the task center", async () => {
    const client = createFakeClient({ optimizePrompt: async () => imageOptimization });
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    const img = await within(taskCenter).findByRole("img");
    expect((img as HTMLImageElement).getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("saves a succeeded image task to the asset library", async () => {
    const client = createFakeClient({ optimizePrompt: async () => imageOptimization });
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "提交生成" }));

    const taskCenter = screen.getByLabelText("任务中心");
    fireEvent.click(await within(taskCenter).findByRole("button", { name: "保存到资产库" }));

    const assetLibrary = screen.getByLabelText("资产库");
    await within(assetLibrary).findByText("图片资产");
    expect(within(assetLibrary).getByRole("img")).toBeTruthy();
  });

  it("lists the user's assets read-only (no save button)", async () => {
    const asset: CreationAsset = {
      id: "a1",
      mode: "text",
      title: "文本资产",
      content: { kind: "text", text: "已生成文案", format: "markdown" },
      preview: { title: "文本资产", description: "占位文本资产。" },
      source: { taskId: "t1", taskStatus: "succeeded" },
      prompt: "帮我写一个咖啡店新品发布文案",
      optimizedPrompt: "请生成一段新品推广文案。",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      createdAt: "2026-06-21T00:00:00.000Z"
    };
    const client = createFakeClient({ listAssets: async () => [asset] });
    await signIn(client);

    const assetLibrary = screen.getByLabelText("资产库");
    expect(within(assetLibrary).getByText("文本资产")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存到资产库" })).toBeNull();
  });

  it("surfaces a login error", async () => {
    const client = createFakeClient({
      startLogin: async () => {
        throw new Error("Login destination is required");
      }
    });
    render(<App client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Login destination is required");
  });

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
    expect(screen.getByRole("button", { name: "Signed in as creator" })).toBeTruthy();
  });

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

  it("refreshes a running task from the task center", async () => {
    const runningTask: GenerationTask = {
      id: "task-v",
      mode: "video",
      status: "running",
      prompt: "一段短视频",
      optimizedPrompt: "生成一段短视频。",
      preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } },
      resultPreview: { title: "视频生成任务", description: "生成中。" },
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z"
    };
    const succeededTask: GenerationTask = {
      ...runningTask,
      status: "succeeded",
      result: { kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" }
    };
    const client = createFakeClient({
      listGenerations: async () => [runningTask],
      getGeneration: async () => succeededTask
    });
    await signIn(client);

    const taskCenter = screen.getByLabelText("任务中心");
    expect(within(taskCenter).getByText("生成中")).toBeTruthy();
    fireEvent.click(within(taskCenter).getByRole("button", { name: "刷新状态" }));

    expect(await within(taskCenter).findByText("已完成")).toBeTruthy();
  });

  it("renders and saves a generated video", async () => {
    const videoTask: GenerationTask = {
      id: "task-vid",
      mode: "video",
      status: "succeeded",
      prompt: "一段海边日落短视频",
      optimizedPrompt: "生成一段海边日落短视频。",
      preset: { modelId: "gw-video-motion", parameters: {}, creditEstimate: { credits: 3, unit: "credit" } },
      resultPreview: { title: "视频生成任务", description: "已生成。" },
      result: { kind: "video", url: "https://cdn/v.mp4", durationSeconds: 8, posterUrl: "https://cdn/p.jpg" },
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z"
    };
    const client = createFakeClient({ listGenerations: async () => [videoTask] });
    await signIn(client);

    const taskCenter = screen.getByLabelText("任务中心");
    expect(taskCenter.querySelector("video")?.getAttribute("src")).toBe("https://cdn/v.mp4");

    fireEvent.click(within(taskCenter).getByRole("button", { name: "保存到资产库" }));

    const assetLibrary = screen.getByLabelText("资产库");
    await within(assetLibrary).findByText("视频资产");
    expect(assetLibrary.querySelector("video")?.getAttribute("src")).toBe("https://cdn/v.mp4");
  });

  it("tops up the balance from the header", async () => {
    const client = createFakeClient();
    await signIn(client);
    await screen.findByText("积分：100");

    fireEvent.click(screen.getByRole("button", { name: "充值" }));

    expect(await screen.findByText("积分：200")).toBeTruthy();
  });

  it("summarizes authenticated desktop sessions", () => {
    expect(
      getDesktopSessionCta({ authenticated: true, expiresAt: authSession.expiresAt, user: authSession.user })
    ).toBe("Signed in as creator");
  });
});
