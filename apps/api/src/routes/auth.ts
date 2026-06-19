import type { FastifyInstance } from "fastify";
import type { LoginStartRequest, LoginVerifyRequest } from "@gw-link-omniai/shared";
import { AuthError, type AuthService } from "../services/authService";

export function registerAuthRoutes(server: FastifyInstance, authService: AuthService): void {
  server.post("/v1/auth/start-login", async (request, reply) => {
    try {
      return authService.startLogin(request.body as LoginStartRequest);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  server.post("/v1/auth/verify-login", async (request, reply) => {
    try {
      return authService.verifyLogin(request.body as LoginVerifyRequest);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  server.get("/v1/auth/session", async (request) => {
    return authService.getSession(readBearerToken(request.headers.authorization));
  });

  server.post("/v1/auth/logout", async (request) => {
    authService.logout(readBearerToken(request.headers.authorization));
    return { ok: true };
  });
}

function readBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }

  return header.slice("Bearer ".length).trim() || undefined;
}

function sendAuthError(reply: { status: (code: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({
      error: error.message
    });
  }

  return reply.status(500).send({
    error: "Unexpected authentication error"
  });
}
