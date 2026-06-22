export interface ApiConfig {
  port: number;
  gatewayBaseUrl: string;
  authDevCodesEnabled: boolean;
  modelConfigPath: string;
  initialCredits: number;
  publicBaseUrl: string;
  devTopupEnabled: boolean;
  objectStoreDir?: string;
  databaseUrl?: string;
  corsOrigins?: string[];
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

function parseDevTopupEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.GW_LINK_DEV_TOPUP_ENABLED;

  if (value === undefined) {
    return env.NODE_ENV === "production" ? false : true;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error('GW_LINK_DEV_TOPUP_ENABLED must be "true" or "false"');
}

function parseInitialCredits(value: string | undefined): number {
  if (value === undefined) {
    return 100;
  }

  const credits = Number(value);

  if (!Number.isInteger(credits) || credits < 0) {
    throw new Error("GW_LINK_INITIAL_CREDITS must be a non-negative integer");
  }

  return credits;
}

function parseCorsOrigins(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = parsePort(env.PORT);
  return {
    port,
    gatewayBaseUrl: env.GW_LINK_GATEWAY_BASE_URL ?? "https://gateway.gw-link.local",
    authDevCodesEnabled: parseAuthDevCodesEnabled(env),
    modelConfigPath: env.GW_LINK_MODEL_CONFIG_PATH ?? "config/models.json",
    initialCredits: parseInitialCredits(env.GW_LINK_INITIAL_CREDITS),
    publicBaseUrl: env.GW_LINK_PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    devTopupEnabled: parseDevTopupEnabled(env),
    objectStoreDir: env.GW_LINK_OBJECT_STORE_DIR,
    databaseUrl: env.DATABASE_URL,
    corsOrigins: parseCorsOrigins(env.GW_LINK_CORS_ORIGINS)
  };
}
