import type { FastifyInstance } from "fastify";
import type { CreditService } from "../services/creditService";
import type { AuthService } from "../services/authService";
import { createAuthGuard } from "./authGuard";

export function registerCreditRoutes(
  server: FastifyInstance,
  creditService: CreditService,
  authService: AuthService
): void {
  const preHandler = createAuthGuard(authService);

  server.get("/v1/credits/balance", { preHandler }, async (request) => ({
    balance: await creditService.getBalance(request.userId!)
  }));
}
