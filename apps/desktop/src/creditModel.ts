import type { CreditAmount } from "@gw-link-omniai/shared";

export function formatCreditBalance(balance: CreditAmount): string {
  return `积分：${balance.credits}`;
}
