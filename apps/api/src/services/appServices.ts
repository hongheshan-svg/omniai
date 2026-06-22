import { randomUUID } from "node:crypto";
import type { ApiConfig } from "../config";
import { createDbClient, type AppDatabase } from "../db/client";
import {
  DrizzleAssetRepository,
  DrizzleChallengeRepository,
  DrizzleCreditTransactionRepository,
  DrizzleGenerationTaskRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository
} from "../repositories/drizzle";
import { AssetServiceImpl, InMemoryAssetService, type AssetService } from "./assetService";
import { AuthServiceImpl, InMemoryAuthService, type AuthService } from "./authService";
import { CompositeProviderAdapter } from "./compositeProviderAdapter";
import { CreditServiceImpl, InMemoryCreditService, type CreditService } from "./creditService";
import { OpenAiCompatibleImageProvider } from "./openAiImageProvider";
import {
  GenerationServiceImpl,
  InMemoryGenerationService,
  type GenerationService
} from "./generationService";
import type { ProviderAdapter } from "./gatewayClient";
import { ConfigModelCatalog, type ModelCatalog } from "./modelCatalog";
import { loadModelCatalogConfig, resolveConfigPath } from "./modelConfig";
import { OpenAiCompatibleTextProvider } from "./openAiTextProvider";

export interface AppServices {
  authService: AuthService;
  generationService: GenerationService;
  assetService: AssetService;
  creditService: CreditService;
  modelCatalog: ModelCatalog;
  verifyConnectivity(): Promise<void>;
  closeDb(): Promise<void>;
}

export function createDbServices(
  db: AppDatabase,
  modelCatalog: ModelCatalog,
  options: { authDevCodesEnabled: boolean; initialCredits: number; providerAdapter?: ProviderAdapter }
): {
  authService: AuthService;
  generationService: GenerationService;
  assetService: AssetService;
  creditService: CreditService;
} {
  const creditService = new CreditServiceImpl(new DrizzleCreditTransactionRepository(db), {
    initialCredits: options.initialCredits,
    idGenerator: () => `credit_transaction_${randomUUID()}`
  });

  const authService = new AuthServiceImpl(
    {
      users: new DrizzleUserRepository(db),
      sessions: new DrizzleSessionRepository(db),
      challenges: new DrizzleChallengeRepository(db)
    },
    { devCodesEnabled: options.authDevCodesEnabled, creditGranter: creditService }
  );

  const generationService = new GenerationServiceImpl(new DrizzleGenerationTaskRepository(db), {
    modelCatalog,
    idGenerator: () => `generation_task_${randomUUID()}`,
    providerAdapter:
      options.providerAdapter ??
      new CompositeProviderAdapter({
        text: new OpenAiCompatibleTextProvider(),
        image: new OpenAiCompatibleImageProvider()
      }),
    creditService
  });

  const assetService = new AssetServiceImpl(new DrizzleAssetRepository(db), {
    idGenerator: () => `creation_asset_${randomUUID()}`
  });

  return { authService, generationService, assetService, creditService };
}

export function createServices(config: ApiConfig): AppServices {
  const modelCatalog = new ConfigModelCatalog(
    loadModelCatalogConfig(resolveConfigPath(config.modelConfigPath))
  );

  if (!config.databaseUrl) {
    const creditService = new InMemoryCreditService({ initialCredits: config.initialCredits });
    return {
      authService: new InMemoryAuthService({
        devCodesEnabled: config.authDevCodesEnabled,
        creditGranter: creditService
      }),
      generationService: new InMemoryGenerationService({
        modelCatalog,
        providerAdapter: new CompositeProviderAdapter({
          text: new OpenAiCompatibleTextProvider(),
          image: new OpenAiCompatibleImageProvider()
        }),
        creditService
      }),
      assetService: new InMemoryAssetService(),
      creditService,
      modelCatalog,
      async verifyConnectivity() {},
      async closeDb() {}
    };
  }

  const client = createDbClient(config.databaseUrl);
  const services = createDbServices(client.db, modelCatalog, {
    authDevCodesEnabled: config.authDevCodesEnabled,
    initialCredits: config.initialCredits
  });

  return {
    ...services,
    modelCatalog,
    verifyConnectivity: () => client.verifyConnectivity(),
    closeDb: () => client.close()
  };
}
