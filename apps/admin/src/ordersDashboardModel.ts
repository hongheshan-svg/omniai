import type { Order } from "@gw-link-omniai/shared";

export interface OrderDashboardSummary {
  total: number;
  paid: number;
  pending: number;
  failed: number;
  revenueCents: number;
  creditsSold: number;
}

export function summarizeOrders(orders: Order[]): OrderDashboardSummary {
  const summary: OrderDashboardSummary = { total: orders.length, paid: 0, pending: 0, failed: 0, revenueCents: 0, creditsSold: 0 };
  for (const order of orders) {
    if (order.status === "paid") {
      summary.paid += 1;
      summary.revenueCents += order.amountCents;
      summary.creditsSold += order.credits;
    } else if (order.status === "pending") {
      summary.pending += 1;
    } else if (order.status === "failed") {
      summary.failed += 1;
    }
  }
  return summary;
}
