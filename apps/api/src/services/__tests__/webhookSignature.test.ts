import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "../webhookSignature";

const secret = "whsec_test";
const body = JSON.stringify({ type: "payment.succeeded", checkoutRef: "checkout_1" });

describe("webhook signature", () => {
  it("verifies a signature it produced", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body + " ", sig, secret)).toBe(false);
  });
  it("rejects a wrong secret", () => {
    const sig = signWebhookPayload(body, secret);
    expect(verifyWebhookSignature(body, sig, "whsec_other")).toBe(false);
  });
  it("rejects a missing or malformed signature without throwing", () => {
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, "not-hex-short", secret)).toBe(false);
  });
});
