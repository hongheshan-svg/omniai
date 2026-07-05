import { useEffect, useMemo, useState } from "react";
import type {
  CreationAsset,
  CreationMode,
  CreditAmount,
  CreditPackage,
  GenerationTask,
  Order,
  PromptOptimization,
  SessionResponse
} from "@gw-link-omniai/shared";
import { ApiError, createApiClient, type ApiClient } from "@gw-link-omniai/shared";
import { buildAssetRequestFromTask, filterCreationAssets, getAssetFilterLabel, summarizeAssetPrompt, type AssetFilter } from "@gw-link-omniai/shared";
import { formatCreditBalance } from "./creditModel";
import { getGenerationStatusLabel, selectRunningTaskIds, summarizeGenerationPrompt } from "./generationModel";
import { buildReceiptLines, buildReceiptText, formatDateTime, formatMoney, formatPackagePrice, getOrderStatusLabel } from "./orderModel";
import { getDesktopSessionCta } from "./sessionModel";
import { getStudioModeContent, getStudioModes, getStudioTemplates } from "./studioModel";
import { createLocalStorageTokenStore, type TokenStore } from "./tokenStore";

const anonymousSession: SessionResponse = { authenticated: false, user: null, expiresAt: null };
const POLL_INTERVAL_MS = 5000;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后再试";
}

