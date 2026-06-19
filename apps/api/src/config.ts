export interface ApiConfig {
  port: number;
  gatewayBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: Number(env.PORT ?? 8787),
    gatewayBaseUrl: env.GW_LINK_GATEWAY_BASE_URL ?? "https://gateway.gw-link.local"
  };
}
