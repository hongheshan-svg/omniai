import { randomUUID } from "node:crypto";
import type { CreditAmount } from "@gw-link-omniai/shared";
import type { CreditTransactionRepository } from "../repositories/types";
import { InMemoryCreditTransactionRepository } from "../repositories/memory";

export const DEFAULT_INITIAL_CREDITS = 100;

export interface CreditServiceClock {
  now(): Date;
}

export interface CreditServiceOptions {
  initialCredits?: number;
  idGenerator?: () => string;
  clock?: CreditServiceClock;
}

export interface CreditService {
  getBalance(userId: string): Promise<CreditAmount>;
  grantInitial(userId: string): Promise<void>;
  deduct(userId: string, amount: number, reference: string): Promise<void>;
  topUp(userId: string, amount: number, reference?: string, reason?: string): Promise<void>;
}

export class CreditServiceImpl implements CreditService {
  private readonly initialCredits: number;
  private readonly idGenerator: () => string;
  private readonly clock: CreditServiceClock;
  private readonly transactions: CreditTransactionRepository;

  constructor(transactionRepository: CreditTransactionRepository, options: CreditServiceOptions = {}) {
    this.transactions = transactionRepository;
    this.initialCredits = options.initialCredits ?? DEFAULT_INITIAL_CREDITS;
    this.idGenerator = options.idGenerator ?? (() => `credit_transaction_${randomUUID()}`);
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async getBalance(userId: string): Promise<CreditAmount> {
    return { credits: await this.transactions.balance(userId), unit: "credit" };
  }

  async grantInitial(userId: string): Promise<void> {
    if (this.initialCredits <= 0) {
      return;
    }

    await this.transactions.insert(
      {
        id: this.idGenerator(),
        amount: this.initialCredits,
        reason: "signup_grant",
        reference: null,
        createdAt: this.clock.now().toISOString()
      },
      userId
    );
  }

  async deduct(userId: string, amount: number, reference: string): Promise<void> {
    await this.transactions.insert(
      {
        id: this.idGenerator(),
        amount: -amount,
        reason: "generation",
        reference,
        createdAt: this.clock.now().toISOString()
      },
      userId
    );
  }

  async topUp(userId: string, amount: number, reference?: string, reason?: string): Promise<void> {
    await this.transactions.insert(
      {
        id: this.idGenerator(),
        amount,
        reason: reason ?? "topup",
        reference: reference ?? null,
        createdAt: this.clock.now().toISOString()
      },
      userId
    );
  }
}

export class InMemoryCreditService extends CreditServiceImpl {
  constructor(options: CreditServiceOptions = {}) {
    super(new InMemoryCreditTransactionRepository(), options);
  }
}
