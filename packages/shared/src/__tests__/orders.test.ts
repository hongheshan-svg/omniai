import { describe, expect, it } from "vitest";
import { isCreateOrderRequest, isPaymentWebhookEvent } from "../orders";

describe("isCreateOrderRequest", () => {
  it("accepts a valid request", () => {
    expect(isCreateOrderRequest({ packageId: "credits-100" })).toBe(true);
  });
  it("rejects invalid shapes", () => {
    expect(isCreateOrderRequest({})).toBe(false);
    expect(isCreateOrderRequest({ packageId: 5 })).toBe(false);
    expect(isCreateOrderRequest(null)).toBe(false);
    expect(isCreateOrderRequest("x")).toBe(false);
  });
});

describe("isPaymentWebhookEvent", () => {
  it("accepts a valid event", () => {
    expect(isPaymentWebhookEvent({ type: "payment.succeeded", checkoutRef: "checkout_1" })).toBe(true);
  });
  it("rejects invalid shapes", () => {
    expect(isPaymentWebhookEvent({ type: "payment.succeeded" })).toBe(false);
    expect(isPaymentWebhookEvent({ checkoutRef: "x" })).toBe(false);
    expect(isPaymentWebhookEvent({ type: 1, checkoutRef: "x" })).toBe(false);
    expect(isPaymentWebhookEvent(null)).toBe(false);
  });
});
