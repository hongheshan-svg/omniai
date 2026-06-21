import { randomUUID } from "node:crypto";
import type { ApiConfig } from "../config";
import { createDbClient, type AppDatabase } from "../db/client";
import {
  DrizzleAssetRepository,
  DrizzleChallengeRepository,
  DrizzleGenerationTaskRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository
} from "../repositories/drizzle";
import { AssetServiceImpl, InMemoryAssetService, type AssetService } from "./assetService";
import { AuthServiceImpl, InMemoryAuthService, type AuthService } from "./authService";
import {
  GenerationServiceImpl,
  InMemoryGenerationService,
  type GenerationService
} from "./generationService";
import { ConfigModelCatalog, type ModelCatalog } from "./modelCatalog";
import { loadModelCatalogConfig, resolveConfigPath } from "./modelConfig";
import { OpenAiCompatibleTextProvider } from "./openAiTextProvider";

export interface AppServices {
  authService: AuthService;
  generationService: GenerationService;
  assetService: AssetService;
  modelCatalog: ModelCatalog;
  verifyConnectivity(): Promise<void>;
  closeDb(): Promise<void>;
}

export function createDbServices(
  db: AppDatabase,
  modelCatalog: ModelCatalog,
  options: { authDevCodesEnabled: boolean }
): { authService: AuthService; generationService: GenerationService; assetService: AssetService } {
  const authService = new AuthServiceImpl(
    {
      users: new DrizzleUserRepository(db),
      sessions: new DrizzleSessionRepository(db),
      challenges: new DrizzleChallengeRepository(db)
    },
    { devCodesEnabled: options.authDevCodesEnabled }
  );

  const generationService = new GenerationServiceImpl(new DrizzleGenerationTaskRepository(db), {
    modelCatalog,
    idGenerator: () => `generation_task_${randomUUID()}`,
    providerAdapter: new OpenAiCompatibleTextProvider()
  });

  const assetService = new AssetServiceImpl(new DrizzleAssetRepository(db), {
    idGenerator: () => `creation_asset_${randomUUID()}`
  });

  return { authService, generationService, assetService };
}

export function createServices(config: ApiConfig): AppServices {
  const modelCatalog = new ConfigModelCatalog(
    loadModelCatalogConfig(resolveConfigPath(config.modelConfigPath))
  );

  if (!config.databaseUrl) {
    return {
      authService: new InMemoryAuthService({ devCodesEnabled: config.authDevCodesEnabled }),
      generationService: new InMemoryGenerationService({ modelCatalog }),
      assetService: new InMemoryAssetService(),
      modelCatalog,
      async verifyConnectivity() {},
      async closeDb() {}
    };
  }

  const client = createDbClient(config.databaseUrl);
  const services = createDbServices(client.db, modelCatalog, {
    authDevCodesEnabled: config.authDevCodesEnabled
  });

  return {
    ...services,
    modelCatalog,
    verifyConnectivity: () => client.verifyConnectivity(),
    closeDb: () => client.close()
  };
}
