import Fastify from "fastify";
import { loadConfig } from "./config";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";

export function buildServer() {
  const server = Fastify({
    logger: false
  });

  registerHealthRoute(server);
  registerModelRoutes(server);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const server = buildServer();

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });

  console.log(`GW-LINK OmniAI API listening on ${config.port}`);
}
