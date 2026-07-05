import type { PaymentProvidersConfig } from "./paymentProviderConfig";
import type { PaymentProvider } from "./paymentProvider";
import { FakeCheckoutProvider } from "./fakeCheckoutProvider";
import { HttpCheckoutProvider } from "./httpCheckoutProvider";

export function resolvePaymentProvider(
  config: PaymentProvidersConfig,
  options: { env?: Record<string, string | undefined>; publicBaseUrl: string; fetch?: typeof fetch; activeProviderOverride?: string }
): PaymentProvider {
  const activeId = options.activeProviderOverride ?? config.activeProvider;
  const definition = config.providers.find((p) => p.id === activeId);
  if (!definition) {
    throw new Error(`Unknown payment provider: ${activeId}`);
  }
  if (definition.protocol === "mock") {
    return new FakeCheckoutProvider(options.publicBaseUrl);
  }
  return new HttpCheckoutProvider({ definition, publicBaseUrl: options.publicBaseUrl, env: options.env, fetch: options.fetch });
}
