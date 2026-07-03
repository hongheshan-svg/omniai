import { describe, expect, it } from "vitest";
import { formatPackagePrice, getOrderStatusLabel } from "../orderModel";

describe("orderModel", () => {
  it("formats a package price", () => {
    expect(formatPackagePrice({ id: "p", displayName: "P", credits: 100, amountCents: 990, currency: "CNY" })).toBe("¥9.90");
    expect(formatPackagePrice({ id: "p", displayName: "P", credits: 500, amountCents: 4500, currency: "CNY" })).toBe("¥45.00");
  });
  it("labels order status", () => {
    expect(getOrderStatusLabel("pending")).toBe("待支付");
    expect(getOrderStatusLabel("paid")).toBe("已支付");
    expect(getOrderStatusLabel("failed")).toBe("支付失败");
  });
});
