"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { createApiClient, type ApiClient } from "@gw-link-omniai/shared";
import { getAdminSessionBanner } from "./sessionModel";
import { ModelCatalogSection } from "./ModelCatalogSection";
import { OrdersSection } from "./OrdersSection";
import { createAdminAuthController } from "./adminAuthModel";

const modules = ["Users", "Plans & Credits", "Model Display", "Orders", "Usage Metrics"];

const anonymousSession = {
  authenticated: false,
  user: null,
  expiresAt: null
} as const;

export function AdminAppShell({ client }: { client?: ApiClient } = {}) {
  const apiClient = useMemo(
    () => client ?? createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL }),
    [client]
  );
  const controller = useMemo(() => createAdminAuthController(apiClient), [apiClient]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  return (
    <main>
      <h1>GW-LINK OmniAI Admin</h1>
      <p>{getAdminSessionBanner(anonymousSession)}</p>
      <p>Operations console for the commercial AI creation product.</p>

      {state.stage !== "signedIn" ? (
        <section aria-label="Admin login">
          <h2>登录</h2>
          <div>
            <label htmlFor="admin-login-email">邮箱</label>
            <input
              id="admin-login-email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="button" onClick={() => controller.startLogin(email)}>
              发送验证码
            </button>
          </div>

          {state.stage === "codeSent" ? (
            <div>
              <label htmlFor="admin-login-code">验证码</label>
              <input
                id="admin-login-code"
                name="code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <button type="button" onClick={() => controller.verify(code)}>
                登录
              </button>
            </div>
          ) : null}

          {state.error ? <p role="alert">{state.error}</p> : null}
        </section>
      ) : null}

      <section aria-label="Operations modules">
        {modules.map((module) => (
          <article key={module}>
            <h2>{module}</h2>
            {module === "Model Display" ? <ModelCatalogSection client={apiClient} /> : null}
            {module === "Orders" ? (
              <OrdersSection client={apiClient} token={state.token ?? undefined} />
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
