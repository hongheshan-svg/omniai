import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, Order } from "@gw-link-omniai/shared";
import { OrdersSection } from "../OrdersSection";

const orders: Order[] = [
  { id: "order_1", packageId: "credits-100", credits: 100, amountCents: 990, currency: "CNY", status: "paid", checkoutRef: "chk_1", createdAt: "2026-07-04T00:00:00.000Z", paidAt: "2026-07-04T00:05:00.000Z" },
  { id: "order_2", packageId: "credits-500", credits: 500, amountCents: 4500, currency: "CNY", status: "pending", checkoutRef: "chk_2", createdAt: "2026-07-04T01:00:00.000Z" }
];

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return { listAllOrders: async () => orders, ...overrides } as unknown as ApiClient;
}

describe("OrdersSection", () => {
  it("renders the orders summary and table", async () => {
    render(<OrdersSection client={fakeClient()} token="t" />);
    expect(await screen.findByText("order_1")).toBeTruthy();
    const summary = screen.getByLabelText("订单概览");
    expect(within(summary).getByText("总数：2")).toBeTruthy();
    expect(within(summary).getByText("已付：1")).toBeTruthy();
    expect(within(summary).getByText("待付：1")).toBeTruthy();
    expect(within(summary).getByText("营收：¥9.90")).toBeTruthy();
    expect(within(summary).getByText("售出积分：100")).toBeTruthy();
  });

  it("shows an error when loading fails", async () => {
    const client = fakeClient({ listAllOrders: async () => { throw new Error("boom"); } });
    render(<OrdersSection client={client} token="t" />);
    expect(await screen.findByText("订单加载失败，请稍后重试")).toBeTruthy();
  });

  it("shows a login prompt and never fetches when there is no token", async () => {
    const listAllOrders = vi.fn(async () => orders);
    const client = fakeClient({ listAllOrders });
    render(<OrdersSection client={client} />);
    expect(await screen.findByText("请先登录")).toBeTruthy();
    expect(listAllOrders).not.toHaveBeenCalled();
  });
});
