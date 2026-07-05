import { readFileSync } from "node:fs";

export interface PaymentProviderDefinition {
  id: string;
  displayName: string;
  protocol: string;
  baseUrl: string;
  apiKeyEnv: string;
  webhookSecretEnv?: string;
}
export interface PaymentProvidersConfig {
  activeProvider: string;
  providers: PaymentProviderDefinition[];
}

function isDefinition(value: unknown): value is PaymentProviderDefinition {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.displayName === "string" &&
    typeof v.protocol === "string" &&
    typeof v.baseUrl === "string" &&
    typeof v.apiKeyEnv === "string" &&
    (v.webhookSecretEnv === undefined || typeof v.webhookSecretEnv === "string")
  );
}

export function parsePaymentProvidersConfig(value: unknown): PaymentProvidersConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid payment-providers config: not an object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.activeProvider !== "string" || !Array.isArray(v.providers) || !v.providers.every(isDefinition)) {
    throw new Error("Invalid payment-providers config: bad shape");
  }
  return { activeProvider: v.activeProvider, providers: v.providers as PaymentProviderDefinition[] };
}

export function loadPaymentProvidersConfig(path: string): PaymentProvidersConfig {
  return parsePaymentProvidersConfig(JSON.parse(readFileSync(path, "utf8")));
}
