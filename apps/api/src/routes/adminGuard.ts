import type { preHandlerHookHandler } from "fastify";
import type { AuthService } from "../services/authService";
import { readBearerToken } from "./bearer";

export function createAdminGuard(authService: AuthService, adminEmails: string[]): preHandlerHookHandler {
  return async (request, reply) => {
    const token = readBearerToken(request.headers.authorization);
    const session = await authService.getSession(token);

    if (!session.authenticated || !session.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    if (!adminEmails.includes(session.user.destination)) {
      return reply.status(403).send({ error: "Admin access required" });
    }

    request.userId = session.user.id;
  };
}
