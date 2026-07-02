import type { ApiClient } from "@gw-link-omniai/shared";
import { getAdminSessionBanner } from "./sessionModel";
import { ModelCatalogSection } from "./ModelCatalogSection";

const modules = ["Users", "Plans & Credits", "Model Display", "Orders", "Usage Metrics"];

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function AdminAppShell({ client }: { client?: ApiClient } = {}) {
  return (
    <main>
      <h1>GW-LINK OmniAI Admin</h1>
      <p>{getAdminSessionBanner(anonymousSession)}</p>
      <p>Operations console for the commercial AI creation product.</p>
      <section aria-label="Operations modules">
        {modules.map((module) => (
          <article key={module}>
            <h2>{module}</h2>
            {module === "Model Display" ? <ModelCatalogSection client={client} /> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
