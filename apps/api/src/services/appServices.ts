import { randomUUID } from "node:crypto";
import type { ApiConfig } from "../config";
import { createDbClient, type AppDatabase } from "../db/client";
import {
  DrizzleAssetRepository,
  DrizzleChallengeRepository,
  DrizzleCreditTransactionRepository,
  DrizzleGenerationTaskRepository,
  DrizzleOrderRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository
} from "../repositories/drizzle";
import { AssetServiceImpl, InMemoryAssetService, type AssetService } from "./assetService";
import { AuthServiceImpl, InMemoryAuthService, type AuthService } from "./authService";
import { AsyncVideoProvider } from "./asyncVideoProvider";
import { CompositeProviderAdapter } from "./compositeProviderAdapter";
import { CreditServiceImpl, InMemoryCreditService, type CreditService } from "./creditService";
import { OpenAiCompatibleImageProvider } from "./openAiImageProvider";
import { InMemoryObjectStore, LocalFileObjectStore, type ObjectStore } from "./objectStore";
import {
  GenerationServiceImpl,
  InMemoryGenerationService,
  type GenerationService
} from "./generationService";
import type { ProviderAdapter } from "./gatewayClient";
import { ConfigModelCatalog, type ModelCatalog } from "./modelCatalog";
import { loadModelCatalogConfig, resolveConfigPath } from "./modelConfig";
import { OpenAiCompatibleTextProvider } from "./openAiTextProvider";
import { OrderServiceImpl, type OrderService } from "./orderService";
import { ConfigPackageCatalog, loadPackageCatalogConfig, type PackageCatalog } from "./packageCatalog";
import { PaymentServiceImpl, type PaymentService } from "./paymentService";
import { InMemoryOrderRepository } from "../repositories/memory";

export interface AppServices {
  authService: AuthService;
  generationService: GenerationService;
  assetService: AssetService;
  creditService: CreditService;
  objectStore: ObjectStore;
  modelCatalog: ModelCatalog;
  orderService: OrderService;
  packageCatalog: PackageCatalog;
  paymentService: PaymentService;
  verifyConnectivity(): Promise<void>;
  closeDb(): Promise<void>;
}

export function createDbServices(
  db: AppDatabase,
  modelCatalog: ModelCatalog,
  packageCatalog: PackageCatalog,
  options: {
    authDevCodesEnabled: boolean;
    initialCredits: number;
    objectStore: ObjectStore;
    providerAdapter?: ProviderAdapter;
    paymentWebhookSecret?: string;
  }
): {
  authService: AuthService;
  generationService: GenerationService;
  assetService: AssetService;
  creditService: CreditService;
  objectStore: ObjectStore;
  orderService: OrderService;
  paymentService: PaymentService;
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
        image: new OpenAiCompatibleImageProvider({ objectStore: options.objectStore }),
        video: new AsyncVideoProvider()
      }),
    creditService
  });

  const assetService = new AssetServiceImpl(new DrizzleAssetRepository(db), {
    idGenerator: () => `creation_asset_${randomUUID()}`
  });

  const orderRepository = new DrizzleOrderRepository(db);
  const orderService = new OrderServiceImpl(orderRepository, packageCatalog, {
    idGenerator: () => `order_${randomUUID()}`,
    checkoutRefGenerator: () => `checkout_${randomUUID()}`
  });
  const paymentService = new PaymentServiceImpl(orderRepository, creditService, {
    secret: options.paymentWebhookSecret
  });

  return {
    authService,
    generationService,
    assetService,
    creditService,
    objectStore: options.objectStore,
    orderService,
    paymentService
  };
}

function createObjectStore(config: ApiConfig): ObjectStore {
  return config.objectStoreDir
    ? new LocalFileObjectStore(config.objectStoreDir, { publicBaseUrl: config.publicBaseUrl })
    : new InMemoryObjectStore({ publicBaseUrl: config.publicBaseUrl });
}

export function createServices(config: ApiConfig): AppServices {
  const modelCatalog = new ConfigModelCatalog(
    loadModelCatalogConfig(resolveConfigPath(config.modelConfigPath))
  );

  const packageCatalog = new ConfigPackageCatalog(
    loadPackageCatalogConfig(resolveConfigPath(config.packagesConfigPath))
  );

  const objectStore = createObjectStore(config);

  if (!config.databaseUrl) {
    const creditService = new InMemoryCreditService({ initialCredits: config.initialCredits });
    const orderRepository = new InMemoryOrderRepository();
    return {
      authService: new InMemoryAuthService({
        devCodesEnabled: config.authDevCodesEnabled,
        creditGranter: creditService
      }),
      generationService: new InMemoryGenerationService({
        modelCatalog,
        providerAdapter: new CompositeProviderAdapter({
          text: new OpenAiCompatibleTextProvider(),
          image: new OpenAiCompatibleImageProvider({ objectStore }),
          video: new AsyncVideoProvider()
        }),
        creditService
      }),
      assetService: new InMemoryAssetService(),
      creditService,
      objectStore,
      modelCatalog,
      orderService: new OrderServiceImpl(orderRepository, packageCatalog),
      packageCatalog,
      paymentService: new PaymentServiceImpl(orderRepository, creditService, {
        secret: config.paymentWebhookSecret
      }),
      async verifyConnectivity() {},
      async closeDb() {}
    };
  }

  const client = createDbClient(config.databaseUrl);
  const services = createDbServices(client.db, modelCatalog, packageCatalog, {
    authDevCodesEnabled: config.authDevCodesEnabled,
    initialCredits: config.initialCredits,
    objectStore,
    paymentWebhookSecret: config.paymentWebhookSecret
  });

  return {
    ...services,
    modelCatalog,
    packageCatalog,
    verifyConnectivity: () => client.verifyConnectivity(),
    closeDb: () => client.close()
  };
}
