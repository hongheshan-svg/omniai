import { describe, expect, it, vi } from "vitest";
import { InMemoryOrderRepository } from "../../repositories/memory";
import type { CreditService } from "../creditService";
import { PaymentServiceImpl, PaymentServiceError } from "../paymentService";
import { signWebhookPayload } from "../webhookSignature";

const SECRET = "whsec_test";

function pendingOrder(repo: InMemoryOrderRepository) {
  repo.insert(
    { id: "order_1", packageId: "credits-100", credits: 100, amountCents: 990, currency: "CNY", status: "pending", checkoutRef: "checkout_1", createdAt: "2026-07-03T00:00:00.000Z" },
    "user-a"
  );
}

function fakeCredits() {
  const calls: Array<{ userId: string; amount: number; reference?: string; reason?: string }> = [];
  const service = {
    getBalance: async () => ({ credits: 0, unit: "credit" as const }),
    grantInitial: async () => {},
    deduct: async () => {},
    topUp: async (userId: string, amount: number, reference?: string, reason?: string) => {
      calls.push({ userId, amount, reference, reason });
    }
  } as unknown as CreditService;
  return { service, calls };
}

function event(checkoutRef = "checkout_1", type = "payment.succeeded") {
  return JSON.stringify({ type, checkoutRef });
}

describe("PaymentServiceImpl", () => {
  it("throws 500 when the secret is not configured", async () => {
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), fakeCredits().service, {});
    await expect(svc.handleWebhookEvent({ rawBody: event(), signature: "x" })).rejects.toMatchObject({ statusCode: 500 });
  });

  it("throws 401 on an invalid signature", async () => {
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), fakeCredits().service, { secret: SECRET });
    await expect(svc.handleWebhookEvent({ rawBody: event(), signature: "bad" })).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 400 on an invalid payload", async () => {
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), fakeCredits().service, { secret: SECRET });
    const raw = "not json";
    await expect(svc.handleWebhookEvent({ rawBody: raw, signature: signWebhookPayload(raw, SECRET) })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("ignores a non-succeeded event", async () => {
    const { service, calls } = fakeCredits();
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), service, { secret: SECRET });
    const raw = event("checkout_1", "payment.pending");
    await svc.handleWebhookEvent({ rawBody: raw, signature: signWebhookPayload(raw, SECRET) });
    expect(calls).toHaveLength(0);
  });

  it("throws 404 for an unknown order", async () => {
    const svc = new PaymentServiceImpl(new InMemoryOrderRepository(), fakeCredits().service, { secret: SECRET });
    const raw = event("missing");
    await expect(svc.handleWebhookEvent({ rawBody: raw, signature: signWebhookPayload(raw, SECRET) })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("marks the order paid and credits the owner", async () => {
    const repo = new InMemoryOrderRepository();
    pendingOrder(repo);
    const { service, calls } = fakeCredits();
    const svc = new PaymentServiceImpl(repo, service, { secret: SECRET });
    const raw = event();
    await svc.handleWebhookEvent({ rawBody: raw, signature: signWebhookPayload(raw, SECRET) });
    expect(repo.get("user-a", "order_1")?.status).toBe("paid");
    expect(calls).toEqual([{ userId: "user-a", amount: 100, reference: "order_1", reason: "purchase" }]);
  });

  it("is idempotent on redelivery (no double credit)", async () => {
    const repo = new InMemoryOrderRepository();
    pendingOrder(repo);
    const { service, calls } = fakeCredits();
    const svc = new PaymentServiceImpl(repo, service, { secret: SECRET });
    const raw = event();
    const sig = signWebhookPayload(raw, SECRET);
    await svc.handleWebhookEvent({ rawBody: raw, signature: sig });
    await svc.handleWebhookEvent({ rawBody: raw, signature: sig });
    expect(calls).toHaveLength(1);
  });

  it("stamps paidAt from the injected clock when marking an order paid", async () => {
    const orders = new InMemoryOrderRepository();
    pendingOrder(orders);
    const { service: credits } = fakeCredits();
    const fixed = new Date("2026-07-03T02:30:00.000Z");
    const payment = new PaymentServiceImpl(orders, credits, { secret: SECRET, clock: { now: () => fixed } });

    const rawBody = event();
    await payment.handleWebhookEvent({ rawBody, signature: signWebhookPayload(rawBody, SECRET) });

    const order = await orders.get("user-a", "order_1");
    expect(order?.status).toBe("paid");
    expect(order?.paidAt).toBe("2026-07-03T02:30:00.000Z");

    // Idempotent re-delivery does not overwrite paidAt.
    const later = new Date("2026-07-03T09:00:00.000Z");
    const payment2 = new PaymentServiceImpl(orders, credits, { secret: SECRET, clock: { now: () => later } });
    await payment2.handleWebhookEvent({ rawBody, signature: signWebhookPayload(rawBody, SECRET) });
    expect((await orders.get("user-a", "order_1"))?.paidAt).toBe("2026-07-03T02:30:00.000Z");
  });
});
