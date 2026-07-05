import type { GenerationTask } from "@gw-link-omniai/shared";
import { getGenerationStatusLabel } from "../generationModel";

export interface ResultCanvasProps {
  task?: GenerationTask;
  onSave(task: GenerationTask): void;
  onRetry(task: GenerationTask): void;
}

export function ResultCanvas({ task, onSave, onRetry }: ResultCanvasProps) {
  return (
    <section aria-label="结果画布" className="canvas">
      {!task ? (
        <div className="canvas-empty">
          <h2>从一个想法开始</h2>
          <p>在下方输入提示词，生成结果会展示在这里。</p>
        </div>
      ) : task.status === "queued" || task.status === "running" ? (
        <div className="canvas-skeleton" role="status">
          <span className="skeleton-line shimmer" />
          <span className="skeleton-line shimmer" />
          <span className="skeleton-line shimmer" />
          <p className="muted">
            <span>{getGenerationStatusLabel(task.status)}</span> · {task.preset.modelId}
          </p>
        </div>
      ) : task.status === "failed" ? (
        <div className="canvas-failed">
          <h2>生成失败</h2>
          <p className="muted">{task.resultPreview.description}</p>
          <button type="button" className="btn-primary" onClick={() => onRetry(task)}>
            重试
          </button>
        </div>
      ) : (
        <div className="canvas-result">
          {task.result?.kind === "text" ? <p className="canvas-text">{task.result.text}</p> : null}
          {task.result?.kind === "image" ? (
            <div className="canvas-media">
              <img src={task.result.url} alt={task.result.alt} />
            </div>
          ) : null}
          {task.result?.kind === "video" ? (
            <div className="canvas-media">
              <video controls src={task.result.url} poster={task.result.posterUrl} />
            </div>
          ) : null}
          <div className="row">
            <span className="muted">{task.preset.modelId}</span>
            <div className="spacer" />
            {task.result ? (
              <button type="button" className="btn-sm" onClick={() => onSave(task)}>
                保存到资产库
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
