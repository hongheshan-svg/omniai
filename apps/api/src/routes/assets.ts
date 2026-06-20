import type { CreationAssetRequest } from "@gw-link-omniai/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { AssetError, type AssetService } from "../services/assetService";

export function registerAssetRoutes(server: FastifyInstance, assetService: AssetService): void {
  server.post("/v1/assets", async (request, reply) => {
    const assetRequest = readCreationAssetRequest(request.body);

    if (!assetRequest) {
      return sendBadRequest(reply);
    }

    try {
      const asset = await assetService.createAsset(assetRequest);
      return { asset };
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });

  server.get("/v1/assets", async (_request, reply) => {
    try {
      const assets = await assetService.listAssets();
      return { assets };
    } catch (error) {
      return sendAssetError(reply, error);
    }
  });
}

function readCreationAssetRequest(body: unknown): CreationAssetRequest | undefined {
  if (
    !isRequestBody(body) ||
    typeof body.mode !== "string" ||
    typeof body.title !== "string" ||
    !isRequestBody(body.content) ||
    !isRequestBody(body.source) ||
    typeof body.prompt !== "string" ||
    typeof body.optimizedPrompt !== "string" ||
    !isRequestBody(body.preset)
  ) {
    return undefined;
  }

  return {
    mode: body.mode as CreationAssetRequest["mode"],
    title: body.title,
    content: body.content as unknown as CreationAssetRequest["content"],
    source: body.source as unknown as CreationAssetRequest["source"],
    prompt: body.prompt,
    optimizedPrompt: body.optimizedPrompt,
    preset: body.preset as unknown as CreationAssetRequest["preset"]
  };
}

function isRequestBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function sendBadRequest(reply: FastifyReply) {
  return reply.status(400).send({
    error: "Invalid asset request"
  });
}

function sendAssetError(reply: FastifyReply, error: unknown) {
  if (error instanceof AssetError) {
    return reply.status(error.statusCode).send({
      error: error.message
    });
  }

  return reply.status(500).send({
    error: "Unexpected asset error"
  });
}
