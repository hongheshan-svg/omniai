import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig, type ApiConfig } from "./config";
import { registerAuthRoutes } from "./routes/auth";
import { registerAssetRoutes } from "./routes/assets";
import { registerGenerationRoutes } from "./routes/generations";
import { registerCreditRoutes } from "./routes/credits";
import { registerFileRoutes } from "./routes/files";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { registerPromptRoutes } from "./routes/prompt";
import { InMemoryAssetService, type AssetService } from "./services/assetService";
import { InMemoryAuthService, type AuthService } from "./services/authService";
import { createServices } from "./services/appServices";
import { CompositeProviderAdapter } from "./services/compositeProviderAdapter";
import { InMemoryCreditService, type CreditService } from "./services/creditService";
import { type ProviderAdapter } from "./services/gatewayClient";
import { OpenAiCompatibleImageProvider } from "./services/openAiImageProvider";
import { OpenAiCompatibleTextProvider } from "./services/openAiTextProvider";
import { InMemoryObjectStore, type ObjectStore } from "./services/objectStore";
import { InMemoryGenerationService, type GenerationService } from "./services/generationService";
import { ConfigModelCatalog, type ModelCatalog } from "./services/modelCatalog";
import { loadModelCatalogConfig, resolveConfigPath } from "./services/modelConfig";
import { LocalPromptOptimizer, type PromptOptimizer } from "./services/promptOptimizer";

export interface BuildServerOptions {
  assetService?: AssetService;
  authService?: AuthService;
  config?: ApiConfig;
  creditService?: CreditService;
  generationService?: GenerationService;
  modelCatalog?: ModelCatalog;
  objectStore?: ObjectStore;
  promptOptimizer?: PromptOptimizer;
  providerAdapter?: ProviderAdapter;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: false
  });

  server.register(cors, {
    origin: options.config?.corsOrigins ?? true
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
  const creditService = options.creditService ?? new InMemoryCreditService();
  const authService =
    options.authService ??
    new InMemoryAuthService({
      devCodesEnabled: getConfig().authDevCodesEnabled,
      creditGranter: creditService
    });
  const promptOptimizer = options.promptOptimizer ?? new LocalPromptOptimizer();
  const objectStore = options.objectStore ?? new InMemoryObjectStore();
  const providerAdapter =
    options.providerAdapter ??
    new CompositeProviderAdapter({
      text: new OpenAiCompatibleTextProvider(),
      image: new OpenAiCompatibleImageProvider({ objectStore })
    });
  const generationService =
    options.generationService ??
    new InMemoryGenerationService({
      modelCatalog: getModelCatalog(),
      providerAdapter,
      creditService
    });

  registerHealthRoute(server);
  registerModelRoutes(server, {
    listVisibleModels: () => getModelCatalog().listVisibleModels(),
    getModelReference: (modelId, mode) => getModelCatalog().getModelReference(modelId, mode)
  });
  registerPromptRoutes(server, promptOptimizer);
  registerGenerationRoutes(server, generationService, authService);
  registerAssetRoutes(server, assetService, authService);
  registerCreditRoutes(server, creditService, authService);
  registerFileRoutes(server, objectStore);
  registerAuthRoutes(server, authService);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const services = createServices(config);

  try {
    await services.verifyConnectivity();
  } catch (error) {
    console.error("Database connectivity check failed", error);
    await services.closeDb();
    process.exit(1);
  }

  const server = buildServer({
    config,
    modelCatalog: services.modelCatalog,
    authService: services.authService,
    generationService: services.generationService,
    assetService: services.assetService,
    creditService: services.creditService
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down`);
    await server.close();
    await services.closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });

  console.log(`GW-LINK OmniAI API listening on ${config.port}`);
}
