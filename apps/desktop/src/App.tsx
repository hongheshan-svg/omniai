import { getDesktopSessionCta } from "./sessionModel";

const creationModes = [
  "Text Chat",
  "Image Generation",
  "Video Generation"
];

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function App() {
  return (
    <main>
      <header>
        <h1>GW-LINK OmniAI</h1>
        <button type="button">{getDesktopSessionCta(anonymousSession)}</button>
      </header>
      <p>One workspace for text, image, and video AI creation.</p>
      <nav aria-label="Creation modes">
        {creationModes.map((mode) => (
          <button key={mode} type="button">
            {mode}
          </button>
        ))}
      </nav>
    </main>
  );
}
