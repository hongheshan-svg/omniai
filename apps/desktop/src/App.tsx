import { useMemo, useState } from "react";
import type { CreationMode } from "@gw-link-omniai/shared";
import { getDesktopSessionCta } from "./sessionModel";
import {
  getFixtureOptimization,
  getStudioModeContent,
  getStudioModes,
  getStudioTemplates
} from "./studioModel";

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function App() {
  const [selectedMode, setSelectedMode] = useState<CreationMode>("text");
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(selectedMode), [selectedMode]);
  const templates = useMemo(() => getStudioTemplates(selectedMode), [selectedMode]);
  const optimization = useMemo(() => getFixtureOptimization(selectedMode), [selectedMode]);
  const promptInputId = `${selectedMode}-studio-prompt`;
  const creditCount = optimization.preset.creditEstimate.credits;
  const creditLabel = creditCount === 1 ? "credit" : "credits";

  return (
    <main>
      <header>
        <h1>GW-LINK OmniAI</h1>
        <button type="button">{getDesktopSessionCta(anonymousSession)}</button>
      </header>

      <section aria-labelledby="studio-shell-title">
        <h2 id="studio-shell-title">全域智能创作台</h2>
        <p>围绕文字、图片、视频生产流程优化提示词，再进入生成任务和资产库。</p>
      </section>

      <nav aria-label="Studio modes">
        {studioModes.map((mode) => (
          <button
            key={mode.mode}
            type="button"
            aria-pressed={selectedMode === mode.mode}
            onClick={() => setSelectedMode(mode.mode)}
          >
            {mode.title}
          </button>
        ))}
      </nav>

      <section aria-labelledby="current-studio-mode-title">
        <h2 id="current-studio-mode-title">{content.title}</h2>
        <p>{content.description}</p>

        <div>
          <label htmlFor={promptInputId}>{content.promptLabel}</label>
          <textarea
            key={selectedMode}
            id={promptInputId}
            name={`${selectedMode}Prompt`}
            placeholder={content.promptPlaceholder}
            defaultValue={optimization.originalPrompt}
          />
        </div>

        <section aria-label="提示词模板">
          <h3>提示词模板</h3>
          <ul>
            {templates.map((template) => (
              <li key={template.id}>
                <h4>{template.name}</h4>
                <p>{template.description}</p>
                <ul>
                  {template.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <button type="button">优化提示词</button>
      </section>

      <section aria-label="提示词优化结果">
        <h2>优化结果</h2>
        <p>{optimization.optimizedPrompt}</p>

        <dl>
          {optimization.sections.map((section) => (
            <div key={section.label}>
              <dt>{section.label}</dt>
              <dd>{section.value}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="preset-suggestion-title">
          <h3 id="preset-suggestion-title">推荐参数</h3>
          <dl>
            <div>
              <dt>modelId</dt>
              <dd>{optimization.preset.modelId}</dd>
            </div>
            <div>
              <dt>parameters</dt>
              <dd>
                <dl>
                  {Object.entries(optimization.preset.parameters).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </dd>
            </div>
            <div>
              <dt>点数估算</dt>
              <dd>
                预计点数：{creditCount} {creditLabel}
              </dd>
            </div>
          </dl>
        </section>

        <button type="button" disabled>
          提交生成（待接入）
        </button>
      </section>
    </main>
  );
}
