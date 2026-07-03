import type { CreditPackage, OrderStatus } from "@gw-link-omniai/shared";

export function formatPackagePrice(pkg: CreditPackage): string {
  return `¥${(pkg.amountCents / 100).toFixed(2)}`;
}

const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  failed: "支付失败"
};

export function getOrderStatusLabel(status: OrderStatus): string {
  return orderStatusLabels[status];
}
