import { and, eq, lte } from "drizzle-orm";
import type {
  CreationAsset,
  GenerationTask,
  LoginChannel,
  OrderStatus,
  UserProfile
} from "@gw-link-omniai/shared";
import type { AppDatabase } from "../db/client";
import { assets, creditTransactions, generationTasks, loginChallenges, orders, sessions, users } from "../db/schema";
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

function mapUserRow(row: typeof users.$inferSelect): UserProfile {
  return {
    id: row.id,
    displayName: row.displayName,
    destination: row.destination,
    channel: row.channel as LoginChannel,
    plan: row.plan as UserProfile["plan"],
    createdAt: row.createdAt.toISOString()
  };
}

function mapSessionRow(row: typeof sessions.$inferSelect): SessionRecord {
  return { token: row.token, userId: row.userId, expiresAtMs: row.expiresAt.getTime() };
}

function mapChallengeRow(row: typeof loginChallenges.$inferSelect): LoginChallengeRecord {
  return {
    id: row.id,
    destination: row.destination,
    channel: row.channel as LoginChannel,
    codeHash: row.codeHash,
    expiresAtMs: row.expiresAt.getTime(),
    failedAttempts: row.failedAttempts
  };
}

function mapTaskRow(row: typeof generationTasks.$inferSelect): GenerationTask {
  return {
    id: row.id,
    mode: row.mode as GenerationTask["mode"],
    status: row.status as GenerationTask["status"],
    prompt: row.prompt,
    optimizedPrompt: row.optimizedPrompt,
    preset: row.preset,
    resultPreview: row.resultPreview,
    ...(row.result ? { result: row.result } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function mapAssetRow(row: typeof assets.$inferSelect): CreationAsset {
  return {
    id: row.id,
    mode: row.mode as CreationAsset["mode"],
    title: row.title,
    content: row.content,
    preview: row.preview,
    source: row.source,
    prompt: row.prompt,
    optimizedPrompt: row.optimizedPrompt,
    preset: row.preset,
    createdAt: row.createdAt.toISOString()
  };
}

function mapOrderRow(row: typeof orders.$inferSelect): OrderRecord {
  return {
    id: row.id,
    packageId: row.packageId,
    credits: row.credits,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status as OrderStatus,
    checkoutRef: row.checkoutRef,
    createdAt: row.createdAt.toISOString(),
    ...(row.paidAt ? { paidAt: row.paidAt.toISOString() } : {})
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: AppDatabase) {}

  async findBySubject(channel: LoginChannel, destination: string): Promise<UserProfile | undefined> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.channel, channel), eq(users.destination, destination)))
      .limit(1);
    return rows[0] ? mapUserRow(rows[0]) : undefined;
  }

  async findById(id: string): Promise<UserProfile | undefined> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? mapUserRow(rows[0]) : undefined;
  }

  async insert(user: UserProfile): Promise<void> {
    await this.db.insert(users).values({
      id: user.id,
      displayName: user.displayName,
      destination: user.destination,
      channel: user.channel,
      plan: user.plan,
      createdAt: new Date(user.createdAt)
    });
  }
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: AppDatabase) {}

  async save(session: SessionRecord): Promise<void> {
    await this.db
      .insert(sessions)
      .values({
        token: session.token,
        userId: session.userId,
        expiresAt: new Date(session.expiresAtMs)
      })
      .onConflictDoUpdate({
        target: sessions.token,
        set: { userId: session.userId, expiresAt: new Date(session.expiresAtMs) }
      });
  }

  async findByToken(token: string): Promise<SessionRecord | undefined> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
    return rows[0] ? mapSessionRow(rows[0]) : undefined;
  }

  async delete(token: string): Promise<boolean> {
    const deleted = await this.db
      .delete(sessions)
      .where(eq(sessions.token, token))
      .returning({ token: sessions.token });
    return deleted.length > 0;
  }

  async deleteExpired(nowMs: number): Promise<void> {
    await this.db.delete(sessions).where(lte(sessions.expiresAt, new Date(nowMs)));
  }
}

export class DrizzleChallengeRepository implements ChallengeRepository {
  constructor(private readonly db: AppDatabase) {}

  async save(challenge: LoginChallengeRecord): Promise<void> {
    await this.db.insert(loginChallenges).values({
      id: challenge.id,
      destination: challenge.destination,
      channel: challenge.channel,
      codeHash: challenge.codeHash,
      expiresAt: new Date(challenge.expiresAtMs),
      failedAttempts: challenge.failedAttempts
    });
  }

  async findById(id: string): Promise<LoginChallengeRecord | undefined> {
    const rows = await this.db
      .select()
      .from(loginChallenges)
      .where(eq(loginChallenges.id, id))
      .limit(1);
    return rows[0] ? mapChallengeRow(rows[0]) : undefined;
  }

  async update(challenge: LoginChallengeRecord): Promise<void> {
    await this.db
      .update(loginChallenges)
      .set({
        destination: challenge.destination,
        channel: challenge.channel,
        codeHash: challenge.codeHash,
        expiresAt: new Date(challenge.expiresAtMs),
        failedAttempts: challenge.failedAttempts
      })
      .where(eq(loginChallenges.id, challenge.id));
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(loginChallenges)
      .where(eq(loginChallenges.id, id))
      .returning({ id: loginChallenges.id });
    return deleted.length > 0;
  }

