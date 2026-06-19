import type { FastifyInstance } from "fastify";
import { listProductModels } from "../services/modelCatalog";

export async function registerModelRoutes(server: FastifyInstance): Promise<void> {
  server.get("/v1/models", async () => ({
    models: listProductModels()
  }));
}
