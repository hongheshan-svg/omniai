import type { GenerationTask, GenerationTaskStatus } from "@gw-link-omniai/shared";
import { getGenerationStatusLabel, summarizeGenerationPrompt, sortByCreatedAtDesc } from "../generationModel";
import { getStudioModeContent } from "../studioModel";

export interface TasksViewProps {
  tasks: GenerationTask[];
  onOpenTask(taskId: string): void;
  onRetryTask(task: GenerationTask): void;
  onRefreshTask(task: GenerationTask): void;
}

const groups: Array<{ title: string; statuses: GenerationTaskStatus[] }> = [
  { title: "进行中", statuses: ["queued", "running"] },
  { title: "已完成", statuses: ["succeeded"] },
  { title: "失败", statuses: ["failed"] }
];

export function TasksView({ tasks, onOpenTask, onRetryTask, onRefreshTask }: TasksViewProps) {
  return (
    <section aria-label="任务中心" className="task-groups">
      {tasks.length === 0 ? (
        <div className="canvas-empty">
          <h2>暂无生成任务</h2>
          <p>去创作视图提交一个想法吧。</p>
        </div>
      ) : (
        groups.map((group) => {
          const groupTasks = sortByCreatedAtDesc(tasks.filter((task) => group.statuses.includes(task.status)));
          if (groupTasks.length === 0) {
            return null;
          }
          return (
            <div key={group.title} className="task-group">
              <h2>{`${group.title}（${groupTasks.length}）`}</h2>
              <div className="stack">
                {groupTasks.map((task) => (
                  <article key={task.id} className="task-row">
                    <div className="grow">
                      <div className="row">
                        <h3>{getStudioModeContent(task.mode).title}</h3>
                        <span className={`status status--${task.status}`}>{getGenerationStatusLabel(task.status)}</span>
                      </div>
                      <p className="muted">{summarizeGenerationPrompt(task)}</p>
                      <p className="muted">
                        {task.preset.modelId} · 预计点数 {task.preset.creditEstimate.credits}
                      </p>
                    </div>
                    <div className="actions" style={{ marginTop: 0 }}>
                      {task.status === "running" ? (
                        <button type="button" className="btn-sm" onClick={() => onRefreshTask(task)}>
                          刷新状态
                        </button>
                      ) : null}
                      {task.status === "failed" ? (
                        <button type="button" className="btn-sm" onClick={() => onRetryTask(task)}>
                          重试
                        </button>
                      ) : null}
                      <button type="button" className="btn-sm" aria-label={`打开任务 ${task.id}`} onClick={() => onOpenTask(task.id)}>
                        打开
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
