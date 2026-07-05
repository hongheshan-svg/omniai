import type { CreationMode } from "@gw-link-omniai/shared";
import type { StudioModeContent } from "../studioModel";

export interface PromptBarProps {
  mode: CreationMode;
  modes: StudioModeContent[];
  content: StudioModeContent;
  promptText: string;
  estimateCredits?: number;
  generating: boolean;
  onModeChange(mode: CreationMode): void;
  onPromptChange(text: string): void;
  onOptimize(): void;
  onGenerate(): void;
  onShowTemplates(): void;
}

export function PromptBar({
  mode,
  modes,
  content,
  promptText,
  estimateCredits,
  generating,
  onModeChange,
  onPromptChange,
  onOptimize,
  onGenerate,
  onShowTemplates
}: PromptBarProps) {
  return (
    <div className="prompt-dock">
      <div className="prompt-bar">
        <nav aria-label="Studio modes" className="mode-pills">
          {modes.map((candidate) => (
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
        <textarea
          className="prompt-input"
          aria-label={content.promptLabel}
          placeholder={content.promptPlaceholder}
          value={promptText}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onGenerate();
            }
          }}
        />
        <div className="prompt-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={onShowTemplates}>
            模板
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={onOptimize} disabled={generating}>
            优化提示词
          </button>
          <div className="spacer" />
          {typeof estimateCredits === "number" ? (
            <span className="estimate">预计 {estimateCredits} 点</span>
          ) : null}
          <button type="button" className="btn-primary" onClick={onGenerate} disabled={generating}>
            生成
          </button>
        </div>
      </div>
    </div>
  );
}
