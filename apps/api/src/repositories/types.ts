import type {
  CreationAsset,
  GenerationTask,
  LoginChannel,
  OrderStatus,
  UserProfile
} from "@gw-link-omniai/shared";

export interface SessionRecord {
  token: string;
  userId: string;
  expiresAtMs: number;
}

export interface LoginChallengeRecord {
  id: string;
  destination: string;
  channel: LoginChannel;
  codeHash: string;
  expiresAtMs: number;
  failedAttempts: number;
}

export interface UserRepository {
  findBySubject(channel: LoginChannel, destination: string): Promise<UserProfile | undefined>;
  findById(id: string): Promise<UserProfile | undefined>;
  insert(user: UserProfile): Promise<void>;
}

export interface SessionRepository {
  save(session: SessionRecord): Promise<void>;
  findByToken(token: string): Promise<SessionRecord | undefined>;
  delete(token: string): Promise<boolean>;
  deleteExpired(nowMs: number): Promise<void>;
}

export interface ChallengeRepository {
  save(challenge: LoginChallengeRecord): Promise<void>;
  findById(id: string): Promise<LoginChallengeRecord | undefined>;
  update(challenge: LoginChallengeRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteExpired(nowMs: number): Promise<void>;
}

export interface GenerationTaskRepository {
  insert(task: GenerationTask, ownerUserId: string, providerRef?: string | null): Promise<void>;
  list(ownerUserId: string): Promise<GenerationTask[]>;
  get(
    ownerUserId: string,
    id: string
  ): Promise<{ task: GenerationTask; providerRef: string | null } | undefined>;
  update(task: GenerationTask, ownerUserId: string, providerRef?: string | null): Promise<void>;
}

export interface AssetRepository {
  insert(asset: CreationAsset, ownerUserId: string): Promise<void>;
  list(ownerUserId: string): Promise<CreationAsset[]>;
}

export interface CreditTransactionRecord {
  id: string;
  amount: number;
  reason: string;
  reference: string | null;
  createdAt: string;
}

export interface CreditTransactionRepository {
  insert(record: CreditTransactionRecord, ownerUserId: string): Promise<void>;
  balance(ownerUserId: string): Promise<number>;
}

export interface OrderRecord {
  id: string;
  packageId: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  checkoutRef: string;
  createdAt: string;
}

export interface OrderRepository {
  insert(record: OrderRecord, ownerUserId: string): Promise<void> | void;
  listByOwner(ownerUserId: string): Promise<OrderRecord[]> | OrderRecord[];
  get(ownerUserId: string, id: string): Promise<OrderRecord | null> | OrderRecord | null;
  getByCheckoutRef(
    checkoutRef: string
  ): Promise<{ record: OrderRecord; ownerUserId: string } | null> | { record: OrderRecord; ownerUserId: string } | null;
  updateStatus(id: string, status: OrderStatus): Promise<void> | void;
}
