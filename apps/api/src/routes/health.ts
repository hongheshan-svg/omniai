import type { FastifyInstance } from "fastify";

export async function registerHealthRoute(server: FastifyInstance): Promise<void> {
  server.get("/health", async () => ({
    service: "gw-link-omniai-api",
    status: "ok"
  }));
}
