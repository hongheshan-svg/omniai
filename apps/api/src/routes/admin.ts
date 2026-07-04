import type { FastifyInstance } from "fastify";
import type { OrderService } from "../services/orderService";

export function registerAdminRoutes(
  server: FastifyInstance,
  deps: { orderService: OrderService; devAdminEnabled: boolean }
): void {
  server.get("/v1/admin/orders", async (_request, reply) => {
    if (!deps.devAdminEnabled) {
      return reply.status(403).send({ error: "Admin orders are disabled" });
    }
    return reply.status(200).send({ orders: await deps.orderService.listAllOrders() });
  });
}
