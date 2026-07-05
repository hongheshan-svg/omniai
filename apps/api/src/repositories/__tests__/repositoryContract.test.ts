import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreationAsset, GenerationTask, UserProfile } from "@gw-link-omniai/shared";
import {
  InMemoryAssetRepository,
  InMemoryChallengeRepository,
  InMemoryCreditTransactionRepository,
  InMemoryGenerationTaskRepository,
  InMemoryOrderRepository,
  InMemorySessionRepository,
  InMemoryUserRepository
} from "../memory";
import type {
  AssetRepository,
  ChallengeRepository,
  CreditTransactionRepository,
  GenerationTaskRepository,
  LoginChallengeRecord,
  OrderRepository,
  SessionRecord,
  SessionRepository,
  UserRepository
} from "../types";
import {
  DrizzleAssetRepository,
  DrizzleChallengeRepository,
  DrizzleCreditTransactionRepository,
  DrizzleGenerationTaskRepository,
  DrizzleOrderRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository
} from "../drizzle";
import { createPgliteDatabase } from "../../testSupport/pglite";

interface RepositoryBundle {
  users: UserRepository;
  sessions: SessionRepository;
  challenges: ChallengeRepository;
  tasks: GenerationTaskRepository;
  assets: AssetRepository;
  credits: CreditTransactionRepository;
  orders: OrderRepository;
}

interface BackendContext {
  bundle: RepositoryBundle;
  close(): Promise<void>;
}

async function setupMemory(): Promise<BackendContext> {
  return {
    bundle: {
      users: new InMemoryUserRepository(),
      sessions: new InMemorySessionRepository(),
      challenges: new InMemoryChallengeRepository(),
      tasks: new InMemoryGenerationTaskRepository(),
      assets: new InMemoryAssetRepository(),
      credits: new InMemoryCreditTransactionRepository(),
      orders: new InMemoryOrderRepository()
    },
    async close() {}
  };
}

async function setupPglite(): Promise<BackendContext> {
  const { db, close } = await createPgliteDatabase();
  return {
    bundle: {
      users: new DrizzleUserRepository(db),
      sessions: new DrizzleSessionRepository(db),
      challenges: new DrizzleChallengeRepository(db),
      tasks: new DrizzleGenerationTaskRepository(db),
      assets: new DrizzleAssetRepository(db),
      credits: new DrizzleCreditTransactionRepository(db),
      orders: new DrizzleOrderRepository(db)
    },
    close
  };
}

function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user_email_0000000000000000",
    displayName: "creator",
    destination: "creator@example.com",
    channel: "email",
    plan: "free",
    createdAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

function makeChallenge(overrides: Partial<LoginChallengeRecord> = {}): LoginChallengeRecord {
  return {
    id: "challenge-1",
    destination: "creator@example.com",
    channel: "email",
    codeHash: "hash-1",
    expiresAtMs: 1_000,
    failedAttempts: 0,
    ...overrides
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    token: "session-token-1",
    userId: "user_email_0000000000000000",
    expiresAtMs: 1_000,
    ...overrides
  };
}

