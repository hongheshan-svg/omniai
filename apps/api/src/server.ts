import Fastify from "fastify";
import { loadConfig, type ApiConfig } from "./config";
import { registerAuthRoutes } from "./routes/auth";
import { registerGenerationRoutes } from "./routes/generations";
import { registerHealthRoute } from "./routes/health";
import { registerModelRoutes } from "./routes/models";
import { registerPromptRoutes } from "./routes/prompt";
import { InMemoryAuthService, type AuthService } from "./services/authService";
import { InMemoryGenerationService, type GenerationService } from "./services/generationService";
import { LocalPromptOptimizer, type PromptOptimizer } from "./services/promptOptimizer";

export interface BuildServerOptions {
  authService?: AuthService;
  config?: ApiConfig;
  generationService?: GenerationService;
  promptOptimizer?: PromptOptimizer;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: false
  });
  const authService =
    options.authService ??
    new InMemoryAuthService({
      devCodesEnabled: (options.config ?? loadConfig()).authDevCodesEnabled
    });
  const promptOptimizer = options.promptOptimizer ?? new LocalPromptOptimizer();
  const generationService = options.generationService ?? new InMemoryGenerationService();

  registerHealthRoute(server);
  registerModelRoutes(server);
  registerPromptRoutes(server, promptOptimizer);
  registerGenerationRoutes(server, generationService);
  registerAuthRoutes(server, authService);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const server = buildServer({ config });

  await server.listen({
    port: config.port,
    host: "0.0.0.0"
  });

  console.log(`GW-LINK OmniAI API listening on ${config.port}`);
}
