import type { preHandlerHookHandler } from "fastify";
import type { AuthService } from "../services/authService";
import { readBearerToken } from "./bearer";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export function createAuthGuard(authService: AuthService): preHandlerHookHandler {
  return async (request, reply) => {
    const token = readBearerToken(request.headers.authorization);
    const session = await authService.getSession(token);

    if (!session.authenticated || !session.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    request.userId = session.user.id;
  };
}
