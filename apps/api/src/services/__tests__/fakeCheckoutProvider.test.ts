import { describe, expect, it } from "vitest";
import { FakeCheckoutProvider } from "../fakeCheckoutProvider";

describe("FakeCheckoutProvider", () => {
  it("returns a deterministic mock checkout URL keyed on the checkout reference", async () => {
    const provider = new FakeCheckoutProvider("https://app.test");

    const result = await provider.createCheckout({
      checkoutRef: "chk_1",
      amountCents: 990,
      currency: "CNY",
      packageId: "credits-100"
    });

    expect(result).toEqual({
      checkoutUrl: "https://app.test/checkout/mock?ref=chk_1",
      providerRef: "chk_1"
    });
  });

  it("strips a trailing slash from the public base URL", async () => {
    const provider = new FakeCheckoutProvider("https://app.test/");

    const result = await provider.createCheckout({
      checkoutRef: "chk_2",
      amountCents: 500,
      currency: "USD",
      packageId: "credits-50"
    });

    expect(result.checkoutUrl).toBe("https://app.test/checkout/mock?ref=chk_2");
  });
});
