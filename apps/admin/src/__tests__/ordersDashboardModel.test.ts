import { describe, expect, it } from "vitest";
import type { Order } from "@gw-link-omniai/shared";
import { summarizeOrders } from "../ordersDashboardModel";

function order(overrides: Partial<Order>): Order {
  return {
    id: "o",
    packageId: "credits-100",
    credits: 100,
    amountCents: 990,
    currency: "CNY",
    status: "pending",
    checkoutRef: "chk",
    createdAt: "2026-07-04T00:00:00.000Z",
    ...overrides
  };
}

describe("summarizeOrders", () => {
  it("returns zeros for no orders", () => {
    expect(summarizeOrders([])).toEqual({ total: 0, paid: 0, pending: 0, failed: 0, revenueCents: 0, creditsSold: 0 });
  });

  it("counts statuses and sums revenue/credits from paid orders only", () => {
    const orders: Order[] = [
      order({ id: "a", status: "paid", amountCents: 990, credits: 100 }),
      order({ id: "b", status: "paid", amountCents: 4500, credits: 500 }),
      order({ id: "c", status: "pending" }),
      order({ id: "d", status: "failed" })
    ];
    expect(summarizeOrders(orders)).toEqual({ total: 4, paid: 2, pending: 1, failed: 1, revenueCents: 5490, creditsSold: 600 });
  });
});
