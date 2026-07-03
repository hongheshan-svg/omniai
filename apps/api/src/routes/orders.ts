import type { FastifyInstance } from "fastify";
import { isCreateOrderRequest } from "@gw-link-omniai/shared";
import type { AuthService } from "../services/authService";
import type { OrderService } from "../services/orderService";
import { OrderServiceError } from "../services/orderService";
import type { PackageCatalog } from "../services/packageCatalog";
import { createAuthGuard } from "./authGuard";

export function registerPackageRoutes(server: FastifyInstance, packageCatalog: PackageCatalog): void {
  server.get("/v1/packages", async () => ({
    packages: packageCatalog.listPackages()
  }));
}

export function registerOrderRoutes(
  server: FastifyInstance,
  deps: { orderService: OrderService; authService: AuthService }
): void {
  const preHandler = createAuthGuard(deps.authService);

  server.post("/v1/orders", { preHandler }, async (request, reply) => {
    if (!isCreateOrderRequest(request.body)) {
      return reply.status(400).send({ error: "Invalid order request" });
    }
    try {
      const order = await deps.orderService.createOrder(request.userId!, request.body.packageId);
      return reply.status(201).send({ order });
    } catch (error) {
      if (error instanceof OrderServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  server.get("/v1/orders", { preHandler }, async (request) => ({
    orders: await deps.orderService.listOrders(request.userId!)
  }));
}
