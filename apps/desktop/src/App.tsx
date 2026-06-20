import { useMemo, useState } from "react";
import type { CreationAsset, CreationMode, GenerationTask } from "@gw-link-omniai/shared";
import {
  createLocalCreationAsset,
  filterCreationAssets,
  getAssetFilterLabel,
  summarizeAssetPrompt,
  type AssetFilter
} from "./assetModel";
import {
  createLocalGenerationTask,
  getGenerationStatusLabel,
  summarizeGenerationPrompt
} from "./generationModel";
import { getDesktopSessionCta } from "./sessionModel";
import {
  getFixtureOptimization,
  getStudioModeContent,
  getStudioModes,
  getStudioTemplates
} from "./studioModel";

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function App() {
  const [selectedMode, setSelectedMode] = useState<CreationMode>("text");
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [creationAssets, setCreationAssets] = useState<CreationAsset[]>([]);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(selectedMode), [selectedMode]);
  const templates = useMemo(() => getStudioTemplates(selectedMode), [selectedMode]);
  const optimization = useMemo(() => getFixtureOptimization(selectedMode), [selectedMode]);
  const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];
  const filteredAssets = useMemo(
    () => filterCreationAssets(creationAssets, assetFilter),
    [creationAssets, assetFilter]
  );
  const promptInputId = `${selectedMode}-studio-prompt`;
  const creditCount = optimization.preset.creditEstimate.credits;
  const creditLabel = creditCount === 1 ? "credit" : "credits";

  function handleSubmitGeneration() {
    setGenerationTasks((currentTasks) => {
      const taskNumber = currentTasks.length + 1;
      const task = createLocalGenerationTask(optimization, {
        idGenerator: () => `desktop_generation_task_${taskNumber.toString().padStart(6, "0")}`,
        clock: { now: () => new Date("2026-06-20T00:00:00.000Z") }
      });

      return [task, ...currentTasks];
    });
  }

  function handleSaveAsset(task: GenerationTask) {
    setCreationAssets((currentAssets) => {
      const assetNumber = currentAssets.length + 1;
      const asset = createLocalCreationAsset(task, {
        idGenerator: () => `desktop_creation_asset_${assetNumber.toString().padStart(6, "0")}`,
        clock: { now: () => new Date("2026-06-20T00:00:00.000Z") }
      });

      return [asset, ...currentAssets];
    });
  }

  return (
    <main>
      <header>
        <h1>GW-LINK OmniAI</h1>
        <button type="button">{getDesktopSessionCta(anonymousSession)}</button>
      </header>

      <section aria-labelledby="studio-shell-title">
        <h2 id="studio-shell-title">全域智能创作台</h2>
        <p>围绕文字、图片、视频生产流程优化提示词，再进入生成任务和资产库。</p>
      </section>

      <nav aria-label="Studio modes">
        {studioModes.map((mode) => (
          <button
            key={mode.mode}
            type="button"
            aria-pressed={selectedMode === mode.mode}
            onClick={() => setSelectedMode(mode.mode)}
          >
            {mode.title}
          </button>
        ))}
      </nav>

      <section aria-labelledby="current-studio-mode-title">
        <h2 id="current-studio-mode-title">{content.title}</h2>
        <p>{content.description}</p>

        <div>
          <label htmlFor={promptInputId}>{content.promptLabel}</label>
          <textarea
            key={selectedMode}
            id={promptInputId}
            name={`${selectedMode}Prompt`}
            placeholder={content.promptPlaceholder}
            defaultValue={optimization.originalPrompt}
          />
        </div>

        <section aria-label="提示词模板">
          <h3>提示词模板</h3>
          <ul>
            {templates.map((template) => (
              <li key={template.id}>
                <h4>{template.name}</h4>
                <p>{template.description}</p>
                <ul>
                  {template.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        <button type="button">优化提示词</button>
      </section>

      <section aria-label="提示词优化结果">
        <h2>优化结果</h2>
        <p>{optimization.optimizedPrompt}</p>

        <dl>
          {optimization.sections.map((section) => (
            <div key={section.label}>
              <dt>{section.label}</dt>
              <dd>{section.value}</dd>
            </div>
          ))}
        </dl>

        <section aria-labelledby="preset-suggestion-title">
          <h3 id="preset-suggestion-title">推荐参数</h3>
          <dl>
            <div>
              <dt>modelId</dt>
              <dd>{optimization.preset.modelId}</dd>
            </div>
            <div>
              <dt>parameters</dt>
              <dd>
                <dl>
                  {Object.entries(optimization.preset.parameters).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </dd>
            </div>
            <div>
              <dt>点数估算</dt>
              <dd>
                预计点数：{creditCount} {creditLabel}
              </dd>
            </div>
          </dl>
        </section>

        <button type="button" onClick={handleSubmitGeneration}>
          提交生成
        </button>
      </section>

      <section aria-label="任务中心">
        <h2>任务中心</h2>
        {generationTasks.length === 0 ? (
          <p>暂无生成任务</p>
        ) : (
          <ol>
            {generationTasks.map((task) => {
              const taskMode = getStudioModeContent(task.mode);
              const taskCreditCount = task.preset.creditEstimate.credits;
              const taskCreditLabel = taskCreditCount === 1 ? "credit" : "credits";

              return (
                <li key={task.id}>
                  <article>
                    <h3>{taskMode.title}</h3>
                    <p>{getGenerationStatusLabel(task.status)}</p>
                    <p>{summarizeGenerationPrompt(task)}</p>
                    <dl>
                      <div>
                        <dt>modelId</dt>
                        <dd>{task.preset.modelId}</dd>
                      </div>
                      <div>
                        <dt>预计点数</dt>
                        <dd>
                          预计点数：{taskCreditCount} {taskCreditLabel}
                        </dd>
                      </div>
                    </dl>
                    <button type="button" onClick={() => handleSaveAsset(task)}>
                      保存到资产库
                    </button>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-label="资产库">
        <h2>资产库</h2>
        <nav aria-label="资产过滤">
          {assetFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={assetFilter === filter}
              onClick={() => setAssetFilter(filter)}
            >
              {getAssetFilterLabel(filter)}
            </button>
          ))}
        </nav>
        {filteredAssets.length === 0 ? (
          <p>暂无资产</p>
        ) : (
          <ol>
            {filteredAssets.map((asset) => {
              const assetCreditCount = asset.preset.creditEstimate.credits;
              const assetCreditLabel = assetCreditCount === 1 ? "credit" : "credits";

              return (
                <li key={asset.id}>
                  <article>
                    <h3>{asset.title}</h3>
                    <p>{asset.preview.description}</p>
                    <p>{summarizeAssetPrompt(asset)}</p>
                    <dl>
                      <div>
                        <dt>modelId</dt>
                        <dd>{asset.preset.modelId}</dd>
                      </div>
                      <div>
                        <dt>预计点数</dt>
                        <dd>
                          预计点数：{assetCreditCount} {assetCreditLabel}
                        </dd>
                      </div>
                    </dl>
                    <button type="button">复用参数</button>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
