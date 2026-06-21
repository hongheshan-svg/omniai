import type { FastifyInstance, FastifyReply } from "fastify"
import type { GenerationTaskRequest } from "@gw-link-omniai/shared"
import { GenerationTaskError, type GenerationService } from "../services/generationService"
import type { AuthService } from "../services/authService"
import { createAuthGuard } from "./authGuard"

export function registerGenerationRoutes(
  server: FastifyInstance,
  generationService: GenerationService,
  authService: AuthService
): void {
  const preHandler = createAuthGuard(authService)

  server.post("/v1/generations", { preHandler }, async (request, reply) => {
    const generationRequest = readGenerationTaskRequest(request.body)

    if (!generationRequest) {
      return sendBadRequest(reply)
    }

    try {
      const task = await generationService.createTask(generationRequest, request.userId!)
      return { task }
    } catch (error) {
      return sendGenerationTaskError(reply, error)
    }
  })

  server.get("/v1/generations", { preHandler }, async (request) => ({
    tasks: await generationService.listTasks(request.userId!)
  }))
}

function readGenerationTaskRequest(body: unknown): GenerationTaskRequest | undefined {
  if (
    !isRequestBody(body) ||
    typeof body.mode !== "string" ||
    typeof body.prompt !== "string" ||
    typeof body.optimizedPrompt !== "string" ||
    !isRequestBody(body.preset)
  ) {
    return undefined
  }

  return {
    mode: body.mode as GenerationTaskRequest["mode"],
    prompt: body.prompt,
    optimizedPrompt: body.optimizedPrompt,
    preset: body.preset as unknown as GenerationTaskRequest["preset"]
  }
}

function isRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
}

function sendBadRequest(reply: FastifyReply) {
  return reply.status(400).send({
    error: "Invalid generation task request"
  })
}

function sendGenerationTaskError(reply: FastifyReply, error: unknown) {
  if (error instanceof GenerationTaskError) {
    return reply.status(error.statusCode).send({
      error: error.message
    })
  }

  return reply.status(500).send({
    error: "Unexpected generation task error"
  })
}
