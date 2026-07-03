import { isPaymentWebhookEvent } from "@gw-link-omniai/shared";
import type { OrderRepository } from "../repositories/types";
import type { CreditService } from "./creditService";
import { verifyWebhookSignature } from "./webhookSignature";

export class PaymentServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

export interface PaymentServiceOptions {
  secret?: string;
  clock?: { now(): Date };
}

export interface PaymentService {
  handleWebhookEvent(input: { rawBody: string; signature: string | undefined }): Promise<void>;
}

export class PaymentServiceImpl implements PaymentService {
  private readonly clock: { now(): Date };

  constructor(
    private readonly orders: OrderRepository,
    private readonly credits: CreditService,
    private readonly options: PaymentServiceOptions = {}
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async handleWebhookEvent(input: { rawBody: string; signature: string | undefined }): Promise<void> {
    const secret = this.options.secret;
    if (!secret) {
      throw new PaymentServiceError("Payment webhook not configured", 500);
    }
    if (!verifyWebhookSignature(input.rawBody, input.signature, secret)) {
      throw new PaymentServiceError("Invalid signature", 401);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      throw new PaymentServiceError("Invalid webhook payload", 400);
    }
    if (!isPaymentWebhookEvent(parsed)) {
      throw new PaymentServiceError("Invalid webhook payload", 400);
    }
    if (parsed.type !== "payment.succeeded") {
      return;
    }
    const found = await this.orders.getByCheckoutRef(parsed.checkoutRef);
    if (!found) {
      throw new PaymentServiceError("Order not found", 404);
    }
    if (found.record.status !== "pending") {
      return; // idempotent: already paid (or otherwise finalized) — do not re-credit
    }
    await this.orders.updateStatus(found.record.id, "paid", this.clock.now().toISOString());
    await this.credits.topUp(found.ownerUserId, found.record.credits, found.record.id, "purchase");
  }
}
