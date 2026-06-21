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
import type { ApiClient } from "../apiClient";
import { getDesktopSessionCta } from "../sessionModel";

afterEach(cleanup);

const textOptimization: PromptOptimization = {
  id: "o1",
  mode: "text",
  originalPrompt: "帮我写一个咖啡店新品发布文案",
  optimizedPrompt: "请生成一段新品推广文案。",
  sections: [{ label: "写作目标", value: "发布新品" }],
  preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
  createdAt: "2026-06-21T00:00:00.000Z"
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
      const task: GenerationTask = {
        id: `task-${tasks.length + 1}`,
        mode: request.mode,
        status: "succeeded",
        prompt: request.prompt,
        optimizedPrompt: request.optimizedPrompt,
        preset: request.preset,
        resultPreview: { title: "文本生成任务", description: "已生成。" },
        result: { kind: "text", text: "真实生成文案", format: "markdown" },
        createdAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z"
      };
      tasks = [task, ...tasks];
      return task;
    },
    listGenerations: async () => tasks,
    listAssets: async (): Promise<CreationAsset[]> => [],
    createAsset: async () => { throw new Error("createAsset not implemented in fake"); }
  };
  return { ...base, ...overrides };
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

  it("summarizes authenticated desktop sessions", () => {
    expect(
      getDesktopSessionCta({ authenticated: true, expiresAt: authSession.expiresAt, user: authSession.user })
    ).toBe("Signed in as creator");
  });
});
