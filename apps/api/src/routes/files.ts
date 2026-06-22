import type { FastifyInstance } from "fastify";
import type { ObjectStore } from "../services/objectStore";

export function registerFileRoutes(server: FastifyInstance, objectStore: ObjectStore): void {
  server.get("/files/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const object = await objectStore.get(id);

    if (!object) {
      return reply.status(404).send({ error: "File not found" });
    }

    return reply.header("content-type", object.contentType).send(Buffer.from(object.bytes));
  });
}
