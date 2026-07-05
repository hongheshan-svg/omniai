import { useEffect, useMemo, useState } from "react";
import type {
  CreationAsset,
  CreationMode,
  CreditAmount,
  CreditPackage,
  GenerationTask,
  GenerationTaskRequest,
  Order,
  ProductModel,
  PromptOptimization,
  SessionResponse
} from "@gw-link-omniai/shared";
import { ApiError, createApiClient, type ApiClient } from "@gw-link-omniai/shared";
import { buildAssetRequestFromTask, type AssetFilter } from "@gw-link-omniai/shared";
import { AuthScreen } from "./components/AuthScreen";
import { IconRail } from "./components/IconRail";
import { formatCreditBalance } from "./creditModel";
import { selectActiveTaskIds } from "./generationModel";
import { buildReceiptText } from "./orderModel";
import { countActiveTasks, getWorkspaceNavItems, viewForShortcutDigit, type WorkspaceView } from "./navModel";
import { getDesktopSessionCta } from "./sessionModel";
import type { IndustryTemplate } from "./templatesModel";
import { createLocalStorageTokenStore, type TokenStore } from "./tokenStore";
import { AccountView } from "./views/AccountView";
import { AssetsView } from "./views/AssetsView";
import { StudioView } from "./views/StudioView";
import { TasksView } from "./views/TasksView";

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
  const [models, setModels] = useState<ProductModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(undefined);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [assets, setAssets] = useState<CreationAsset[]>([]);
  const [balance, setBalance] = useState<CreditAmount | undefined>(undefined);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | undefined>(undefined);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [view, setView] = useState<WorkspaceView>("studio");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function loadUserData(authToken: string) {
    const [loadedTasks, loadedAssets, loadedBalance, loadedPackages, loadedOrders, loadedModels] = await Promise.all([
      api.listGenerations(authToken),
      api.listAssets(authToken),
      api.getCreditBalance(authToken),
      api.listPackages(),
      api.listOrders(authToken),
      api.listModels()
    ]);
    setTasks(loadedTasks);
    setAssets(loadedAssets);
    setBalance(loadedBalance);
    setPackages(loadedPackages);
    setOrders(loadedOrders);
    setModels(loadedModels);
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

  const activeKey = selectActiveTaskIds(tasks).join(",");
  useEffect(() => {
    if (!token) {
      return;
    }
    const activeIds = activeKey ? activeKey.split(",") : [];
    if (activeIds.length === 0) {
      return;
    }
    const interval = setInterval(() => {
      void pollRunningTasks(activeIds);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, token, activeKey]);

  useEffect(() => {
    if (!session.authenticated) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const next = viewForShortcutDigit(event.key);
        if (next) {
          event.preventDefault();
          setView(next);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session.authenticated]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId),
    [tasks, selectedTaskId]
  );

  function upsertTask(list: GenerationTask[], task: GenerationTask): GenerationTask[] {
    return list.some((existing) => existing.id === task.id)
      ? list.map((existing) => (existing.id === task.id ? task : existing))
      : [task, ...list];
  }

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
    setModels([]);
    setSelectedModelId(undefined);
    setSelectedTaskId(null);
    setView("studio");
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
      const result = await api.optimizePrompt({ mode: selectedMode, prompt: promptText });
      setOptimization(result);
      setSelectedModelId(result.preset.modelId);
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

  async function submitTask(request: GenerationTaskRequest) {
    if (!token) {
      return;
    }
    setActionError(undefined);
    setGenerating(true);
    try {
      const created = await api.createGeneration(request, token);
      setSelectedTaskId(created.id);
      const listed = await api.listGenerations(token);
      setTasks(upsertTask(listed, created));
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
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerate() {
    if (!token || generating) {
      return;
    }
    setGenerating(true);
    try {
      let activeOptimization = optimization;
      let freshOptimization = false;
      if (
        !activeOptimization ||
        activeOptimization.mode !== selectedMode ||
        activeOptimization.originalPrompt !== promptText
      ) {
        setActionError(undefined);
        try {
          activeOptimization = await api.optimizePrompt({ mode: selectedMode, prompt: promptText });
          freshOptimization = true;
          setOptimization(activeOptimization);
          setSelectedModelId(activeOptimization.preset.modelId);
        } catch (error) {
          setActionError(errorMessage(error));
          return;
        }
      }
      const resolvedModelId = freshOptimization
        ? activeOptimization.preset.modelId
        : selectedModelId ?? activeOptimization.preset.modelId;
      await submitTask({
        mode: activeOptimization.mode,
        prompt: activeOptimization.originalPrompt,
        optimizedPrompt: activeOptimization.optimizedPrompt,
        preset: { ...activeOptimization.preset, modelId: resolvedModelId }
      });
    } finally {
      setGenerating(false);
    }
  }

  async function handleRetryTask(task: GenerationTask) {
    setView("studio");
    await submitTask({
      mode: task.mode,
      prompt: task.prompt,
      optimizedPrompt: task.optimizedPrompt,
      preset: task.preset
    });
  }

  function handleApplyTemplate(template: IndustryTemplate) {
    setSelectedMode(template.mode);
    setPromptText(template.prompt);
    setOptimization(undefined);
    setSelectedModelId(undefined);
    setSelectedTaskId(null);
  }

  if (!session.authenticated) {
    return (
      <AuthScreen
        destination={destination}
        challengeId={challengeId}
        devCode={devCode}
        maskedDestination={maskedDestination}
        code={code}
        authError={authError}
        sessionCta={getDesktopSessionCta(session)}
        onDestinationChange={setDestination}
        onCodeChange={setCode}
        onStartLogin={() => void handleStartLogin()}
        onVerifyLogin={() => void handleVerifyLogin()}
      />
    );
  }

  const navItems = getWorkspaceNavItems();
  const activeLabel = navItems.find((item) => item.view === view)?.label ?? "创作";

  return (
    <div className="workspace">
      <IconRail items={navItems} active={view} activeTaskCount={countActiveTasks(tasks)} onSelect={setView} />
      <div className="main">
        <header className="topbar">
          <h1>{activeLabel}</h1>
          <div className="spacer" />
          {balance ? (
            <span className="chip">
              <span className="spark" aria-hidden="true" />
              {formatCreditBalance(balance)}
            </span>
          ) : null}
          <button type="button" className="user-btn">
            {getDesktopSessionCta(session)}
          </button>
          <button type="button" className="btn-sm" onClick={() => void handleLogout()}>
            登出
          </button>
        </header>

        <div className="view">
          {actionError ? (
            <p role="alert" className="alert alert--error" style={{ marginBottom: 12 }}>
              {actionError}
            </p>
          ) : null}
          {copyNotice ? (
            <p role="status" className="alert alert--ok" style={{ marginBottom: 12 }}>
              {copyNotice}
            </p>
          ) : null}

          {view === "studio" ? (
            <StudioView
              mode={selectedMode}
              promptText={promptText}
              optimization={optimization}
              selectedTask={selectedTask}
              generating={generating}
              models={models}
              selectedModelId={selectedModelId}
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onModeChange={(mode) => {
                setSelectedMode(mode);
                setOptimization(undefined);
                setSelectedModelId(undefined);
              }}
              onPromptChange={setPromptText}
              onOptimize={() => void handleOptimize()}
              onGenerate={() => void handleGenerate()}
              onSaveAsset={(task) => void handleSaveAsset(task)}
              onRetryTask={(task) => void handleRetryTask(task)}
              onModelChange={setSelectedModelId}
              onOptimizedPromptChange={(text) =>
                setOptimization((prev) => (prev ? { ...prev, optimizedPrompt: text } : prev))
              }
              onSelectTask={setSelectedTaskId}
              onShowTemplates={() => setSelectedTaskId(null)}
              onApplyTemplate={handleApplyTemplate}
            />
          ) : null}
          {view === "assets" ? <AssetsView assets={assets} filter={assetFilter} onFilterChange={setAssetFilter} /> : null}
          {view === "tasks" ? (
            <TasksView tasks={tasks} onSaveAsset={(task) => void handleSaveAsset(task)} onRefreshTask={(task) => void handleRefreshTask(task)} />
          ) : null}
          {view === "account" ? (
            <AccountView
              balance={balance}
              packages={packages}
              orders={orders}
              selectedOrderId={selectedOrderId}
              onTopUp={() => void handleTopUp()}
              onBuy={(pkg) => void handleBuy(pkg)}
              onDevComplete={(orderId) => void handleDevComplete(orderId)}
              onSelectOrder={setSelectedOrderId}
              onCopyReceipt={(order, packageName) => void handleCopyReceipt(order, packageName)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
