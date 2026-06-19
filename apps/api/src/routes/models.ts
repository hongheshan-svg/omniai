import type { FastifyInstance } from "fastify";
import { listProductModels } from "../services/modelCatalog";

export function registerModelRoutes(server: FastifyInstance): void {
  server.get("/v1/models", async () => ({
    models: listProductModels()
  }));
}
