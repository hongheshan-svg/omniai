import type { FastifyInstance } from "fastify";
import type { PaymentService } from "../services/paymentService";
import { PaymentServiceError } from "../services/paymentService";

export function registerPaymentRoutes(server: FastifyInstance, paymentService: PaymentService): void {
  server.post("/v1/payments/webhook", async (request, reply) => {
    const rawBody = request.rawBody ?? "";
    const header = request.headers["x-gw-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    try {
      await paymentService.handleWebhookEvent({ rawBody, signature });
      return reply.status(200).send({ received: true });
    } catch (error) {
      if (error instanceof PaymentServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}
