const creationModes = [
  "Text Chat",
  "Image Generation",
  "Video Generation"
];

export function App() {
  return (
    <main>
      <h1>GW-LINK OmniAI</h1>
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
