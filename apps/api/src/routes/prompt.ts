import type { FastifyInstance, FastifyReply } from "fastify";
import type { PromptOptimizationRequest } from "@gw-link-omniai/shared";
import { PromptOptimizationError, type PromptOptimizer } from "../services/promptOptimizer";

export function registerPromptRoutes(server: FastifyInstance, promptOptimizer: PromptOptimizer): void {
  server.post("/v1/prompt/optimize", async (request, reply) => {
    const optimizationRequest = readPromptOptimizationRequest(request.body);

    if (!optimizationRequest) {
      return sendBadRequest(reply);
    }

    try {
      const optimization = promptOptimizer.optimizePrompt(optimizationRequest);
      return { optimization };
    } catch (error) {
      return sendPromptOptimizationError(reply, error);
    }
  });
}

function readPromptOptimizationRequest(body: unknown): PromptOptimizationRequest | undefined {
  if (!isRequestBody(body) || typeof body.mode !== "string" || typeof body.prompt !== "string") {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(body, "templateId") && typeof body.templateId !== "string") {
    return undefined;
  }

  return {
    mode: body.mode as PromptOptimizationRequest["mode"],
    prompt: body.prompt,
    ...(typeof body.templateId === "string" ? { templateId: body.templateId } : {})
  };
}

function isRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function sendBadRequest(reply: FastifyReply) {
  return reply.status(400).send({
    error: "Invalid prompt optimization request"
  });
}

function sendPromptOptimizationError(reply: FastifyReply, error: unknown) {
  if (error instanceof PromptOptimizationError) {
    return reply.status(error.statusCode).send({
      error: error.message
    });
  }

  return reply.status(500).send({
    error: "Unexpected prompt optimization error"
  });
}
