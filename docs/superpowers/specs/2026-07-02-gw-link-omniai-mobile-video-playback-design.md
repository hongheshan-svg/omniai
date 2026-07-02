# GW-LINK OmniAI Mobile 视频内联播放设计规格

**日期**: 2026-07-02
**Slice**: 18 — Mobile 视频内联播放

---

## 摘要

把 Slice 17 的视频「poster 缩略图 + 时长」升级为 `expo-av` 的 `<Video>` 真实播放器（原生控件 + poster）。抽 `VideoResult` 组件复用于任务行与资产行两处。图片/文本渲染不变、复用已测的 `formatDuration`。

## 动机

Slice 17 让 mobile 展示视频 poster 缩略图但不能播放。desktop 早已 `<video controls>` 内联播放。本切片补齐 mobile 视频播放，与 desktop 对齐，完成媒体展示闭环。

**非目标**：
- 自定义播放控件 / 进度条 / 画中画 / 全屏管理（用 expo-av 原生控件）
- 后台音频、iOS/Android 权限配置（基础播放不需要）
- 桌面改动、图片缩放

## 设计

### 依赖

`apps/mobile/package.json` 的 `dependencies` 加：
```json
"expo-av": "~14.0.7"
```
（Expo SDK 51 兼容版本。）app.json 无需加 config plugin——基础视频播放不需要原生权限配置。

### VideoResult 组件（新增 `apps/mobile/src/VideoResult.tsx`，typecheck-only）

```typescript
import { ResizeMode, Video } from "expo-av";
import { View, Text, StyleSheet } from "react-native";
import { formatDuration } from "./resultModel";

export function VideoResult({
  uri,
  posterUrl,
  durationSeconds
}: {
  uri: string;
  posterUrl: string;
  durationSeconds: number;
}) {
  return (
    <View>
      <Video
        source={{ uri }}
        posterSource={{ uri: posterUrl }}
        usePoster
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        style={styles.video}
      />
      <Text>时长 {formatDuration(durationSeconds)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  video: { width: 240, height: 160, marginTop: 8 }
});
```

`formatDuration` 复用 Slice 17 的 `apps/mobile/src/resultModel.ts`（已单测）。

### App.tsx 接入

顶部：移除 `import { formatDuration } from "./src/resultModel";`（改由 VideoResult 使用），加 `import { VideoResult } from "./src/VideoResult";`。

**任务行**：把现有视频分支
```tsx
{item.result?.kind === "video" ? (
  <>
    <Image source={{ uri: item.result.posterUrl }} accessibilityLabel="视频封面" style={styles.media} />
    <Text>时长 {formatDuration(item.result.durationSeconds)}</Text>
  </>
) : null}
```
替换为：
```tsx
{item.result?.kind === "video" ? (
  <VideoResult uri={item.result.url} posterUrl={item.result.posterUrl} durationSeconds={item.result.durationSeconds} />
) : null}
```

**资产行**：把现有视频分支
```tsx
{item.content.kind === "video" ? (
  <>
    <Image source={{ uri: item.content.posterUrl }} accessibilityLabel="视频封面" style={styles.media} />
    <Text>时长 {formatDuration(item.content.durationSeconds)}</Text>
  </>
) : null}
```
替换为：
```tsx
{item.content.kind === "video" ? (
  <VideoResult uri={item.content.url} posterUrl={item.content.posterUrl} durationSeconds={item.content.durationSeconds} />
) : null}
```

图片分支（`Image` + `styles.media`）与文本分支不变。

## 数据流

`url`/`posterUrl` 是服务端托管 URL（Slice 11b 视频 provider）。`<Video>` 用 `usePoster` 显示 `posterSource` 直到用户点播放，`useNativeControls` 提供原生播放/暂停/进度控件。

## 错误处理

- 播放/加载失败由 expo-av 原生层处理；首版不额外 UI。
- `formatDuration` 对非有限/0/负值返回 `"0:00"`（Slice 17 既有行为）。

## 测试策略

- **无新单元测试**：`VideoResult` 与 `App.tsx` 均 typecheck-only（RN 组件不能在 vite-node 渲染）；`formatDuration` 已在 Slice 17 覆盖。
- 本切片自动化覆盖 = `pnpm typecheck` 通过 + 现有 mobile 测试（appModel 20 / tokenStore 3 / homeModel 4 / resultModel 2 = 29）无回归 + `pnpm test` 全绿。
- **真实播放需设备/模拟器手测**——这是 RN 播放器的固有限制，明确记录、超出本切片自动化范围。

## 文档

- README `### Mobile API Integration` 段落：视频从缩略图升级为内联播放（expo-av）。
- mvp-skeleton `## Mobile API Integration Slice` 段落补同上。

## 任务分解

1. **expo-av 依赖 + VideoResult 组件 + App.tsx 两处视频分支接入**（pnpm install + typecheck + 全量无回归）。
2. **文档**（README + mvp-skeleton）。

## 交付清单

- [ ] `expo-av ~14.0.7` 依赖
- [ ] `VideoResult.tsx`（Video + poster + 原生控件 + 时长）
- [ ] App.tsx 任务行 + 资产行接入 VideoResult、移除直接 formatDuration 引用
- [ ] 文档（README + mvp-skeleton）
- [ ] `pnpm test` + `pnpm typecheck` 全绿
