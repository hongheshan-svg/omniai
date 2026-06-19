import { getAdminSessionBanner } from "./sessionModel";

const modules = [
  "Users",
  "Plans & Credits",
  "Model Display",
  "Orders",
  "Usage Metrics"
];

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function AdminAppShell() {
  return (
    <main>
      <h1>GW-LINK OmniAI Admin</h1>
      <p>{getAdminSessionBanner(anonymousSession)}</p>
      <p>Operations console for the commercial AI creation product.</p>
      <section aria-label="Operations modules">
        {modules.map((module) => (
          <article key={module}>
            <h2>{module}</h2>
          </article>
        ))}
      </section>
    </main>
  );
}
