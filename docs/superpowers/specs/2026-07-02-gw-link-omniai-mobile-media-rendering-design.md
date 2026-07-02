# GW-LINK OmniAI Mobile 图片/视频结果渲染设计规格

**日期**: 2026-07-02
**Slice**: 17 — Mobile 图片/视频结果渲染

---

## 摘要

mobile App.tsx 的任务行（`GenerationTask.result`）和资产行（`CreationAsset.content`）扩展媒体渲染：图片用 RN 内置 `Image`，视频用 `posterUrl` 缩略图 + 时长标签（`formatDuration`），文本保持现状。无新依赖、视频不内联播放（poster 先行）。补一个 framework-free `formatDuration` 纯函数并单测。

## 动机

Slice 13–16 打通了 mobile 核心流程 + 任务刷新 + 资产库，但结果仅显示文本预览——图片/视频生成结果不可见。desktop 早已 `<img>` / `<video>` 渲染任务与资产。本切片补齐 mobile 的图片/视频展示，与 desktop 基本对齐。

**非目标**：
- 视频内联播放（poster 缩略图先行，expo-av 播放器留后续）
- 图片缩放/全屏/画廊
- 加载占位 / 失败重试 UI
- 触碰 desktop

## 设计

### 结果契约（已有，`packages/shared/src/models.ts`）

`GenerationTaskResult`（与 `CreationAssetContent` 同形）三变体：
```typescript
| { kind: "text"; text: string; format: "markdown" | "plain" }
| { kind: "image"; url: string; alt: string }
| { kind: "video"; url: string; durationSeconds: number; posterUrl: string }
```

### 1. mobile resultModel（framework-free）

新增 `apps/mobile/src/resultModel.ts`：

```typescript
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
```

单测（`apps/mobile/src/__tests__/resultModel.test.ts`）：`0→"0:00"`、`15→"0:15"`、`90→"1:30"`、`3661→"61:01"`、`-5→"0:00"`。

### 2. App.tsx 媒体渲染（薄视图，typecheck-only）

顶部 import 增加 `Image`（来自 `react-native`）与 `formatDuration`（来自 `./src/resultModel`）。

**任务行 renderItem**（现有 text 分支之后，刷新/保存按钮之前）扩展为处理三种 result：

```tsx
{item.result?.kind === "text" ? <Text numberOfLines={2}>结果: {item.result.text}</Text> : null}
{item.result?.kind === "image" ? (
  <Image source={{ uri: item.result.url }} accessibilityLabel={item.result.alt} style={styles.media} />
) : null}
{item.result?.kind === "video" ? (
  <>
    <Image source={{ uri: item.result.posterUrl }} accessibilityLabel="视频封面" style={styles.media} />
    <Text>时长 {formatDuration(item.result.durationSeconds)}</Text>
  </>
) : null}
```

**资产行 renderItem**（现有 mode 标签 + 摘要之后）追加 content 媒体：

```tsx
<View style={styles.task}>
  <Text>{getAssetModeLabel(item.mode)}</Text>
  <Text numberOfLines={1}>{summarizeAssetPrompt(item)}</Text>
  {item.content.kind === "image" ? (
    <Image source={{ uri: item.content.url }} accessibilityLabel={item.content.alt} style={styles.media} />
  ) : null}
  {item.content.kind === "video" ? (
    <>
      <Image source={{ uri: item.content.posterUrl }} accessibilityLabel="视频封面" style={styles.media} />
      <Text>时长 {formatDuration(item.content.durationSeconds)}</Text>
    </>
  ) : null}
</View>
```

（`content.kind === "text"` 不额外渲染——摘要已覆盖，保持精简。）

**样式**：`StyleSheet` 加 `media: { width: 160, height: 120, marginTop: 8 }`。

### 数据流

result/content 的 `url`/`posterUrl` 是服务端托管 URL（Slice 8 图片、11b 视频），`Image` 直接按 uri 加载。无鉴权。

## 错误处理

- `Image` 加载失败由 RN 自身处理（显示空白）；首版不额外处理。
- `formatDuration` 对非有限值 / 0 / 负数返回 `"0:00"`。

## 测试策略

- `resultModel.test.ts`：`formatDuration` 五组（0/15/90/3661/-5）。
- App.tsx 仍 typecheck-only（RN 不能在 vite-node 渲染，媒体渲染不单测——与既有 mobile App.tsx 一致；逻辑上唯一可测单元是 `formatDuration`）。
- 全量：`pnpm test` + `pnpm typecheck` 全绿。

## 文档

- README `### Mobile API Integration` 段落补：图片/视频结果以缩略图展示。
- mvp-skeleton `## Mobile API Integration Slice` 段落补同上。

## 任务分解

1. **mobile resultModel**（`formatDuration`）+ 测试。
2. **App.tsx**：任务行 + 资产行图片/视频渲染 + `media` 样式 + `Image`/`formatDuration` 导入 + typecheck。
3. **文档**（README + mvp-skeleton）。

## 交付清单

- [ ] `resultModel.ts`（formatDuration）+ 测试
- [ ] App.tsx 任务行 + 资产行 image/video 渲染 + media 样式
- [ ] 文档（README + mvp-skeleton）
- [ ] `pnpm test` + `pnpm typecheck` 全绿
