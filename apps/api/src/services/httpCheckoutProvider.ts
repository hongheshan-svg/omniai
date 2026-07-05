import type { PaymentProviderDefinition } from "./paymentProviderConfig";
import { PaymentProviderError, type PaymentCheckoutRequest, type PaymentCheckoutResult, type PaymentProvider } from "./paymentProvider";

export interface HttpCheckoutProviderOptions {
  definition: PaymentProviderDefinition;
  publicBaseUrl: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export class HttpCheckoutProvider implements PaymentProvider {
  private readonly definition: PaymentProviderDefinition;
  private readonly publicBaseUrl: string;
  private readonly env: Record<string, string | undefined>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpCheckoutProviderOptions) {
    this.definition = options.definition;
    this.publicBaseUrl = options.publicBaseUrl;
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async createCheckout(request: PaymentCheckoutRequest): Promise<PaymentCheckoutResult> {
    const apiKey = this.env[this.definition.apiKeyEnv];
    if (!apiKey) {
      const base = this.publicBaseUrl.replace(/\/$/, "");
      return { checkoutUrl: `${base}/checkout/mock?ref=${request.checkoutRef}`, providerRef: request.checkoutRef };
    }
    const url = `${this.definition.baseUrl.replace(/\/$/, "")}/checkout/sessions`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          reference: request.checkoutRef,
          amountCents: request.amountCents,
          currency: request.currency,
          packageId: request.packageId
        })
      });
    } catch {
      throw new PaymentProviderError("Checkout provider request failed", 502);
    }
    if (!response.ok) {
      throw new PaymentProviderError(`Checkout provider returned ${response.status}`, 502);
    }
    let payload: { url?: unknown; id?: unknown };
    try {
      payload = (await response.json()) as { url?: unknown; id?: unknown };
    } catch {
      throw new PaymentProviderError("Checkout provider returned invalid JSON", 502);
    }
    if (typeof payload.url !== "string" || typeof payload.id !== "string") {
      throw new PaymentProviderError("Checkout provider returned an unexpected shape", 502);
    }
    return { checkoutUrl: payload.url, providerRef: payload.id };
  }
}
