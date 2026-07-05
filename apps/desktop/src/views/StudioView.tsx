import { useMemo } from "react";
import type { CreationMode, GenerationTask, ProductModel, PromptOptimization } from "@gw-link-omniai/shared";
import { getStudioModeContent, getStudioModes } from "../studioModel";
import { Inspector } from "../components/Inspector";
import { PromptBar } from "../components/PromptBar";
import { ResultCanvas } from "../components/ResultCanvas";

export interface StudioViewProps {
  mode: CreationMode;
  promptText: string;
  optimization?: PromptOptimization;
  selectedTask?: GenerationTask;
  generating: boolean;
  models: ProductModel[];
  selectedModelId?: string;
  onModeChange(mode: CreationMode): void;
  onPromptChange(text: string): void;
  onOptimize(): void;
  onGenerate(): void;
  onSaveAsset(task: GenerationTask): void;
  onRetryTask(task: GenerationTask): void;
  onModelChange(modelId: string): void;
  onOptimizedPromptChange(text: string): void;
}

export function StudioView({
  mode,
  promptText,
  optimization,
  selectedTask,
  generating,
  models,
  selectedModelId,
  onModeChange,
  onPromptChange,
  onOptimize,
  onGenerate,
  onSaveAsset,
  onRetryTask,
  onModelChange,
  onOptimizedPromptChange
}: StudioViewProps) {
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(mode), [mode]);
  const estimateCredits = optimization ? optimization.preset.creditEstimate.credits : undefined;

  return (
    <div className="studio">
      <div className="studio-center">
        <ResultCanvas task={selectedTask} onSave={onSaveAsset} onRetry={onRetryTask} />

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

      <Inspector
        mode={mode}
        models={models}
        optimization={optimization}
        selectedModelId={selectedModelId}
        onModelChange={onModelChange}
        onOptimizedPromptChange={onOptimizedPromptChange}
      />
    </div>
  );
}
