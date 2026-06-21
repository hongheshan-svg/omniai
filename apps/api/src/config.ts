export interface ApiConfig {
  port: number;
  gatewayBaseUrl: string;
  authDevCodesEnabled: boolean;
  modelConfigPath: string;
  databaseUrl?: string;
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

function parseAuthDevCodesEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.GW_LINK_AUTH_DEV_CODES_ENABLED;

  if (value === undefined) {
    return env.NODE_ENV === "production" ? false : true;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error('GW_LINK_AUTH_DEV_CODES_ENABLED must be "true" or "false"');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: parsePort(env.PORT),
    gatewayBaseUrl: env.GW_LINK_GATEWAY_BASE_URL ?? "https://gateway.gw-link.local",
    authDevCodesEnabled: parseAuthDevCodesEnabled(env),
    modelConfigPath: env.GW_LINK_MODEL_CONFIG_PATH ?? "config/models.json",
    databaseUrl: env.DATABASE_URL
  };
}
