import type { FastifyInstance } from "fastify";

export function registerHealthRoute(server: FastifyInstance): void {
  server.get("/health", async () => ({
    service: "gw-link-omniai-api",
    status: "ok"
  }));
}
