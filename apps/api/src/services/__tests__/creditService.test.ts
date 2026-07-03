import { describe, expect, it } from "vitest";
import type { CreditTransactionRecord, CreditTransactionRepository } from "../../repositories/types";
import { CreditServiceImpl, InMemoryCreditService } from "../creditService";

function createService(initialCredits = 100) {
  let counter = 0;
  return new InMemoryCreditService({
    initialCredits,
    idGenerator: () => `credit_transaction_${(counter += 1)}`,
    clock: { now: () => new Date("2026-06-20T00:00:00.000Z") }
  });
}

class RecordingCreditTransactionRepository implements CreditTransactionRepository {
  readonly inserted: CreditTransactionRecord[] = [];

  async insert(record: CreditTransactionRecord): Promise<void> {
    this.inserted.push(record);
  }

  async balance(): Promise<number> {
    return this.inserted.reduce((sum, record) => sum + record.amount, 0);
  }
}

function createServiceWithRecorder() {
  const repository = new RecordingCreditTransactionRepository();
  let counter = 0;
  const service = new CreditServiceImpl(repository, {
    idGenerator: () => `credit_transaction_${(counter += 1)}`,
    clock: { now: () => new Date("2026-06-20T00:00:00.000Z") }
  });
  return { service, repository };
}

describe("InMemoryCreditService", () => {
  it("starts at a zero balance", async () => {
    expect(await createService().getBalance("user-a")).toEqual({ credits: 0, unit: "credit" });
  });

  it("grants the initial credits once", async () => {
    const service = createService(100);
    await service.grantInitial("user-a");
    expect(await service.getBalance("user-a")).toEqual({ credits: 100, unit: "credit" });
  });

  it("deducts from the balance", async () => {
    const service = createService(100);
    await service.grantInitial("user-a");
    await service.deduct("user-a", 2, "generation_task_1");
    expect((await service.getBalance("user-a")).credits).toBe(98);
  });

  it("scopes balances to each user", async () => {
    const service = createService(100);
    await service.grantInitial("user-a");
    expect((await service.getBalance("user-b")).credits).toBe(0);
  });

  it("skips the grant when initial credits is zero", async () => {
    const service = createService(0);
    await service.grantInitial("user-a");
    expect((await service.getBalance("user-a")).credits).toBe(0);
  });

  it("tops up the balance", async () => {
    const service = createService(100);
    await service.grantInitial("user-a");
    await service.topUp("user-a", 50);
    expect((await service.getBalance("user-a")).credits).toBe(150);
  });

  it("sums multiple top-ups and deductions", async () => {
    const service = createService(0);
    await service.topUp("user-a", 100);
    await service.topUp("user-a", 25);
    await service.deduct("user-a", 10, "task-1");
    expect((await service.getBalance("user-a")).credits).toBe(115);
  });

  it("records a purchase-reason top-up", async () => {
    const { service, repository } = createServiceWithRecorder();
    await service.topUp("user-a", 100, "order_1", "purchase");
    expect(repository.inserted.at(-1)).toMatchObject({ amount: 100, reason: "purchase", reference: "order_1" });
  });

  it("defaults the top-up reason to topup when omitted", async () => {
    const { service, repository } = createServiceWithRecorder();
    await service.topUp("user-a", 50);
    expect(repository.inserted.at(-1)).toMatchObject({ amount: 50, reason: "topup", reference: null });
  });
});
