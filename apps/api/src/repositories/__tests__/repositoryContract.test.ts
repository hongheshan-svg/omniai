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
import {
  DrizzleAssetRepository,
  DrizzleChallengeRepository,
  DrizzleGenerationTaskRepository,
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

async function setupPglite(): Promise<BackendContext> {
  const { db, close } = await createPgliteDatabase();
  return {
    bundle: {
      users: new DrizzleUserRepository(db),
      sessions: new DrizzleSessionRepository(db),
      challenges: new DrizzleChallengeRepository(db),
      tasks: new DrizzleGenerationTaskRepository(db),
      assets: new DrizzleAssetRepository(db)
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

  it("does not share mutable references with the inserted task (write isolation)", async () => {
    const { users, tasks } = context.bundle;
    await users.insert(makeUser({ id: "owner-a", destination: "a@example.com" }));
    const task = makeTask({ id: "task-a" });
    await tasks.insert(task, "owner-a");
    task.preset.parameters.quality = "mutated";

    const listed = await tasks.list("owner-a");
    expect(listed[0]!.preset.parameters.quality).toBe("high");
  });
});