export function App({ client, tokenStore, copyText }: { client?: ApiClient; tokenStore?: TokenStore; copyText?: (text: string) => Promise<void> } = {}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const store = useMemo(() => tokenStore ?? createLocalStorageTokenStore(), [tokenStore]);
  const copy = useMemo(() => copyText ?? ((text: string) => navigator.clipboard.writeText(text)), [copyText]);

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
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | undefined>(undefined);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(selectedMode), [selectedMode]);
  const templates = useMemo(() => getStudioTemplates(selectedMode), [selectedMode]);
  const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];
  const filteredAssets = useMemo(() => filterCreationAssets(assets, assetFilter), [assets, assetFilter]);
  const promptInputId = `${selectedMode}-studio-prompt`;

  async function loadUserData(authToken: string) {
    const [loadedTasks, loadedAssets, loadedBalance, loadedPackages, loadedOrders] = await Promise.all([
      api.listGenerations(authToken),
      api.listAssets(authToken),
      api.getCreditBalance(authToken),
      api.listPackages(),
      api.listOrders(authToken)
    ]);
    setTasks(loadedTasks);
    setAssets(loadedAssets);
    setBalance(loadedBalance);
    setPackages(loadedPackages);
    setOrders(loadedOrders);
  }

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      const stored = store.load();
      if (!stored) {
        return;
      }
      try {
        const restored = await api.getSession(stored);
        if (cancelled) {
          return;
        }
        if (!restored.authenticated || !restored.user) {
          store.clear();
          return;
        }
        setToken(stored);
        setSession({ authenticated: true, user: restored.user, expiresAt: restored.expiresAt });
      } catch {
        store.clear();
        return;
      }
      try {
        await loadUserData(stored);
      } catch {
        // Session is restored; a transient data-load failure must not clear the token.
      }
    }
    void restoreSession();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, store]);

  const runningKey = selectRunningTaskIds(tasks).join(",");
  useEffect(() => {
    if (!token) {
      return;
    }
    const runningIds = runningKey ? runningKey.split(",") : [];
    if (runningIds.length === 0) {
      return;
    }
    const interval = setInterval(() => {
      void pollRunningTasks(runningIds);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, token, runningKey]);

  function handleSignedOut(message?: string) {
    store.clear();
    setToken(undefined);
    setSession(anonymousSession);
    setTasks([]);
    setAssets([]);
    setBalance(undefined);
    setPackages([]);
    setOrders([]);
    setSelectedOrderId(null);
    setCopyNotice(undefined);
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
      store.save(authSession.token);
      setSession({ authenticated: true, user: authSession.user, expiresAt: authSession.expiresAt });
      setChallengeId(undefined);
      setDevCode(undefined);
      setCode("");
      await loadUserData(authSession.token);
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

  async function handleRefreshTask(task: GenerationTask) {
    if (!token) {
      return;
    }
    setActionError(undefined);
    try {
      const updated = await api.getGeneration(task.id, token);
      setTasks((prev) => prev.map((existing) => (existing.id === updated.id ? updated : existing)));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSignedOut("登录已失效，请重新登录");
        return;
      }
      setActionError(errorMessage(error));
    }
  }

  async function pollRunningTasks(ids: string[]) {
    if (!token) {
      return;
    }
    for (const id of ids) {
      try {
        const updated = await api.getGeneration(id, token);
        setTasks((prev) => prev.map((existing) => (existing.id === updated.id ? updated : existing)));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          handleSignedOut("登录已失效，请重新登录");
          return;
        }
        // transient poll error: stay quiet, retry next tick
      }
    }
  }

  async function handleTopUp() {
    if (!token) {
      return;
    }
    setActionError(undefined);
    try {
      setBalance(await api.topUpCredits(100, token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSignedOut("登录已失效，请重新登录");
        return;
      }
      setActionError(errorMessage(error));
    }
  }

  async function handleBuy(pkg: CreditPackage) {
    if (!token) {
      return;
    }
    setActionError(undefined);
    try {
      await api.createOrder(pkg.id, token);
      setOrders(await api.listOrders(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSignedOut("登录已失效，请重新登录");
        return;
      }
      setActionError(errorMessage(error));
    }
  }

  async function handleDevComplete(orderId: string) {
    if (!token) {
      return;
    }
    setActionError(undefined);
    try {
      await api.devCompletePayment(orderId, token);
      setBalance(await api.getCreditBalance(token));
      setOrders(await api.listOrders(token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleSignedOut("登录已失效，请重新登录");
        return;
      }
      setActionError(errorMessage(error));
    }
  }

  async function handleCopyReceipt(order: Order, packageName: string) {
    setActionError(undefined);
    try {
      await copy(buildReceiptText(order, packageName));
      setCopyNotice("已复制收据");
    } catch {
      setCopyNotice(undefined);
      setActionError("复制失败，请重试");
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
        {balance ? (
          <button type="button" onClick={handleTopUp}>
            充值
          </button>
        ) : null}
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
      {copyNotice ? <p role="status">{copyNotice}</p> : null}

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
                    {task.result?.kind === "image" ? (
                      <img src={task.result.url} alt={task.result.alt} />
                    ) : null}
                    {task.result?.kind === "video" ? (
                      <video controls src={task.result.url} poster={task.result.posterUrl} />
                    ) : null}
                    {task.status === "succeeded" && task.result ? (
                      <button type="button" onClick={() => handleSaveAsset(task)}>
                        保存到资产库
                      </button>
                    ) : null}
                    {task.status === "running" ? (
                      <button type="button" onClick={() => handleRefreshTask(task)}>
                        刷新状态
                      </button>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-label="套餐">
        <h2>积分套餐</h2>
        {packages.map((pkg) => (
          <article key={pkg.id}>
            <p>{pkg.displayName} · {formatPackagePrice(pkg)} · {pkg.credits} 积分</p>
            <button type="button" onClick={() => handleBuy(pkg)}>购买 {pkg.displayName}</button>
          </article>
        ))}
      </section>
      <section aria-label="订单">
        <h2>订单</h2>
        {orders.map((order) => {
          const expanded = order.id === selectedOrderId;
          const packageName = packages.find((p) => p.id === order.packageId)?.displayName ?? order.packageId;
          return (
            <article key={order.id}>
              <p>
                {order.packageId} · <span>{getOrderStatusLabel(order.status)}</span>{" "}
                <button type="button" onClick={() => setSelectedOrderId(expanded ? null : order.id)}>
                  {expanded ? "收起" : "查看"}
                </button>
              </p>
              {order.status === "pending" && (
                <p>
                  {order.checkoutUrl ? <a href={order.checkoutUrl}>去支付</a> : null}{" "}
                  <button type="button" onClick={() => void handleDevComplete(order.id)}>（开发）完成支付</button>
                </p>
              )}
              {expanded && (
                <div aria-label="订单详情">
                  <p>订单号：{order.id}</p>
                  <p>套餐：{packageName}</p>
                  <p>积分：{order.credits}</p>
                  <p>金额：{formatMoney(order.amountCents, order.currency)}</p>
                  <p>状态：{getOrderStatusLabel(order.status)}</p>
                  <p>下单时间：{formatDateTime(order.createdAt)}</p>
                  {order.paidAt && <p>付款时间：{formatDateTime(order.paidAt)}</p>}
                  <p>凭证：{order.checkoutRef}</p>
                  {order.status === "paid" && (
                    <>
                      <dl aria-label="收据">
                        {buildReceiptLines(order, packageName).map((line) => (
                          <div key={line.label}>
                            <dt>{line.label}</dt>
                            <dd>{line.value}</dd>
                          </div>
                        ))}
                      </dl>
                      <button type="button" onClick={() => void handleCopyReceipt(order, packageName)}>复制收据</button>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
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
                  {asset.content.kind === "image" ? (
                    <img src={asset.content.url} alt={asset.content.alt} />
                  ) : null}
                  {asset.content.kind === "video" ? (
                    <video controls src={asset.content.url} poster={asset.content.posterUrl} />
                  ) : null}
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
