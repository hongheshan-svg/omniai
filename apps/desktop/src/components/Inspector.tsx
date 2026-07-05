import type { CreationMode, ProductModel, PromptOptimization } from "@gw-link-omniai/shared";

export interface InspectorProps {
  mode: CreationMode;
  models: ProductModel[];
  optimization?: PromptOptimization;
  selectedModelId?: string;
  onModelChange(modelId: string): void;
  onOptimizedPromptChange(text: string): void;
}

export function Inspector({
  mode,
  models,
  optimization,
  selectedModelId,
  onModelChange,
  onOptimizedPromptChange
}: InspectorProps) {
  const modeModels = models.filter((model) => model.capability === mode && model.visibility === "visible");
  const currentModelId = selectedModelId ?? optimization?.preset.modelId ?? modeModels[0]?.id ?? "";
  const currentModel = modeModels.find((model) => model.id === currentModelId);

  return (
    <aside className="inspector" aria-label="参数检查器">
      <div className="inspector-section">
        <h3>模型</h3>
        {modeModels.length > 0 ? (
          <select aria-label="模型选择" value={currentModelId} onChange={(event) => onModelChange(event.target.value)}>
            {modeModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">当前模式暂无可用模型</p>
        )}
        {currentModel ? <p className="muted">单次消耗 {currentModel.creditUnitCost} 点</p> : null}
      </div>

      {optimization ? (
        <section aria-label="提示词优化结果" className="inspector-section">
          <h3>优化后提示词</h3>
          <textarea
            aria-label="优化后提示词"
            value={optimization.optimizedPrompt}
            onChange={(event) => onOptimizedPromptChange(event.target.value)}
          />
          <dl className="receipt">
            {optimization.sections.map((part) => (
              <div key={part.label}>
                <dt>{part.label}</dt>
                <dd>{part.value}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            预计点数 {optimization.preset.creditEstimate.credits}
            {optimization.preset.creditEstimate.credits === 1 ? " credit" : " credits"}
          </p>
        </section>
      ) : (
        <div className="inspector-section">
          <h3>优化</h3>
          <p className="muted">点击「优化提示词」后，这里会展示优化结果与推荐参数。</p>
        </div>
      )}
    </aside>
  );
}
