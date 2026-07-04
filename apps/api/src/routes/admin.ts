import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/authService";
import type { OrderService } from "../services/orderService";
import { createAdminGuard } from "./adminGuard";

export function registerAdminRoutes(
  server: FastifyInstance,
  deps: { orderService: OrderService; authService: AuthService; adminEmails: string[]; devAdminEnabled: boolean }
): void {
  const preHandler = createAdminGuard(deps.authService, deps.adminEmails);

  server.get("/v1/admin/orders", { preHandler }, async (_request, reply) => {
    if (!deps.devAdminEnabled) {
      return reply.status(403).send({ error: "Admin orders are disabled" });
    }
    return reply.status(200).send({ orders: await deps.orderService.listAllOrders() });
  });
}
