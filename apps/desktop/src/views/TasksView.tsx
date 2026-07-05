import type { GenerationTask } from "@gw-link-omniai/shared";
import { getGenerationStatusLabel, summarizeGenerationPrompt } from "../generationModel";
import { getStudioModeContent } from "../studioModel";

export interface TasksViewProps {
  tasks: GenerationTask[];
  onSaveAsset(task: GenerationTask): void;
  onRefreshTask(task: GenerationTask): void;
}

export function TasksView({ tasks, onSaveAsset, onRefreshTask }: TasksViewProps) {
  return (
    <section aria-label="任务中心" className="stack">
      <h2>任务中心</h2>
      {tasks.length === 0 ? (
        <p className="empty">暂无生成任务</p>
      ) : (
        <ol className="items">
          {tasks.map((task) => {
            const taskMode = getStudioModeContent(task.mode);
            const taskCredits = task.preset.creditEstimate.credits;
            return (
              <li key={task.id}>
                <article className="item">
                  <h3>{taskMode.title}</h3>
                  <p>
                    <span className={`status status--${task.status}`}>{getGenerationStatusLabel(task.status)}</span>
                  </p>
                  <p>{summarizeGenerationPrompt(task)}</p>
                  <p className="muted">{task.preset.modelId}</p>
                  <p className="muted">
                    预计点数 {taskCredits} {taskCredits === 1 ? "credit" : "credits"}
                  </p>
                  {task.result?.kind === "text" ? <p>{task.result.text}</p> : null}
                  {task.result?.kind === "image" ? <img src={task.result.url} alt={task.result.alt} /> : null}
                  {task.result?.kind === "video" ? (
                    <video controls src={task.result.url} poster={task.result.posterUrl} />
                  ) : null}
                  <div className="actions">
                    {task.status === "succeeded" && task.result ? (
                      <button type="button" className="btn-sm" onClick={() => onSaveAsset(task)}>
                        保存到资产库
                      </button>
                    ) : null}
                    {task.status === "running" ? (
                      <button type="button" className="btn-sm" onClick={() => onRefreshTask(task)}>
                        刷新状态
                      </button>
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
