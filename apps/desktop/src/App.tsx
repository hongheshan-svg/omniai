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
      <main className="auth">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="logo" aria-hidden="true" />
            <h1>GW-LINK OmniAI</h1>
          </div>
          <p className="sub">多模态 AI 创作工作台 · 文本 / 图片 / 视频</p>

          <section aria-label="登录" className="stack">
            <div className="field">
              <label htmlFor="login-destination">登录邮箱或手机号</label>
              <input
                id="login-destination"
                name="destination"
                placeholder="you@example.com"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
            </div>
            <button type="button" className="btn-primary" onClick={handleStartLogin}>
              发送验证码
            </button>

            {challengeId ? (
              <div className="stack">
                <p className="sent">验证码已发送至 {maskedDestination}</p>
                {devCode ? <p className="devcode">开发验证码：{devCode}</p> : null}
                <div className="field">
                  <label htmlFor="login-code">验证码</label>
                  <input
                    id="login-code"
                    name="code"
                    placeholder="6 位验证码"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>
                <button type="button" className="btn-primary" onClick={handleVerifyLogin}>
                  登录
                </button>
              </div>
            ) : null}

            {authError ? (
              <p role="alert" className="alert alert--error" style={{ margin: 0 }}>
                {authError}
              </p>
            ) : null}
          </section>

          <div style={{ marginTop: 18, textAlign: "center" }}>
            <button type="button" className="user-btn">
              {getDesktopSessionCta(session)}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <div className="name">OmniAI</div>
            <div className="tag">创作工作台</div>
          </div>
        </div>

        <div>
          <div className="side-label">创作模式</div>
          <nav aria-label="Studio modes" className="side-nav">
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
                <span className="dot" aria-hidden="true" />
                {mode.title}
              </button>
            ))}
          </nav>
        </div>

        <div className="side-foot">
          {balance ? (
            <div className="chip">
              <span className="spark" aria-hidden="true" />
              {formatCreditBalance(balance)}
            </div>
          ) : null}
          {balance ? (
            <button type="button" className="btn-sm" onClick={handleTopUp}>
              充值
            </button>
          ) : null}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>GW-LINK OmniAI</h1>
          <div className="spacer" />
          <button type="button" className="user-btn">
            {getDesktopSessionCta(session)}
          </button>
          <button type="button" className="btn-sm" onClick={handleLogout}>
            登出
          </button>
        </header>

        {actionError ? <p role="alert" className="alert alert--error">{actionError}</p> : null}
        {copyNotice ? <p role="status" className="alert alert--ok">{copyNotice}</p> : null}

        <div className="content">
          <section aria-labelledby="current-studio-mode-title" className="panel col-span">
            <h2 id="current-studio-mode-title">{content.title}</h2>
            <p className="desc">{content.description}</p>
            <div className="field">
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
              <ul className="templates">
                {templates.map((template) => (
                  <li key={template.id}>
                    <h4>{template.name}</h4>
                    <p>{template.description}</p>
                  </li>
                ))}
              </ul>
            </section>

            <div className="row" style={{ marginTop: 14 }}>
              <button type="button" className="btn-primary" onClick={handleOptimize}>
                优化提示词
              </button>
            </div>
          </section>

          {optimization ? (
            <section aria-label="提示词优化结果" className="panel col-span">
              <h2>优化结果</h2>
              <p className="desc">{optimization.optimizedPrompt}</p>
              <dl className="receipt">
                {optimization.sections.map((part) => (
                  <div key={part.label}>
                    <dt>{part.label}</dt>
                    <dd>{part.value}</dd>
                  </div>
                ))}
              </dl>
              <section aria-labelledby="preset-suggestion-title">
                <h3 id="preset-suggestion-title">推荐参数</h3>
                <p className="muted">{optimization.preset.modelId}</p>
                <p className="muted">
                  预计点数：{optimization.preset.creditEstimate.credits}{" "}
                  {optimization.preset.creditEstimate.credits === 1 ? "credit" : "credits"}
                </p>
              </section>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" className="btn-primary" onClick={handleSubmitGeneration}>
                  提交生成
                </button>
              </div>
            </section>
          ) : null}

          <section aria-label="任务中心" className="panel">
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
                        {task.result?.kind === "image" ? (
                          <img src={task.result.url} alt={task.result.alt} />
                        ) : null}
                        {task.result?.kind === "video" ? (
                          <video controls src={task.result.url} poster={task.result.posterUrl} />
                        ) : null}
                        <div className="actions">
                          {task.status === "succeeded" && task.result ? (
                            <button type="button" className="btn-sm" onClick={() => handleSaveAsset(task)}>
                              保存到资产库
                            </button>
                          ) : null}
                          {task.status === "running" ? (
                            <button type="button" className="btn-sm" onClick={() => handleRefreshTask(task)}>
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

          <section aria-label="资产库" className="panel">
            <h2>资产库</h2>
            <nav aria-label="资产过滤" className="filters">
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
              <p className="empty">暂无资产</p>
            ) : (
              <ol className="items">
                {filteredAssets.map((asset) => (
                  <li key={asset.id}>
                    <article className="item">
                      <h3>{asset.title}</h3>
                      <p>{asset.preview.description}</p>
                      {asset.content.kind === "image" ? (
                        <img src={asset.content.url} alt={asset.content.alt} />
                      ) : null}
                      {asset.content.kind === "video" ? (
                        <video controls src={asset.content.url} poster={asset.content.posterUrl} />
                      ) : null}
                      <p className="muted">{summarizeAssetPrompt(asset)}</p>
                      <p className="muted">{asset.preset.modelId}</p>
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-label="套餐" className="panel">
            <h2>积分套餐</h2>
            <div className="stack">
              {packages.map((pkg) => (
                <div className="pkg" key={pkg.id}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{pkg.displayName}</div>
                    <div className="pkg-meta">{pkg.credits} 积分</div>
                  </div>
                  <div className="row">
                    <span className="pkg-price">{formatPackagePrice(pkg)}</span>
                    <button type="button" className="btn-primary btn-sm" onClick={() => handleBuy(pkg)}>
                      购买 {pkg.displayName}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section aria-label="订单" className="panel">
            <h2>订单</h2>
            {orders.length === 0 ? (
              <p className="empty">暂无订单</p>
            ) : (
              <div className="stack">
                {orders.map((order) => {
                  const expanded = order.id === selectedOrderId;
                  const packageName = packages.find((p) => p.id === order.packageId)?.displayName ?? order.packageId;
                  return (
                    <div className="item" key={order.id}>
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span>
                          {packageName} · <span className={`status status--${order.status}`}>{getOrderStatusLabel(order.status)}</span>
                        </span>
                        <button type="button" className="btn-sm" onClick={() => setSelectedOrderId(expanded ? null : order.id)}>
                          {expanded ? "收起" : "查看"}
                        </button>
                      </div>
                      {order.status === "pending" && (
                        <div className="actions">
                          {order.checkoutUrl ? <a href={order.checkoutUrl}>去支付</a> : null}
                          <button type="button" className="btn-sm" onClick={() => void handleDevComplete(order.id)}>
                            （开发）完成支付
                          </button>
                        </div>
                      )}
                      {expanded && (
                        <div aria-label="订单详情" className="detail">
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
                              <dl aria-label="收据" className="receipt">
                                {buildReceiptLines(order, packageName).map((line) => (
                                  <div key={line.label}>
                                    <dt>{line.label}</dt>
                                    <dd>{line.value}</dd>
                                  </div>
                                ))}
                              </dl>
                              <button type="button" className="btn-sm" onClick={() => void handleCopyReceipt(order, packageName)}>
                                复制收据
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
