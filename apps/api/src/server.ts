import Fastify from "fastify";
import { loadConfig } from "./config";
import { registerAuthRoutes } from "./routes/auth";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { InMemoryAuthService, type AuthService } from "./services/authService";

export interface BuildServerOptions {
  authService?: AuthService;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: false
  });
  const authService = options.authService ?? new InMemoryAuthService();

  registerHealthRoute(server);
  registerModelRoutes(server);
  registerAuthRoutes(server, authService);

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
