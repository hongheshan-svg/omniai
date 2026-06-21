import { useMemo, useState } from "react";
import type {
  CreationAsset,
  CreationMode,
  CreditAmount,
  GenerationTask,
  PromptOptimization,
  SessionResponse
} from "@gw-link-omniai/shared";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import { buildAssetRequestFromTask, filterCreationAssets, getAssetFilterLabel, summarizeAssetPrompt, type AssetFilter } from "./assetModel";
import { formatCreditBalance } from "./creditModel";
import { getGenerationStatusLabel, summarizeGenerationPrompt } from "./generationModel";
import { getDesktopSessionCta } from "./sessionModel";
import { getStudioModeContent, getStudioModes, getStudioTemplates } from "./studioModel";

const anonymousSession: SessionResponse = { authenticated: false, user: null, expiresAt: null };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后再试";
}

export function App({ client }: { client?: ApiClient } = {}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);

  const [session, setSession] = useState<SessionResponse>(anonymousSession);
  const [token, setToken] = useState<string | undefined>(undefined);

  const [destination, setDestination] = useState("");
  const [challengeId, setChallengeId] = useState<string | undefined>(undefined);
  const [devCode, setDevCode] = useState<string | undefined>(undefined);
  const [maskedDestination, setMaskedDestination] = useState<string | undefined>(undefined);
  const [code, setCode] = useState("");
  const [authError, setAuthError] = useState<string | undefined>(undefined);

  const [selectedMode, setSelectedMode] = useState<CreationMode>("text");
  const [promptText, setPromptText] = useState("");
  const [optimization, setOptimization] = useState<PromptOptimization | undefined>(undefined);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [assets, setAssets] = useState<CreationAsset[]>([]);
  const [balance, setBalance] = useState<CreditAmount | undefined>(undefined);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(selectedMode), [selectedMode]);
  const templates = useMemo(() => getStudioTemplates(selectedMode), [selectedMode]);
  const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];
  const filteredAssets = useMemo(() => filterCreationAssets(assets, assetFilter), [assets, assetFilter]);
  const promptInputId = `${selectedMode}-studio-prompt`;

  function handleSignedOut(message?: string) {
    setToken(undefined);
    setSession(anonymousSession);
    setTasks([]);
    setAssets([]);
    setBalance(undefined);
    setOptimization(undefined);
    if (message) {
      setAuthError(message);
    }
  }

  async function handleStartLogin() {
    setAuthError(undefined);
    try {
      const challenge = await api.startLogin({ destination });
      setChallengeId(challenge.challengeId);
      setMaskedDestination(challenge.maskedDestination);
      setDevCode(challenge.devCode);
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  }

  async function handleVerifyLogin() {
    if (!challengeId) {
      return;
    }
    setAuthError(undefined);
    try {
      const authSession = await api.verifyLogin({ challengeId, code });
      setToken(authSession.token);
      setSession({ authenticated: true, user: authSession.user, expiresAt: authSession.expiresAt });
      setChallengeId(undefined);
      setDevCode(undefined);
      setCode("");
      const [loadedTasks, loadedAssets, loadedBalance] = await Promise.all([
        api.listGenerations(authSession.token),
        api.listAssets(authSession.token),
        api.getCreditBalance(authSession.token)
      ]);
      setTasks(loadedTasks);
      setAssets(loadedAssets);
      setBalance(loadedBalance);
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  }

  async function handleLogout() {
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // best-effort; clear local state regardless
      }
    }
    handleSignedOut();
  }

  async function handleOptimize() {
    setActionError(undefined);
    try {
      setOptimization(await api.optimizePrompt({ mode: selectedMode, prompt: promptText }));
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function handleSaveAsset(task: GenerationTask) {
    if (!token) {
      return;
    }
    setActionError(undefined);
    try {
      await api.createAsset(buildAssetRequestFromTask(task), token);
      setAssets(await api.listAssets(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSignedOut("登录已失效，请重新登录");
        return;
      }
      setActionError(errorMessage(error));
    }
  }

  async function handleSubmitGeneration() {
    if (!optimization || !token) {
      return;
    }
    setActionError(undefined);
    try {
      await api.createGeneration(
        {
          mode: optimization.mode,
          prompt: optimization.originalPrompt,
          optimizedPrompt: optimization.optimizedPrompt,
          preset: optimization.preset
        },
        token
      );
      setTasks(await api.listGenerations(token));
      setBalance(await api.getCreditBalance(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSignedOut("登录已失效，请重新登录");
        return;
      }
      if (error instanceof ApiError && error.status === 402) {
        setActionError("积分不足，无法生成");
        return;
      }
      setActionError(errorMessage(error));
    }
  }

  if (!session.authenticated) {
    return (
      <main>
        <header>
          <h1>GW-LINK OmniAI</h1>
          <button type="button">{getDesktopSessionCta(session)}</button>
        </header>

        <section aria-label="登录">
          <h2>登录</h2>
          <div>
            <label htmlFor="login-destination">登录邮箱或手机号</label>
            <input
              id="login-destination"
              name="destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            />
            <button type="button" onClick={handleStartLogin}>
              发送验证码
            </button>
          </div>

          {challengeId ? (
            <div>
              <p>验证码已发送至 {maskedDestination}</p>
              {devCode ? <p>开发验证码：{devCode}</p> : null}
              <label htmlFor="login-code">验证码</label>
              <input
                id="login-code"
                name="code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <button type="button" onClick={handleVerifyLogin}>
                登录
              </button>
            </div>
          ) : null}

          {authError ? <p role="alert">{authError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>GW-LINK OmniAI</h1>
        <button type="button">{getDesktopSessionCta(session)}</button>
        {balance ? <p>{formatCreditBalance(balance)}</p> : null}
        <button type="button" onClick={handleLogout}>
          登出
        </button>
      </header>

      <nav aria-label="Studio modes">
        {studioModes.map((mode) => (
          <button
            key={mode.mode}
            type="button"
            aria-pressed={selectedMode === mode.mode}
            onClick={() => {
              setSelectedMode(mode.mode);
              setOptimization(undefined);
            }}
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
            id={promptInputId}
            name={`${selectedMode}Prompt`}
            placeholder={content.promptPlaceholder}
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
          />
        </div>

        <section aria-label="提示词模板">
          <h3>提示词模板</h3>
          <ul>
            {templates.map((template) => (
              <li key={template.id}>
                <h4>{template.name}</h4>
                <p>{template.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <button type="button" onClick={handleOptimize}>
          优化提示词
        </button>
      </section>

      {optimization ? (
        <section aria-label="提示词优化结果">
          <h2>优化结果</h2>
          <p>{optimization.optimizedPrompt}</p>
          <dl>
            {optimization.sections.map((part) => (
              <div key={part.label}>
                <dt>{part.label}</dt>
                <dd>{part.value}</dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby="preset-suggestion-title">
            <h3 id="preset-suggestion-title">推荐参数</h3>
            <p>{optimization.preset.modelId}</p>
            <p>
              预计点数：{optimization.preset.creditEstimate.credits}{" "}
              {optimization.preset.creditEstimate.credits === 1 ? "credit" : "credits"}
            </p>
          </section>
          <button type="button" onClick={handleSubmitGeneration}>
            提交生成
          </button>
        </section>
      ) : null}

      {actionError ? <p role="alert">{actionError}</p> : null}

      <section aria-label="任务中心">
        <h2>任务中心</h2>
        {tasks.length === 0 ? (
          <p>暂无生成任务</p>
        ) : (
          <ol>
            {tasks.map((task) => {
              const taskMode = getStudioModeContent(task.mode);
              const taskCredits = task.preset.creditEstimate.credits;
              return (
                <li key={task.id}>
                  <article>
                    <h3>{taskMode.title}</h3>
                    <p>{getGenerationStatusLabel(task.status)}</p>
                    <p>{summarizeGenerationPrompt(task)}</p>
                    <p>{task.preset.modelId}</p>
                    <p>
                      预计点数：{taskCredits} {taskCredits === 1 ? "credit" : "credits"}
                    </p>
                    {task.result?.kind === "text" ? <p>{task.result.text}</p> : null}
                    {task.status === "succeeded" && task.result?.kind === "text" ? (
                      <button type="button" onClick={() => handleSaveAsset(task)}>
                        保存到资产库
                      </button>
                    ) : null}
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
            {filteredAssets.map((asset) => (
              <li key={asset.id}>
                <article>
                  <h3>{asset.title}</h3>
                  <p>{asset.preview.description}</p>
                  <p>{summarizeAssetPrompt(asset)}</p>
                  <p>{asset.preset.modelId}</p>
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
