import type { GenerationTask } from "@gw-link-omniai/shared";
import { sortByCreatedAtDesc } from "../generationModel";

const modeGlyphs: Record<GenerationTask["mode"], string> = {
  text: "文",
  image: "图",
  video: "视"
};

export interface HistoryStripProps {
  tasks: GenerationTask[];
  selectedTaskId: string | null;
  onSelect(taskId: string): void;
}

export function HistoryStrip({ tasks, selectedTaskId, onSelect }: HistoryStripProps) {
  const recent = sortByCreatedAtDesc(tasks).slice(0, 12);
  if (recent.length === 0) {
    return null;
  }
  return (
    <div className="history" role="toolbar" aria-label="历史任务">
      {recent.map((task) => (
        <button
          key={task.id}
          type="button"
          aria-label={`查看任务 ${task.id}`}
          aria-pressed={task.id === selectedTaskId}
          onClick={() => onSelect(task.id)}
        >
          {task.result?.kind === "image" ? (
            <img className="thumb" src={task.result.url} alt="" />
          ) : task.result?.kind === "video" ? (
            <img className="thumb" src={task.result.posterUrl} alt="" />
          ) : (
            <span>{modeGlyphs[task.mode]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