  async deleteExpired(nowMs: number): Promise<void> {
    await this.db.delete(loginChallenges).where(lte(loginChallenges.expiresAt, new Date(nowMs)));
  }
}

export class DrizzleGenerationTaskRepository implements GenerationTaskRepository {
  constructor(private readonly db: AppDatabase) {}

  async insert(task: GenerationTask, ownerUserId: string, providerRef: string | null = null): Promise<void> {
    await this.db.insert(generationTasks).values({
      id: task.id,
      ownerUserId,
      mode: task.mode,
      status: task.status,
      prompt: task.prompt,
      optimizedPrompt: task.optimizedPrompt,
      preset: task.preset,
      resultPreview: task.resultPreview,
      result: task.result ?? null,
      providerRef,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt)
    });
  }

  async list(ownerUserId: string): Promise<GenerationTask[]> {
    const rows = await this.db
      .select()
      .from(generationTasks)
      .where(eq(generationTasks.ownerUserId, ownerUserId))
      .orderBy(generationTasks.createdAt);
    return rows.map(mapTaskRow);
  }

  async get(
    ownerUserId: string,
    id: string
  ): Promise<{ task: GenerationTask; providerRef: string | null } | undefined> {
    const rows = await this.db
      .select()
      .from(generationTasks)
      .where(and(eq(generationTasks.id, id), eq(generationTasks.ownerUserId, ownerUserId)))
      .limit(1);
    const row = rows[0];
    return row ? { task: mapTaskRow(row), providerRef: row.providerRef ?? null } : undefined;
  }

  async update(task: GenerationTask, ownerUserId: string, providerRef: string | null = null): Promise<void> {
    await this.db
      .update(generationTasks)
      .set({
        status: task.status,
        result: task.result ?? null,
        providerRef,
        updatedAt: new Date(task.updatedAt)
      })
      .where(and(eq(generationTasks.id, task.id), eq(generationTasks.ownerUserId, ownerUserId)));
  }
}

export class DrizzleAssetRepository implements AssetRepository {
  constructor(private readonly db: AppDatabase) {}

  async insert(asset: CreationAsset, ownerUserId: string): Promise<void> {
    await this.db.insert(assets).values({
      id: asset.id,
      ownerUserId,
      mode: asset.mode,
      title: asset.title,
      content: asset.content,
      preview: asset.preview,
      source: asset.source,
      prompt: asset.prompt,
      optimizedPrompt: asset.optimizedPrompt,
      preset: asset.preset,
      createdAt: new Date(asset.createdAt)
    });
  }

  async list(ownerUserId: string): Promise<CreationAsset[]> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.ownerUserId, ownerUserId))
      .orderBy(assets.createdAt);
    return rows.map(mapAssetRow);
  }
}

export class DrizzleCreditTransactionRepository implements CreditTransactionRepository {
  constructor(private readonly db: AppDatabase) {}

  async insert(record: CreditTransactionRecord, ownerUserId: string): Promise<void> {
    await this.db.insert(creditTransactions).values({
      id: record.id,
      ownerUserId,
      amount: record.amount,
      reason: record.reason,
      reference: record.reference,
      createdAt: new Date(record.createdAt)
    });
  }

  async balance(ownerUserId: string): Promise<number> {
    const rows = await this.db
      .select({ amount: creditTransactions.amount })
      .from(creditTransactions)
      .where(eq(creditTransactions.ownerUserId, ownerUserId));
    return rows.reduce((sum, row) => sum + row.amount, 0);
  }
}

export class DrizzleOrderRepository implements OrderRepository {
  constructor(private readonly db: AppDatabase) {}

  async insert(record: OrderRecord, ownerUserId: string): Promise<void> {
    await this.db.insert(orders).values({
      id: record.id,
      ownerUserId,
      packageId: record.packageId,
      credits: record.credits,
      amountCents: record.amountCents,
      currency: record.currency,
      status: record.status,
      checkoutRef: record.checkoutRef,
      createdAt: new Date(record.createdAt)
    });
  }

  async listByOwner(ownerUserId: string): Promise<OrderRecord[]> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.ownerUserId, ownerUserId))
      .orderBy(orders.createdAt);
    return rows.map(mapOrderRow);
  }

  async listAll(): Promise<OrderRecord[]> {
    const rows = await this.db.select().from(orders).orderBy(orders.createdAt);
    return rows.map(mapOrderRow);
  }

  async get(ownerUserId: string, id: string): Promise<OrderRecord | null> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.ownerUserId, ownerUserId), eq(orders.id, id)))
      .limit(1);
    return rows[0] ? mapOrderRow(rows[0]) : null;
  }

  async getByCheckoutRef(checkoutRef: string): Promise<{ record: OrderRecord; ownerUserId: string } | null> {
    const rows = await this.db.select().from(orders).where(eq(orders.checkoutRef, checkoutRef)).limit(1);
    const row = rows[0];
    return row ? { record: mapOrderRow(row), ownerUserId: row.ownerUserId } : null;
  }

  async updateStatus(id: string, status: OrderStatus, paidAt?: string): Promise<void> {
    await this.db
      .update(orders)
      .set({ status, ...(paidAt !== undefined ? { paidAt: new Date(paidAt) } : {}) })
      .where(eq(orders.id, id));
  }
}
