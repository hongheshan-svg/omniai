import { expect, it, vi } from "vitest";
import type { GenerationTask } from "@gw-link-omniai/shared";
import { ApiError, createApiClient } from "../apiClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const baseUrl = "http://api.test";

it("posts start-login and returns the response body", async () => {
  const fetchMock = vi.fn(async () =>
    jsonResponse({
      challengeId: "c1",
      channel: "email",
      maskedDestination: "c***@example.com",
      expiresAt: "2026-06-21T00:05:00.000Z",
      devCode: "123456"
    })
  );
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  const result = await client.startLogin({ destination: "creator@example.com" });

  expect(result.challengeId).toBe("c1");
  const call0 = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const [url, init] = call0;
  expect(url).toBe("http://api.test/v1/auth/start-login");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual({ destination: "creator@example.com" });
  expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
});

it("fetches the session with the bearer token", async () => {
  const session = {
    authenticated: true,
    user: {
      id: "user_email_creator",
      displayName: "creator",
      destination: "creator@example.com",
      channel: "email",
      plan: "free",
      createdAt: "2026-06-22T00:00:00.000Z"
    },
    expiresAt: "2026-06-29T00:00:00.000Z"
  };
  const fetchMock = vi.fn(async () => jsonResponse(session));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  const result = await client.getSession("tok-1");

  expect(result).toEqual(session);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://api.test/v1/auth/session");
  expect(init.method ?? "GET").toBe("GET");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
});

it("fetches the credit balance with the bearer token and unwraps the envelope", async () => {
  const balance = { credits: 100, unit: "credit" };
  const fetchMock = vi.fn(async () => jsonResponse({ balance }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  const result = await client.getCreditBalance("tok-1");

  expect(result).toEqual(balance);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://api.test/v1/credits/balance");
  expect(init.method ?? "GET").toBe("GET");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
});

it("unwraps the generation task envelope and sends the bearer token", async () => {
  const task: GenerationTask = {
    id: "t1",
    mode: "text",
    status: "queued",
    prompt: "p",
    optimizedPrompt: "op",
    preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
    resultPreview: { title: "T", description: "D" },
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z"
  };
  const fetchMock = vi.fn(async () => jsonResponse({ task }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  const created = await client.createGeneration(
    { mode: "text", prompt: "p", optimizedPrompt: "op", preset: task.preset },
    "tok-1"
  );

  expect(created).toEqual(task);
  const call0 = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const [url, init] = call0;
  expect(url).toBe("http://api.test/v1/generations");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
});

it("unwraps the tasks list with the bearer token", async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ tasks: [] }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  const tasks = await client.listGenerations("tok-1");

  expect(tasks).toEqual([]);
  const call0 = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const [url, init] = call0;
  expect(url).toBe("http://api.test/v1/generations");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
});

it("unwraps the prompt optimization envelope", async () => {
  const fetchMock = vi.fn(async () =>
    jsonResponse({ optimization: { id: "o1", mode: "text", originalPrompt: "p", optimizedPrompt: "op", sections: [], preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } }, createdAt: "2026-06-21T00:00:00.000Z" } })
  );
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  const optimization = await client.optimizePrompt({ mode: "text", prompt: "p" });

  expect(optimization.optimizedPrompt).toBe("op");
});

it("throws ApiError with the API error message and status on non-2xx", async () => {
  const fetchMock = vi.fn(async () => jsonResponse({ error: "Authentication required" }, 401));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  await expect(client.listGenerations("bad")).rejects.toMatchObject({
    name: "ApiError",
    message: "Authentication required",
    status: 401
  });
  await expect(client.listGenerations("bad")).rejects.toBeInstanceOf(ApiError);
});

it("posts an asset with the bearer token and unwraps the asset envelope", async () => {
  const asset = {
    id: "a1",
    mode: "text",
    title: "文本资产",
    content: { kind: "text", text: "已生成文案", format: "markdown" },
    preview: { title: "文本资产", description: "占位文本资产。" },
    source: { taskId: "t1", taskStatus: "succeeded" },
    prompt: "p",
    optimizedPrompt: "op",
    preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
    createdAt: "2026-06-21T00:00:00.000Z"
  };
  const fetchMock = vi.fn(async () => jsonResponse({ asset }));
  const client = createApiClient({ baseUrl, fetch: fetchMock as unknown as typeof fetch });

  const created = await client.createAsset(
    {
      mode: "text",
      title: "文本资产",
      content: { kind: "text", text: "已生成文案", format: "markdown" },
      source: { taskId: "t1", taskStatus: "succeeded" },
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } }
    },
    "tok-1"
  );

  expect(created).toEqual(asset);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://api.test/v1/assets");
  expect(init.method).toBe("POST");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
});
