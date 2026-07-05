import { useMemo } from "react";
import type { CreationMode, GenerationTask, PromptOptimization } from "@gw-link-omniai/shared";
import { getStudioModeContent, getStudioModes } from "../studioModel";
import { PromptBar } from "../components/PromptBar";
import { ResultCanvas } from "../components/ResultCanvas";

export interface StudioViewProps {
  mode: CreationMode;
  promptText: string;
  optimization?: PromptOptimization;
  selectedTask?: GenerationTask;
  generating: boolean;
  onModeChange(mode: CreationMode): void;
  onPromptChange(text: string): void;
  onOptimize(): void;
  onGenerate(): void;
  onSaveAsset(task: GenerationTask): void;
  onRetryTask(task: GenerationTask): void;
}

export function StudioView({
  mode,
  promptText,
  optimization,
  selectedTask,
  generating,
  onModeChange,
  onPromptChange,
  onOptimize,
  onGenerate,
  onSaveAsset,
  onRetryTask
}: StudioViewProps) {
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(mode), [mode]);
  const estimateCredits = optimization ? optimization.preset.creditEstimate.credits : undefined;

  return (
    <div className="studio">
      <div className="studio-center">
        <ResultCanvas task={selectedTask} onSave={onSaveAsset} onRetry={onRetryTask} />

        {optimization ? (
          <section aria-label="提示词优化结果" className="card">
            <h3>优化结果</h3>
            <p style={{ marginTop: 6 }}>{optimization.optimizedPrompt}</p>
            <p className="muted" style={{ marginTop: 6 }}>
              {optimization.preset.modelId} · 预计点数 {optimization.preset.creditEstimate.credits}
            </p>
          </section>
        ) : null}

        <PromptBar
          mode={mode}
          modes={studioModes}
          content={content}
          promptText={promptText}
          estimateCredits={estimateCredits}
          generating={generating}
          onModeChange={onModeChange}
          onPromptChange={onPromptChange}
          onOptimize={onOptimize}
          onGenerate={onGenerate}
        />
      </div>
    </div>
  );
}
