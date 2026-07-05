import type { PaymentCheckoutRequest, PaymentCheckoutResult, PaymentProvider } from "./paymentProvider";

export class FakeCheckoutProvider implements PaymentProvider {
  constructor(private readonly publicBaseUrl: string) {}

  async createCheckout(request: PaymentCheckoutRequest): Promise<PaymentCheckoutResult> {
    const base = this.publicBaseUrl.replace(/\/$/, "");
    return { checkoutUrl: `${base}/checkout/mock?ref=${request.checkoutRef}`, providerRef: request.checkoutRef };
  }
}
