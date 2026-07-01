import type { FastifyInstance } from "fastify";
import type { CreditService } from "../services/creditService";
import type { AuthService } from "../services/authService";
import { createAuthGuard } from "./authGuard";

export function registerCreditRoutes(
  server: FastifyInstance,
  creditService: CreditService,
  authService: AuthService,
  options: { devTopupEnabled: boolean }
): void {
  const preHandler = createAuthGuard(authService);

  server.get("/v1/credits/balance", { preHandler }, async (request) => ({
    balance: await creditService.getBalance(request.userId!)
  }));

  server.post("/v1/credits/topup", { preHandler }, async (request, reply) => {
    if (!options.devTopupEnabled) {
      return reply.status(403).send({ error: "Top-up is disabled" });
    }

    const amount = readAmount(request.body);
    if (amount === undefined) {
      return reply.status(400).send({ error: "Invalid top-up amount" });
    }

    await creditService.topUp(request.userId!, amount);
    return { balance: await creditService.getBalance(request.userId!) };
  });
}

function readAmount(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const amount = (body as { amount?: unknown }).amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    return undefined;
  }

  return amount;
}
