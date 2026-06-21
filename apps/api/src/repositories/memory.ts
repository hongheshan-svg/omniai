import type {
  CreationAsset,
  GenerationTask,
  LoginChannel,
  UserProfile
} from "@gw-link-omniai/shared";
import type {
  AssetRepository,
  ChallengeRepository,
  GenerationTaskRepository,
  LoginChallengeRecord,
  SessionRecord,
  SessionRepository,
  UserRepository
} from "./types";

function subjectKey(channel: LoginChannel, destination: string): string {
  return `${channel}:${destination}`;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserProfile>();
  private readonly subjectToId = new Map<string, string>();

  async findBySubject(channel: LoginChannel, destination: string): Promise<UserProfile | undefined> {
    const id = this.subjectToId.get(subjectKey(channel, destination));
    if (id === undefined) {
      return undefined;
    }
    const user = this.byId.get(id);
    return user ? structuredClone(user) : undefined;
  }

  async findById(id: string): Promise<UserProfile | undefined> {
    const user = this.byId.get(id);
    return user ? structuredClone(user) : undefined;
  }

  async insert(user: UserProfile): Promise<void> {
    this.byId.set(user.id, structuredClone(user));
    this.subjectToId.set(subjectKey(user.channel, user.destination), user.id);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>();

  async save(session: SessionRecord): Promise<void> {
    this.sessions.set(session.token, structuredClone(session));
  }

  async findByToken(token: string): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(token);
    return session ? structuredClone(session) : undefined;
  }

  async delete(token: string): Promise<boolean> {
    return this.sessions.delete(token);
  }

  async deleteExpired(nowMs: number): Promise<void> {
    for (const [token, session] of this.sessions) {
      if (session.expiresAtMs <= nowMs) {
        this.sessions.delete(token);
      }
    }
  }
}

export class InMemoryChallengeRepository implements ChallengeRepository {
  private readonly challenges = new Map<string, LoginChallengeRecord>();

  async save(challenge: LoginChallengeRecord): Promise<void> {
    this.challenges.set(challenge.id, structuredClone(challenge));
  }

  async findById(id: string): Promise<LoginChallengeRecord | undefined> {
    const challenge = this.challenges.get(id);
    return challenge ? structuredClone(challenge) : undefined;
  }

  async update(challenge: LoginChallengeRecord): Promise<void> {
    this.challenges.set(challenge.id, structuredClone(challenge));
  }

  async delete(id: string): Promise<boolean> {
    return this.challenges.delete(id);
  }

  async deleteExpired(nowMs: number): Promise<void> {
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAtMs <= nowMs) {
        this.challenges.delete(id);
      }
    }
  }
}

export class InMemoryGenerationTaskRepository implements GenerationTaskRepository {
  private readonly tasks: GenerationTask[] = [];

  async insert(task: GenerationTask): Promise<void> {
    this.tasks.push(structuredClone(task));
  }

  async list(): Promise<GenerationTask[]> {
    return this.tasks.map((task) => structuredClone(task));
  }
}

export class InMemoryAssetRepository implements AssetRepository {
  private readonly assets: CreationAsset[] = [];

  async insert(asset: CreationAsset): Promise<void> {
    this.assets.push(structuredClone(asset));
  }

  async list(): Promise<CreationAsset[]> {
    return this.assets.map((asset) => structuredClone(asset));
  }
}
