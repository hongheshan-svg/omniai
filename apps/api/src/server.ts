import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import Fastify from "fastify";
import { loadConfig, type ApiConfig } from "./config";
import { registerAuthRoutes } from "./routes/auth";
import { registerAssetRoutes } from "./routes/assets";
import { registerGenerationRoutes } from "./routes/generations";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { registerPromptRoutes } from "./routes/prompt";
import { InMemoryAssetService, type AssetService } from "./services/assetService";
import { InMemoryAuthService, type AuthService } from "./services/authService";
import { FakeProviderAdapter, type ProviderAdapter } from "./services/gatewayClient";
import { InMemoryGenerationService, type GenerationService } from "./services/generationService";
import { ConfigModelCatalog, type ModelCatalog } from "./services/modelCatalog";
import { loadModelCatalogConfig } from "./services/modelConfig";
import { LocalPromptOptimizer, type PromptOptimizer } from "./services/promptOptimizer";

export interface BuildServerOptions {
  assetService?: AssetService;
  authService?: AuthService;
  config?: ApiConfig;
  generationService?: GenerationService;
  modelCatalog?: ModelCatalog;
  promptOptimizer?: PromptOptimizer;
  providerAdapter?: ProviderAdapter;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: false
  });
  let loadedConfig = options.config;
  function getConfig() {
    loadedConfig ??= loadConfig();
    return loadedConfig;
  }

  let loadedModelCatalog = options.modelCatalog;
  function getModelCatalog() {
    loadedModelCatalog ??= new ConfigModelCatalog(
      loadModelCatalogConfig(resolveConfigPath(getConfig().modelConfigPath))
    );
    return loadedModelCatalog;
  }

  const assetService = options.assetService ?? new InMemoryAssetService();
  const authService =
    options.authService ??
    new InMemoryAuthService({
      devCodesEnabled: getConfig().authDevCodesEnabled
    });
  const promptOptimizer = options.promptOptimizer ?? new LocalPromptOptimizer();
  const providerAdapter = options.providerAdapter ?? new FakeProviderAdapter();
  const generationService =
    options.generationService ??
    new InMemoryGenerationService({
      modelCatalog: getModelCatalog(),
      providerAdapter
    });

  registerHealthRoute(server);
  registerModelRoutes(server, {
    listVisibleModels: () => getModelCatalog().listVisibleModels(),
    getModelReference: (modelId, mode) => getModelCatalog().getModelReference(modelId, mode)
  });
  registerPromptRoutes(server, promptOptimizer);
  registerGenerationRoutes(server, generationService);
  registerAssetRoutes(server, assetService);
  registerAuthRoutes(server, authService);

  return server;
}

function resolveConfigPath(configPath: string): string {
  if (isAbsolute(configPath) || existsSync(configPath)) {
    return configPath;
  }

  let currentDirectory = process.cwd();

  while (true) {
    const candidate = join(currentDirectory, configPath);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return configPath;
    }

    currentDirectory = parentDirectory;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const server = buildServer({ config });

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });

  console.log(`GW-LINK OmniAI API listening on ${config.port}`);
}
