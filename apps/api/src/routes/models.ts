import type { FastifyInstance } from "fastify";
import type { ModelCatalog } from "../services/modelCatalog";

export function registerModelRoutes(server: FastifyInstance, modelCatalog: ModelCatalog): void {
  server.get("/v1/models", async () => ({
    models: modelCatalog.listVisibleModels()
  }));
}
