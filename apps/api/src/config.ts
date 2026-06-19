export interface ApiConfig {
  port: number;
  gatewayBaseUrl: string;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 8787;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: parsePort(env.PORT),
    gatewayBaseUrl: env.GW_LINK_GATEWAY_BASE_URL ?? "https://gateway.gw-link.local"
  };
}
