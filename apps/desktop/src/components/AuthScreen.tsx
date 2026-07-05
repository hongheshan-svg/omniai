export interface AuthScreenProps {
  destination: string;
  challengeId?: string;
  devCode?: string;
  maskedDestination?: string;
  code: string;
  authError?: string;
  sessionCta: string;
  onDestinationChange(value: string): void;
  onCodeChange(value: string): void;
  onStartLogin(): void;
  onVerifyLogin(): void;
}

export function AuthScreen({
  destination,
  challengeId,
  devCode,
  maskedDestination,
  code,
  authError,
  sessionCta,
  onDestinationChange,
  onCodeChange,
  onStartLogin,
  onVerifyLogin
}: AuthScreenProps) {
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
              onChange={(event) => onDestinationChange(event.target.value)}
            />
          </div>
          <button type="button" className="btn-primary" onClick={onStartLogin}>
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
                  onChange={(event) => onCodeChange(event.target.value)}
                />
              </div>
              <button type="button" className="btn-primary" onClick={onVerifyLogin}>
                登录
              </button>
            </div>
          ) : null}

          {authError ? (
            <p role="alert" className="alert alert--error">
              {authError}
            </p>
          ) : null}
        </section>

        <div className="row" style={{ marginTop: 18, justifyContent: "center" }}>
          <button type="button" className="user-btn">
            {sessionCta}
          </button>
        </div>
      </div>
    </main>
  );
}
