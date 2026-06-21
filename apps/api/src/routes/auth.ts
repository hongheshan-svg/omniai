import type { FastifyInstance, FastifyReply } from "fastify";
import type { LoginStartRequest, LoginVerifyRequest } from "@gw-link-omniai/shared";
import { AuthError, type AuthService } from "../services/authService";

export function registerAuthRoutes(server: FastifyInstance, authService: AuthService): void {
  server.post("/v1/auth/start-login", async (request, reply) => {
    const loginRequest = readLoginStartRequest(request.body);
    if (!loginRequest) {
      return sendBadRequest(reply, "Invalid login start request");
    }

    try {
      return await authService.startLogin(loginRequest);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  server.post("/v1/auth/verify-login", async (request, reply) => {
    const loginRequest = readLoginVerifyRequest(request.body);
    if (!loginRequest) {
      return sendBadRequest(reply, "Invalid login verification request");
    }

    try {
      return await authService.verifyLogin(loginRequest);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  server.get("/v1/auth/session", async (request, reply) => {
    try {
      return await authService.getSession(readBearerToken(request.headers.authorization));
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  server.post("/v1/auth/logout", async (request, reply) => {
    try {
      await authService.logout(readBearerToken(request.headers.authorization));
      return { ok: true };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });
}

function readLoginStartRequest(body: unknown): LoginStartRequest | undefined {
  if (!isRequestBody(body) || typeof body.destination !== "string") {
    return undefined;
  }

  if (!Object.prototype.hasOwnProperty.call(body, "channel")) {
    return { destination: body.destination };
  }

  if (body.channel !== "email" && body.channel !== "phone") {
    return undefined;
  }

  return {
    destination: body.destination,
    channel: body.channel
  };
}

function readLoginVerifyRequest(body: unknown): LoginVerifyRequest | undefined {
  if (!isRequestBody(body) || typeof body.challengeId !== "string" || typeof body.code !== "string") {
    return undefined;
  }

  return {
    challengeId: body.challengeId,
    code: body.code
  };
}

function isRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function readBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }

  return header.slice("Bearer ".length).trim() || undefined;
}

function sendBadRequest(reply: FastifyReply, error: string) {
  return reply.status(400).send({ error });
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError) {
    return reply.status(error.statusCode).send({
      error: error.message
    });
  }

  return reply.status(500).send({
    error: "Unexpected authentication error"
  });
}
