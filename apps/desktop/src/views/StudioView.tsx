import { useMemo } from "react";
import type { CreationMode, GenerationTask, ProductModel, PromptOptimization } from "@gw-link-omniai/shared";
import { getStudioModeContent, getStudioModes } from "../studioModel";
import type { IndustryTemplate } from "../templatesModel";
import { HistoryStrip } from "../components/HistoryStrip";
import { Inspector } from "../components/Inspector";
import { PromptBar } from "../components/PromptBar";
import { ResultCanvasBody } from "../components/ResultCanvas";
import { TemplateGallery } from "../components/TemplateGallery";

export interface StudioViewProps {
  mode: CreationMode;
  promptText: string;
  optimization?: PromptOptimization;
  selectedTask?: GenerationTask;
  generating: boolean;
  models: ProductModel[];
  selectedModelId?: string;
  tasks: GenerationTask[];
  selectedTaskId: string | null;
  onModeChange(mode: CreationMode): void;
  onPromptChange(text: string): void;
  onOptimize(): void;
  onGenerate(): void;
  onSaveAsset(task: GenerationTask): void;
  onRetryTask(task: GenerationTask): void;
  onModelChange(modelId: string): void;
  onOptimizedPromptChange(text: string): void;
  onSelectTask(taskId: string): void;
  onShowTemplates(): void;
  onApplyTemplate(template: IndustryTemplate): void;
}

export function StudioView({
  mode,
  promptText,
  optimization,
  selectedTask,
  generating,
  models,
  selectedModelId,
  tasks,
  selectedTaskId,
  onModeChange,
  onPromptChange,
  onOptimize,
  onGenerate,
  onSaveAsset,
  onRetryTask,
  onModelChange,
  onOptimizedPromptChange,
  onSelectTask,
  onShowTemplates,
  onApplyTemplate
}: StudioViewProps) {
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(mode), [mode]);
  const estimateCredits = optimization ? optimization.preset.creditEstimate.credits : undefined;

  return (
    <div className="studio">
      <div className="studio-center">
        <section aria-label="结果画布" className="canvas">
          {selectedTask ? (
            <ResultCanvasBody task={selectedTask} onSave={onSaveAsset} onRetry={onRetryTask} />
          ) : (
            <TemplateGallery onApply={onApplyTemplate} />
          )}
        </section>

        <HistoryStrip tasks={tasks} selectedTaskId={selectedTaskId} onSelect={onSelectTask} />

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
          onShowTemplates={onShowTemplates}
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
