export interface CreditPackage {
  id: string;
  displayName: string;
  credits: number;
  amountCents: number;
  currency: string;
}

export type OrderStatus = "pending" | "paid" | "failed";

export interface Order {
  id: string;
  packageId: string;
  credits: number;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  checkoutRef: string;
  createdAt: string;
}

export interface CreateOrderRequest {
  packageId: string;
}

export function isCreateOrderRequest(value: unknown): value is CreateOrderRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { packageId?: unknown }).packageId === "string"
  );
}
