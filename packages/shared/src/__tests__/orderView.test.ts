import { describe, expect, it } from "vitest";
import type { Order } from "@gw-link-omniai/shared";
import {
  buildReceiptLines,
  formatDateTime,
  formatMoney,
  formatPackagePrice,
  getOrderStatusLabel
} from "../orderView";

describe("orderView", () => {
  it("formats money by currency", () => {
    expect(formatMoney(990, "CNY")).toBe("¥9.90");
    expect(formatMoney(4500, "CNY")).toBe("¥45.00");
    expect(formatMoney(1000, "USD")).toBe("10.00 USD");
  });

  it("formats a package price via formatMoney", () => {
    expect(formatPackagePrice({ id: "p", displayName: "P", credits: 100, amountCents: 990, currency: "CNY" })).toBe("¥9.90");
  });

  it("labels order status", () => {
    expect(getOrderStatusLabel("pending")).toBe("待支付");
    expect(getOrderStatusLabel("paid")).toBe("已支付");
    expect(getOrderStatusLabel("failed")).toBe("支付失败");
  });

  it("formats an ISO timestamp to minute precision", () => {
    expect(formatDateTime("2026-07-03T21:19:05.000Z")).toBe("2026-07-03 21:19");
  });

  it("builds receipt lines for a paid order", () => {
    const order: Order = {
      id: "order_1",
      packageId: "credits-100",
      credits: 100,
      amountCents: 990,
      currency: "CNY",
      status: "paid",
      checkoutRef: "checkout_1",
      createdAt: "2026-07-03T00:00:00.000Z",
      paidAt: "2026-07-03T02:30:00.000Z"
    };
    expect(buildReceiptLines(order, "100 积分")).toEqual([
      { label: "收据编号", value: "order_1" },
      { label: "日期", value: "2026-07-03 02:30" },
      { label: "项目", value: "100 积分" },
      { label: "积分", value: "100" },
      { label: "金额", value: "¥9.90" },
      { label: "状态", value: "已支付" }
    ]);
  });
});
