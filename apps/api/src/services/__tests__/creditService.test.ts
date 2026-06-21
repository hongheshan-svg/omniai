import { describe, expect, it } from "vitest";
import { InMemoryCreditService } from "../creditService";

function createService(initialCredits = 100) {
  let counter = 0;
  return new InMemoryCreditService({
    initialCredits,
    idGenerator: () => `credit_transaction_${(counter += 1)}`,
    clock: { now: () => new Date("2026-06-20T00:00:00.000Z") }
  });
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
});
