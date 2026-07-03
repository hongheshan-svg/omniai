import type { FastifyInstance } from "fastify";
import { createAuthGuard } from "./authGuard";
import type { AuthService } from "../services/authService";
import type { OrderService } from "../services/orderService";
import type { PaymentService } from "../services/paymentService";
import { PaymentServiceError } from "../services/paymentService";
import { signWebhookPayload } from "../services/webhookSignature";

export interface PaymentRouteDeps {
  paymentService: PaymentService;
  orderService: OrderService;
  authService: AuthService;
  secret?: string;
  devPaymentsEnabled: boolean;
}

export function registerPaymentRoutes(server: FastifyInstance, deps: PaymentRouteDeps): void {
  server.post("/v1/payments/webhook", async (request, reply) => {
    const rawBody = request.rawBody ?? "";
    const header = request.headers["x-gw-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    try {
      await deps.paymentService.handleWebhookEvent({ rawBody, signature });
      return reply.status(200).send({ received: true });
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  const preHandler = createAuthGuard(deps.authService);
  server.post("/v1/payments/dev-complete", { preHandler }, async (request, reply) => {
    if (!deps.devPaymentsEnabled) {
      return reply.status(403).send({ error: "Dev payment completion is disabled" });
    }
    const body = request.body;
    if (typeof body !== "object" || body === null || typeof (body as { orderId?: unknown }).orderId !== "string") {
      return reply.status(400).send({ error: "Invalid dev-complete request" });
    }
    const orderId = (body as { orderId: string }).orderId;
    const order = await deps.orderService.getOrder(request.userId!, orderId);
    if (!order) {
      return reply.status(404).send({ error: "Order not found" });
    }
    const rawBody = JSON.stringify({ type: "payment.succeeded", checkoutRef: order.checkoutRef });
    const signature = deps.secret ? signWebhookPayload(rawBody, deps.secret) : undefined;
    try {
      await deps.paymentService.handleWebhookEvent({ rawBody, signature });
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
    const updated = await deps.orderService.getOrder(request.userId!, orderId);
    return reply.status(200).send({ order: updated });
  });
}
