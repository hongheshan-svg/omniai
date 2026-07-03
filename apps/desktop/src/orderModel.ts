import type { CreditPackage, Order, OrderStatus } from "@gw-link-omniai/shared";

export function formatMoney(amountCents: number, currency: string): string {
  const amount = (amountCents / 100).toFixed(2);
  return currency === "CNY" ? `¥${amount}` : `${amount} ${currency}`;
}

export function formatPackagePrice(pkg: CreditPackage): string {
  return formatMoney(pkg.amountCents, pkg.currency);
}

const orderStatusLabels: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付",
  failed: "支付失败"
};

export function getOrderStatusLabel(status: OrderStatus): string {
  return orderStatusLabels[status];
}

export function formatDateTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export function buildReceiptLines(order: Order, packageName: string): Array<{ label: string; value: string }> {
  return [
    { label: "收据编号", value: order.id },
    { label: "日期", value: order.paidAt ? formatDateTime(order.paidAt) : "—" },
    { label: "项目", value: packageName },
    { label: "积分", value: `${order.credits}` },
    { label: "金额", value: formatMoney(order.amountCents, order.currency) },
    { label: "状态", value: "已支付" }
  ];
}
