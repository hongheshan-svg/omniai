export interface PaymentCheckoutRequest {
  checkoutRef: string;
  amountCents: number;
  currency: string;
  packageId: string;
}

export interface PaymentCheckoutResult {
  checkoutUrl: string;
  providerRef: string;
}

export interface PaymentProvider {
  createCheckout(request: PaymentCheckoutRequest): Promise<PaymentCheckoutResult>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
