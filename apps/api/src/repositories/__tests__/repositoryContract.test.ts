import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreationAsset, GenerationTask, UserProfile } from "@gw-link-omniai/shared";
import {
  InMemoryAssetRepository,
  InMemoryChallengeRepository,
  InMemoryGenerationTaskRepository,
  InMemorySessionRepository,
  InMemoryUserRepository
} from "../memory";
import type {
  AssetRepository,
  ChallengeRepository,
  GenerationTaskRepository,
  LoginChallengeRecord,
  SessionRecord,
  SessionRepository,
  UserRepository
} from "../types";

interface RepositoryBundle {
  users: UserRepository;
  sessions: SessionRepository;
  challenges: ChallengeRepository;
  tasks: GenerationTaskRepository;
  assets: AssetRepository;
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
      assets: new InMemoryAssetRepository()
    },
    async close() {}
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

const backends = [{ name: "memory", setup: setupMemory }];

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

  it("inserts and lists generation tasks preserving jsonb and ordering", async () => {
    const { tasks } = context.bundle;
    await tasks.insert(makeTask({ id: "task-a", createdAt: "2026-06-20T00:00:00.000Z" }));
    await tasks.insert(makeTask({ id: "task-b", createdAt: "2026-06-20T00:00:01.000Z" }));

    const listed = await tasks.list();
    expect(listed.map((task) => task.id)).toEqual(["task-a", "task-b"]);
    expect(listed[0]!.preset).toEqual(makeTask().preset);
    expect(listed[0]!.resultPreview).toEqual(makeTask().resultPreview);
  });

  it("inserts and lists assets preserving the content discriminated union", async () => {
    const { assets } = context.bundle;
    await assets.insert(makeAsset({ id: "asset-a", createdAt: "2026-06-20T00:00:00.000Z" }));
    await assets.insert(makeAsset({ id: "asset-b", createdAt: "2026-06-20T00:00:01.000Z" }));

    const listed = await assets.list();
    expect(listed.map((asset) => asset.id)).toEqual(["asset-a", "asset-b"]);
    expect(listed[0]!.content).toEqual(makeAsset().content);
    expect(listed[0]!.source).toEqual(makeAsset().source);
  });

  it("does not share mutable references with stored task state", async () => {
    const { tasks } = context.bundle;
    await tasks.insert(makeTask({ id: "task-a" }));

    const first = await tasks.list();
    first[0]!.preset.parameters.quality = "mutated";

    const second = await tasks.list();
    expect(second[0]!.preset.parameters.quality).toBe("high");
  });

  it("does not share mutable references with the inserted task (write isolation)", async () => {
    const { tasks } = context.bundle;
    const task = makeTask({ id: "task-a" });
    await tasks.insert(task);
    task.preset.parameters.quality = "mutated";

    const listed = await tasks.list();
    expect(listed[0]!.preset.parameters.quality).toBe("high");
  });
});
