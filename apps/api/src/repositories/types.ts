import type {
  CreationAsset,
  GenerationTask,
  LoginChannel,
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
  insert(task: GenerationTask, ownerUserId: string): Promise<void>;
  list(ownerUserId: string): Promise<GenerationTask[]>;
}

export interface AssetRepository {
  insert(asset: CreationAsset, ownerUserId: string): Promise<void>;
  list(ownerUserId: string): Promise<CreationAsset[]>;
}
