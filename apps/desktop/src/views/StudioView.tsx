import { useMemo } from "react";
import type { CreationMode, PromptOptimization } from "@gw-link-omniai/shared";
import { getStudioModeContent, getStudioModes, getStudioTemplates } from "../studioModel";

export interface StudioViewProps {
  mode: CreationMode;
  promptText: string;
  optimization?: PromptOptimization;
  onModeChange(mode: CreationMode): void;
  onPromptChange(text: string): void;
  onOptimize(): void;
  onSubmit(): void;
}

export function StudioView({ mode, promptText, optimization, onModeChange, onPromptChange, onOptimize, onSubmit }: StudioViewProps) {
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(mode), [mode]);
  const templates = useMemo(() => getStudioTemplates(mode), [mode]);
  const promptInputId = `${mode}-studio-prompt`;

  return (
    <div className="stack">
      <nav aria-label="Studio modes" className="mode-pills">
        {studioModes.map((candidate) => (
          <button
            key={candidate.mode}
            type="button"
            aria-pressed={mode === candidate.mode}
            onClick={() => onModeChange(candidate.mode)}
          >
            {candidate.title}
          </button>
        ))}
      </nav>

      <section aria-labelledby="current-studio-mode-title" className="card">
        <h2 id="current-studio-mode-title">{content.title}</h2>
        <p className="muted">{content.description}</p>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor={promptInputId}>{content.promptLabel}</label>
          <textarea
            id={promptInputId}
            name={`${mode}Prompt`}
            placeholder={content.promptPlaceholder}
            value={promptText}
            onChange={(event) => onPromptChange(event.target.value)}
          />
        </div>

        <section aria-label="提示词模板" style={{ marginTop: 12 }}>
          <h3>提示词模板</h3>
          <ul className="items" style={{ marginTop: 8 }}>
            {templates.map((template) => (
              <li key={template.id} className="item">
                <h4>{template.name}</h4>
                <p className="muted">{template.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="btn-primary" onClick={onOptimize}>
            优化提示词
          </button>
        </div>
      </section>

      {optimization ? (
        <section aria-label="提示词优化结果" className="card">
          <h2>优化结果</h2>
          <p style={{ marginTop: 8 }}>{optimization.optimizedPrompt}</p>
          <dl className="receipt">
            {optimization.sections.map((part) => (
              <div key={part.label}>
                <dt>{part.label}</dt>
                <dd>{part.value}</dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby="preset-suggestion-title" style={{ marginTop: 10 }}>
            <h3 id="preset-suggestion-title">推荐参数</h3>
            <p className="muted">{optimization.preset.modelId}</p>
            <p className="muted">
              预计点数：{optimization.preset.creditEstimate.credits}{" "}
              {optimization.preset.creditEstimate.credits === 1 ? "credit" : "credits"}
            </p>
          </section>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn-primary" onClick={onSubmit}>
              提交生成
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
