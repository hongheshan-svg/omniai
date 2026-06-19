const modules = [
  "Users",
  "Plans & Credits",
  "Model Display",
  "Orders",
  "Usage Metrics"
];

export function AdminAppShell() {
  return (
    <main>
      <h1>GW-LINK OmniAI Admin</h1>
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
