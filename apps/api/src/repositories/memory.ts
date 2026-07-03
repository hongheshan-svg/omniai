import type {
  CreationAsset,
  GenerationTask,
  LoginChannel,
  UserProfile
} from "@gw-link-omniai/shared";
import type {
  AssetRepository,
  ChallengeRepository,
  CreditTransactionRecord,
  CreditTransactionRepository,
  GenerationTaskRepository,
  LoginChallengeRecord,
  OrderRecord,
  OrderRepository,
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
  private readonly tasks: Array<{ ownerUserId: string; task: GenerationTask; providerRef: string | null }> = [];

  async insert(task: GenerationTask, ownerUserId: string, providerRef: string | null = null): Promise<void> {
    this.tasks.push({ ownerUserId, task: structuredClone(task), providerRef });
  }

  async list(ownerUserId: string): Promise<GenerationTask[]> {
    return this.tasks
      .filter((row) => row.ownerUserId === ownerUserId)
      .map((row) => structuredClone(row.task));
  }

  async get(
    ownerUserId: string,
    id: string
  ): Promise<{ task: GenerationTask; providerRef: string | null } | undefined> {
    const row = this.tasks.find((entry) => entry.ownerUserId === ownerUserId && entry.task.id === id);
    return row ? { task: structuredClone(row.task), providerRef: row.providerRef } : undefined;
  }

  async update(task: GenerationTask, ownerUserId: string, providerRef: string | null = null): Promise<void> {
    const row = this.tasks.find((entry) => entry.ownerUserId === ownerUserId && entry.task.id === task.id);
    if (row) {
      row.task = structuredClone(task);
      row.providerRef = providerRef;
    }
  }
}

export class InMemoryAssetRepository implements AssetRepository {
  private readonly assets: Array<{ ownerUserId: string; asset: CreationAsset }> = [];

  async insert(asset: CreationAsset, ownerUserId: string): Promise<void> {
    this.assets.push({ ownerUserId, asset: structuredClone(asset) });
  }

  async list(ownerUserId: string): Promise<CreationAsset[]> {
    return this.assets
      .filter((row) => row.ownerUserId === ownerUserId)
      .map((row) => structuredClone(row.asset));
  }
}

export class InMemoryCreditTransactionRepository implements CreditTransactionRepository {
  private readonly rows: Array<{ ownerUserId: string; record: CreditTransactionRecord }> = [];

  async insert(record: CreditTransactionRecord, ownerUserId: string): Promise<void> {
    this.rows.push({ ownerUserId, record: structuredClone(record) });
  }

  async balance(ownerUserId: string): Promise<number> {
    return this.rows
      .filter((row) => row.ownerUserId === ownerUserId)
      .reduce((sum, row) => sum + row.record.amount, 0);
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  private readonly rows: Array<{ ownerUserId: string; record: OrderRecord }> = [];

  insert(record: OrderRecord, ownerUserId: string): void {
    this.rows.push({ ownerUserId, record: structuredClone(record) });
  }

  listByOwner(ownerUserId: string): OrderRecord[] {
    return this.rows
      .filter((row) => row.ownerUserId === ownerUserId)
      .map((row) => structuredClone(row.record));
  }

  get(ownerUserId: string, id: string): OrderRecord | null {
    const row = this.rows.find((r) => r.ownerUserId === ownerUserId && r.record.id === id);
    return row ? structuredClone(row.record) : null;
  }
}
