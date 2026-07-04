# GW-LINK OmniAI 收据导出（复制到剪贴板）设计规格

**日期**: 2026-07-03
**Slice**: 27 — 收据导出：复制到剪贴板（桌面）

---

## 摘要

桌面已支付订单的收据块新增「复制收据」：把收据格式化为纯文本并写入剪贴板，供用户粘贴保存/转发。新增 shared 纯函数 `buildReceiptText(order, packageName)`，桌面通过可注入的 `copyText` 副作用（默认 `navigator.clipboard.writeText`）调用，成功显示「已复制收据」。PDF/系统打印留后续（Tauri 原生、jsdom 不可测）。

## 动机

Slice 25/26 已在桌面与移动端渲染收据；用户自然想把收据留存或转发。最务实、可测、跨平台（Tauri webview 剪贴板可用）的「导出」是复制纯文本。真实 PDF 导出/系统打印依赖 Tauri 原生能力且在 jsdom 下无法渲染测试，故本片先做复制。

**非目标（留后续）**：
- PDF 导出（Tauri fs/dialog + 打印到 PDF）
- 系统打印（`window.print` / Tauri 打印）
- 移动端复制（Expo Clipboard，后续小改）
- 导出为 `.txt` 文件（Tauri 文件对话框）

## 设计

### 关键默认

- 「导出」= 复制收据纯文本到剪贴板（可注入副作用，可测）。
- 仅已支付订单（收据块内）显示「复制收据」按钮。
- 复制成功显示 `role="status"` 的「已复制收据」；失败走 `actionError`。

### 1. shared 收据文本（`packages/shared/src/orderView.ts`）

新增纯函数：
```typescript
export function buildReceiptText(order: Order, packageName: string): string {
  return ["收据", ...buildReceiptLines(order, packageName).map((line) => `${line.label}：${line.value}`)].join("\n");
}
```
- 从 `packages/shared/src/index.ts` 再导出 `buildReceiptText`。
- 复用现有 `buildReceiptLines`，保证与屏幕收据字段/顺序一致。
- 新增 shared 单测（给定已支付订单 → 精确文本块）。

示例输出：
```
收据
收据编号：order_1
日期：2026-07-03 02:30
项目：100 积分
积分：100
金额：¥9.90
状态：已支付
```

### 2. 桌面复制（`apps/desktop/src/App.tsx`）

- App 签名加可选注入：`copyText?: (text: string) => Promise<void>`：
  ```typescript
  export function App({ client, tokenStore, copyText }: { client?: ApiClient; tokenStore?: TokenStore; copyText?: (text: string) => Promise<void> } = {}) {
    const copy = useMemo(() => copyText ?? ((text: string) => navigator.clipboard.writeText(text)), [copyText]);
  ```
- 新增 state：`const [copyNotice, setCopyNotice] = useState<string | undefined>(undefined);`。
- 收据 `dl` 之后加按钮：
  ```tsx
  <button type="button" onClick={() => void handleCopyReceipt(order, packageName)}>复制收据</button>
  ```
- `handleCopyReceipt(order, packageName)`：
  ```typescript
  async function handleCopyReceipt(order: Order, packageName: string) {
    setActionError(undefined);
    try {
      await copy(buildReceiptText(order, packageName));
      setCopyNotice("已复制收据");
    } catch {
      setActionError("复制失败，请重试");
    }
  }
  ```
- 在订单区（或 actionError 附近）渲染：`{copyNotice ? <p role="status">{copyNotice}</p> : null}`。
- 从 `@gw-link-omniai/shared` 引入 `buildReceiptText`。
- `handleSignedOut` 重置 `copyNotice`（`setCopyNotice(undefined)`）。

### 3. 文档

- README「### Receipt Export」小节（复制收据到剪贴板；PDF/打印留后续）。
- mvp-skeleton 段落。

## 错误处理

- 复制失败（`copyText` reject / 无剪贴板权限）→ `actionError` "复制失败，请重试"；不崩溃。
- `copyNotice` 为轻量确认，登出重置。

## 测试策略

- **shared**：`buildReceiptText` 单测（已支付订单 → 精确多行文本）。
- **桌面**：注入假 `copyText`（`vi.fn`），展开已支付订单点「复制收据」→ 断言 `copyText` 以 `buildReceiptText(...)` 文本被调用、且出现「已复制收据」；未支付订单收据块与按钮不出现（既有行为）。
- 全量 `pnpm test` + `pnpm typecheck` 全绿。

## 任务分解（约 3 任务）

1. shared `buildReceiptText` + 再导出 + 测试。
2. 桌面 `copyText` 注入 + 「复制收据」按钮 + `copyNotice` + `handleCopyReceipt` + 登出重置 + 测试。
3. 文档（README + mvp-skeleton）。

## 交付清单

- [ ] shared `buildReceiptText` + 再导出 + 测试
- [ ] 桌面复制按钮 + 注入 copyText + 已复制提示 + 测试
- [ ] 文档
- [ ] `pnpm test` + `pnpm typecheck` 全绿