function makeTask(overrides: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: "generation_task_1",
    mode: "image",
    status: "queued",
    prompt: "做一张海报",
    optimizedPrompt: "制作一张商业海报。",
    preset: {
      modelId: "gw-image-creative",
      parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
      creditEstimate: { credits: 2, unit: "credit" }
    },
    resultPreview: { title: "图片生成任务", description: "任务已排队。" },
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

function makeAsset(overrides: Partial<CreationAsset> = {}): CreationAsset {
  return {
    id: "creation_asset_1",
    mode: "image",
    title: "图片资产",
    content: {
      kind: "image",
      url: "https://assets.gw-link.local/placeholders/image-generation.png",
      alt: "占位图"
    },
    preview: { title: "图片资产", description: "占位图片资产。" },
    source: { taskId: "generation_task_1", taskStatus: "succeeded" },
    prompt: "做一张海报",
    optimizedPrompt: "制作一张商业海报。",
    preset: {
      modelId: "gw-image-creative",
      parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
      creditEstimate: { credits: 2, unit: "credit" }
    },
    createdAt: "2026-06-20T00:00:00.000Z",
    ...overrides
  };
}

const backends = [
  { name: "memory", setup: setupMemory },
  { name: "pglite", setup: setupPglite }
];

describe.each(backends)("$name repositories", ({ setup }) => {
  let context: BackendContext;

  beforeEach(async () => {
    context = await setup();
  });

  afterEach(async () => {
    await context.close();
  });

  it("inserts and finds users by subject and id", async () => {
    const { users } = context.bundle;
    const user = makeUser();
    await users.insert(user);

    expect(await users.findBySubject("email", "creator@example.com")).toEqual(user);
    expect(await users.findById(user.id)).toEqual(user);
    expect(await users.findBySubject("phone", "creator@example.com")).toBeUndefined();
    expect(await users.findById("missing")).toBeUndefined();
  });

  it("saves, finds, and deletes sessions", async () => {
    const { users, sessions } = context.bundle;
    await users.insert(makeUser());
    const session = makeSession();
    await sessions.save(session);

    expect(await sessions.findByToken(session.token)).toEqual(session);
    expect(await sessions.delete(session.token)).toBe(true);
    expect(await sessions.delete(session.token)).toBe(false);
    expect(await sessions.findByToken(session.token)).toBeUndefined();
  });

  it("deletes expired sessions only", async () => {
    const { users, sessions } = context.bundle;
    await users.insert(makeUser());
    await sessions.save(makeSession({ token: "expired", expiresAtMs: 1_000 }));
    await sessions.save(makeSession({ token: "active", expiresAtMs: 5_000 }));

    await sessions.deleteExpired(1_000);

    expect(await sessions.findByToken("expired")).toBeUndefined();
    expect(await sessions.findByToken("active")).toBeDefined();
  });

  it("saves, updates failed attempts, and deletes challenges", async () => {
    const { challenges } = context.bundle;
    await challenges.save(makeChallenge());

    const found = await challenges.findById("challenge-1");
    expect(found).toEqual(makeChallenge());

    await challenges.update(makeChallenge({ failedAttempts: 3 }));
    expect((await challenges.findById("challenge-1"))?.failedAttempts).toBe(3);

    expect(await challenges.delete("challenge-1")).toBe(true);
    expect(await challenges.delete("challenge-1")).toBe(false);
    expect(await challenges.findById("challenge-1")).toBeUndefined();
  });

  it("deletes expired challenges only", async () => {
    const { challenges } = context.bundle;
    await challenges.save(makeChallenge({ id: "expired", expiresAtMs: 1_000 }));
    await challenges.save(makeChallenge({ id: "active", expiresAtMs: 5_000 }));

    await challenges.deleteExpired(1_000);

    expect(await challenges.findById("expired")).toBeUndefined();
    expect(await challenges.findById("active")).toBeDefined();
  });

  it("inserts and lists generation tasks scoped to the owner", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));
    await tasks.insert(makeTask({ id: "task-a", createdAt: "2026-06-20T00:00:00.000Z" }), "owner-a");
    await tasks.insert(makeTask({ id: "task-b", createdAt: "2026-06-20T00:00:01.000Z" }), "owner-a");

    const listed = await tasks.list("owner-a");
    expect(listed.map((task) => task.id)).toEqual(["task-a", "task-b"]);
    expect(listed[0]!.preset).toEqual(makeTask().preset);
    expect(listed[0]!.resultPreview).toEqual(makeTask().resultPreview);
    expect(await tasks.list("owner-b")).toEqual([]);
  });

  it("inserts and lists assets scoped to the owner", async () => {
    const { users, assets } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));
    await assets.insert(makeAsset({ id: "asset-a", createdAt: "2026-06-20T00:00:00.000Z" }), "owner-a");
    await assets.insert(makeAsset({ id: "asset-b", createdAt: "2026-06-20T00:00:01.000Z" }), "owner-a");

    const listed = await assets.list("owner-a");
    expect(listed.map((asset) => asset.id)).toEqual(["asset-a", "asset-b"]);
    expect(listed[0]!.content).toEqual(makeAsset().content);
    expect(listed[0]!.source).toEqual(makeAsset().source);
    expect(await assets.list("owner-b")).toEqual([]);
  });

  it("does not share mutable references with stored task state", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await tasks.insert(makeTask({ id: "task-a" }), "owner-a");

    const first = await tasks.list("owner-a");
    first[0]!.preset.parameters.quality = "mutated";

    const second = await tasks.list("owner-a");
    expect(second[0]!.preset.parameters.quality).toBe("high");
  });

  it("round-trips a task result", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await tasks.insert(
      makeTask({
        id: "task-result",
        status: "succeeded",
        result: { kind: "text", text: "生成的文案", format: "markdown" }
      }),
      "owner-a"
    );

    const [listed] = await tasks.list("owner-a");
    expect(listed!.result).toEqual({ kind: "text", text: "生成的文案", format: "markdown" });
    expect(listed!.status).toBe("succeeded");
  });

  it("round-trips an image task result", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await tasks.insert(
      makeTask({
        id: "task-image",
        status: "succeeded",
        result: { kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "一只猫" }
      }),
      "owner-a"
    );

    const [listed] = await tasks.list("owner-a");
    expect(listed!.result).toEqual({ kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "一只猫" });
  });

  it("gets a task with its provider ref scoped to the owner", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));
    await tasks.insert(makeTask({ id: "task-a", status: "running" }), "owner-a", "job-1");

    const got = await tasks.get("owner-a", "task-a");
    expect(got?.task.status).toBe("running");
    expect(got?.providerRef).toBe("job-1");
    expect(await tasks.get("owner-b", "task-a")).toBeUndefined();
    expect(await tasks.get("owner-a", "missing")).toBeUndefined();
  });

  it("updates a task status, result, and provider ref", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await tasks.insert(makeTask({ id: "task-a", status: "running" }), "owner-a", "job-1");

    await tasks.update(
      makeTask({
        id: "task-a",
        status: "succeeded",
        result: { kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" }
      }),
      "owner-a",
      null
    );

    const got = await tasks.get("owner-a", "task-a");
    expect(got?.task.status).toBe("succeeded");
    expect(got?.task.result).toEqual({ kind: "image", url: "data:image/png;base64,dmlkZW8=", alt: "video" });
    expect(got?.providerRef).toBeNull();
  });

  it("does not share mutable references with the inserted task (write isolation)", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    const task = makeTask({ id: "task-a" });
    await tasks.insert(task, "owner-a");
    task.preset.parameters.quality = "mutated";

    const listed = await tasks.list("owner-a");
    expect(listed[0]!.preset.parameters.quality).toBe("high");
  });

  it("starts a credit balance at zero", async () => {
    const { users, credits } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    expect(await credits.balance("owner-a")).toBe(0);
  });

  it("sums credit transactions into a balance scoped to the owner", async () => {
    const { users, credits } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));

    await credits.insert(
      { id: "tx-1", amount: 100, reason: "signup_grant", reference: null, createdAt: "2026-06-20T00:00:00.000Z" },
      "owner-a"
    );
    await credits.insert(
      { id: "tx-2", amount: -2, reason: "generation", reference: "task-1", createdAt: "2026-06-20T00:00:01.000Z" },
      "owner-a"
    );

    expect(await credits.balance("owner-a")).toBe(98);
    expect(await credits.balance("owner-b")).toBe(0);
  });

  it("inserts and lists orders by owner only", async () => {
    const { users, orders } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));

    const record = {
      id: "order_1",
      packageId: "credits-100",
      credits: 100,
      amountCents: 990,
      currency: "CNY",
      status: "pending" as const,
      checkoutRef: "checkout_1",
      createdAt: "2026-07-03T00:00:00.000Z"
    };
    await orders.insert(record, "owner-a");
    await orders.insert({ ...record, id: "order_2", checkoutRef: "checkout_2" }, "owner-b");

    const listA = await orders.listByOwner("owner-a");
    expect(listA.map((o) => o.id)).toEqual(["order_1"]);
    expect(await orders.get("owner-a", "order_1")).toMatchObject({ id: "order_1", status: "pending" });
    expect(await orders.get("owner-a", "order_2")).toBeNull();
  });

  it("finds an order by checkout ref and updates its status", async () => {
    const { users, orders } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));

    const record = {
      id: "order_1",
      packageId: "credits-100",
      credits: 100,
      amountCents: 990,
      currency: "CNY",
      status: "pending" as const,
      checkoutRef: "checkout_abc",
      createdAt: "2026-07-03T00:00:00.000Z"
    };
    await orders.insert(record, "owner-a");

    const found = await orders.getByCheckoutRef("checkout_abc");
    expect(found).toMatchObject({ ownerUserId: "owner-a", record: { id: "order_1", status: "pending" } });
    expect(await orders.getByCheckoutRef("missing")).toBeNull();

    await orders.updateStatus("order_1", "paid");
    const afterStatusOnly = await orders.get("owner-a", "order_1");
    expect(afterStatusOnly?.status).toBe("paid");
    expect(afterStatusOnly?.paidAt).toBeUndefined();

    await orders.updateStatus("order_1", "paid", "2026-07-03T01:02:00.000Z");
    expect((await orders.get("owner-a", "order_1"))?.paidAt).toBe("2026-07-03T01:02:00.000Z");
  });

  it("round-trips an order's checkoutUrl when present, and leaves it undefined when absent", async () => {
    const { users, orders } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));

    await orders.insert(
      {
        id: "order_with_url",
        packageId: "credits-100",
        credits: 100,
        amountCents: 990,
        currency: "CNY",
        status: "pending",
        checkoutRef: "checkout_with_url",
        createdAt: "2026-07-04T00:00:00.000Z",
        checkoutUrl: "https://pay.example/x"
      },
      "owner-a"
    );
    expect((await orders.get("owner-a", "order_with_url"))?.checkoutUrl).toBe("https://pay.example/x");

    await orders.insert(
      {
        id: "order_without_url",
        packageId: "credits-100",
        credits: 100,
        amountCents: 990,
        currency: "CNY",
        status: "pending",
        checkoutRef: "checkout_without_url",
        createdAt: "2026-07-04T00:00:01.000Z"
      },
      "owner-a"
    );
    expect((await orders.get("owner-a", "order_without_url"))?.checkoutUrl).toBeUndefined();
  });

  it("lists all orders across owners", async () => {
    const { users, orders } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    await users.insert(makeUser({ id: "owner-b", destination: "b@example.com" }));

    await orders.insert(
      {
        id: "order_a",
        packageId: "credits-100",
        credits: 100,
        amountCents: 990,
        currency: "CNY",
        status: "pending",
        checkoutRef: "chk_a",
        createdAt: "2026-07-04T00:00:00.000Z"
      },
      "owner-a"
    );
    await orders.insert(
      {
        id: "order_b",
        packageId: "credits-100",
        credits: 100,
        amountCents: 990,
        currency: "CNY",
        status: "paid",
        checkoutRef: "chk_b",
        createdAt: "2026-07-04T01:00:00.000Z"
      },
      "owner-b"
    );

    const all = await orders.listAll();
    expect(all.map((o) => o.id).sort()).toEqual(["order_a", "order_b"]);
  });
});
