import type { FastifyInstance } from "fastify";
import type { PackageCatalog } from "../services/packageCatalog";

export function registerPackageRoutes(server: FastifyInstance, packageCatalog: PackageCatalog): void {
  server.get("/v1/packages", async () => ({
    packages: packageCatalog.listPackages()
  }));
}
