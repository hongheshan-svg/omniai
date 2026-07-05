# GW-LINK OmniAI 桌面工作台重设计规格

**日期**: 2026-07-05
**Slice**: 30 — 桌面端顶尖化重设计（三栏生成器工作台）

---

## 摘要

把桌面端从"管理后台式卡片堆叠"重构为行业顶尖形态的**三栏生成器工作台**（对标 Krea/Runway/Recraft）：左侧图标导航栏、中间结果画布 + 历史条 + 悬浮提示词条、右侧参数检查器。四个独立视图（创作/资产库/任务/账户）取代单屏堆叠；补齐全局 toast、快捷键、三态（空/加载/错误）、失败重试、分行业灵感模板。视觉升级为**深空科技感**设计系统（token 化 CSS、玻璃拟态、电光靛紫渐变、统一动效曲线）。**零新依赖、零 API 改动**——纯桌面前端切片，逻辑全部落在无框架 `*Model.ts` 模块中并配 vitest。

## 动机

当前 `App.tsx` 是 702 行单文件：登录 + 创作 + 任务 + 资产 + 套餐 + 订单全部堆在一屏卡片里，styles.css 仅 272 行基础深色样式。用户评价"太普通、不是想要的效果"。差距不在配色，而在**信息架构**：顶尖 AI 创作产品都是"作品为中心"的工作台，商务/管理功能收纳在独立视图，生成主流程有实时反馈和沉浸展示。

**非目标（留后续切片）**：

- mobile 端样式（下一切片，同一深色视觉语言）
- 亮色主题 / 明暗切换
- 真实进度百分比（API 不提供，生成中用不确定态流光骨架）
- 资产删除 / 重命名（无 API）
- 提示词历史、会话式多轮修改（对话流范式，未选）
- 新增任何后端参数或产品契约字段

## 设计

### 0. 既定决策（brainstorm 确认）

| 决策点 | 结论 |
| --- | --- |
| 交互范式 | 生成器工作台三栏布局（Krea/Runway 式） |
| 逻辑范围 | 资产库网格 + 任务中心升级 + 账户收纳 + 快捷键/动效 + 分行业提示词模板，全做 |
| 行业模板 | 内置分行业提示词模板（点击填入提示词条），不含预置示例作品 |
| 视觉基调 | 深空科技感（Linear/Runway 风：分层深空底、电光靛紫渐变点缀、玻璃面板） |
| 实现路线 | 零新依赖：手写 token 化 CSS 设计系统 + 组件化拆分；状态逻辑进无框架 Model 模块 |

### 1. 信息架构与视图

登录后进入工作台外壳：

```
┌──┬──────────────────────────────┬────────────┐
│图│  结果画布（大幅展示/骨架/模板墙）│  参数检查器  │
│标│  ┌─┐┌─┐┌─┐┌─┐  历史条         │ （仅创作视图）│
│导│ ┌──────────────────────────┐  │            │
│航│ │✦ 提示词条        [生成]   │  │            │
└──┴─┴──────────────────────────┴──┴────────────┘
```

- **IconRail（左，60px 常驻）**：logo、四个视图按钮（创作 / 资产库 / 任务 / 账户），任务按钮带进行中数量角标（queued+running）。
- **顶栏（slim）**：当前视图标题、点数余额徽章、会话 CTA（`Signed in as …`）、登出——保证会话相关测试锚点稳定。
- **StudioView（创作）**：
  - **ResultCanvas**：展示"当前选中任务"。无选中且无任务 → 分行业模板墙（TemplateGallery）；任务 queued/running → 骨架屏 + 流光 + 模型名；succeeded → 按 `result.kind` 渲染（text 精排版式 + 复制按钮、image `<img>` 全幅、video `<video controls>`），保留现有"保存到资产库"按钮；failed → 错误态 + 重试按钮。
  - **HistoryStrip**：最近 12 个任务缩略（按 createdAt 降序），image/video 用缩略图、text 用模式图标，点击选中到画布。
  - **PromptBar（底部悬浮，玻璃面板，max-width 720px 居中）**：模式胶囊组（文本/图片/视频，沿用 `aria-label="Studio modes"`）、自适应 textarea、"模板"按钮（清空画布选中以显示模板墙）、"优化"按钮（只预览优化结果）、点数预估、"生成"按钮。**"生成" = 一键完成**：若当前 prompt 尚无匹配的优化结果，先调 optimize 再 submit；已有则直接 submit。
  - **Inspector（右，300px）**：模型选择下拉（`/v1/models` 按当前模式过滤，选择覆盖 `preset.modelId`，默认跟随优化建议；每次新的优化结果返回时重置为优化建议值）、优化后提示词可编辑区、preset 参数只读展示（仅现有 `PresetSuggestion` 字段）、点数预估明细（优化前用所选模型 `creditUnitCost`，优化后用 `preset.creditEstimate`）。
- **AssetsView（资产库）**：类型筛选胶囊（全部/图片/视频/文本）+ 响应式网格；卡片悬停浮层（类型、时间）；点击打开**详情侧板**（大预览、title、prompt、optimizedPrompt、modelId、createdAt、下载链接/复制文本）；空状态引导去创作。
- **TasksView（任务）**：按状态分组（进行中 / 已完成 / 失败）；失败任务"重试"按钮 = `submitGeneration({ mode, prompt, optimizedPrompt, preset })`（字段全部来自任务自身）；点击任务跳转创作视图并选中到画布。保留现有 5 秒轮询。
- **AccountView（账户）**：登录身份卡、点数余额卡 + 充值入口、套餐购买（弹层流程：购买建单 → 显示"去支付"链接 + dev 完成按钮，沿用 Slice 29 语义）、订单列表 + 详情/收据导出（沿用 Slice 25/27 功能）。登出在顶栏。
- **AuthScreen（登录）**：沿用现有 passwordless 流程 + devCode 展示，视觉升级为深空玻璃卡片。

共享状态（session、tasks、assets、credits、orders、packages、toasts、当前视图、画布选中任务）由 `App.tsx` 持有，props 下传；不引入状态库/Context/路由库。

### 2. 文件结构与组件职责

```
apps/desktop/src/
  App.tsx                  # 外壳：客户端注入、会话、共享状态、视图路由、快捷键监听（目标 ≤250 行）
  navModel.ts              # 新增：视图枚举、快捷键映射、任务角标推导
  templatesModel.ts        # 新增：行业模板数据 + 查询函数
  toastModel.ts            # 新增：toast 队列纯函数
  studioModel.ts           # 保留（模式文案/优化模板）
  generationModel.ts / assetModel.ts / creditModel.ts / orderModel.ts / sessionModel.ts / tokenStore.ts  # 保留
  components/
    AuthScreen.tsx  IconRail.tsx  PromptBar.tsx  Inspector.tsx
    ResultCanvas.tsx  HistoryStrip.tsx  TemplateGallery.tsx  ToastHost.tsx
  views/
    StudioView.tsx  AssetsView.tsx  TasksView.tsx  AccountView.tsx
  styles.css               # 入口：@import ./styles/*.css
  styles/
    tokens.css  base.css  components.css  views.css
```

组件全部是**受控展示组件**：数据和回调经 props 传入，内部不发请求、不持久业务状态（局部 UI 态如"侧板开合"除外）。

### 3. 新增无框架模型模块（接口签名）

```ts
// navModel.ts
import type { GenerationTask } from "@gw-link-omniai/shared";

export type WorkspaceView = "studio" | "assets" | "tasks" | "account";

export interface WorkspaceNavItem {
  view: WorkspaceView;
  label: string; // 创作 / 资产库 / 任务 / 账户
}

export function getWorkspaceNavItems(): WorkspaceNavItem[];
export function viewForShortcutDigit(digit: string): WorkspaceView | null; // "1"→studio … "4"→account，其余 null
export function countActiveTasks(tasks: readonly GenerationTask[]): number; // status ∈ {queued, running}
```

```ts
// templatesModel.ts
import type { CreationMode } from "@gw-link-omniai/shared";

export interface IndustryTemplate {
  id: string;          // 如 "ecommerce-product-shot"
  industry: string;    // 电商 / 广告 / 建筑 / 游戏 / 影视 / 时尚
  title: string;       // 卡片标题
  prompt: string;      // 点击后填入提示词条的完整中文提示词
  mode: CreationMode;  // 点击后同步切换的创作模式
}

export function getIndustryTemplates(): IndustryTemplate[]; // ≥12 个，6 行业每行业 ≥2 个，克隆返回
export function listIndustries(): string[];                 // 按内置顺序去重
export function templatesForIndustry(industry: string): IndustryTemplate[];
```

```ts
// toastModel.ts
export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: string; // ISO
}

export const TOAST_TTL_MS = 5000;
export const MAX_TOASTS = 5;

export function pushToast(toasts: readonly Toast[], toast: Toast): Toast[];      // 追加，超过 MAX_TOASTS 丢最旧
export function expireToasts(toasts: readonly Toast[], nowIso: string): Toast[]; // 移除 createdAt+TTL ≤ now 的
export function dismissToast(toasts: readonly Toast[], id: string): Toast[];
```

全部纯函数、不可变返回（与仓库 Model 惯例一致）；React 侧由 App 持 `toasts` state，1 秒 interval 调 `expireToasts`。

### 4. 视觉系统 token（styles/tokens.css）

```css
:root {
  /* 分层背景 */
  --bg-0: #07080d;  --bg-1: #0c0e16;  --bg-2: #12151f;
  --glass: rgba(18, 21, 31, 0.6);          /* 配 backdrop-filter: blur(20px) */
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  /* 文字三级 */
  --text-1: #f2f4f8;  --text-2: #9aa3b5;  --text-3: #5c6478;
  /* 强调（只用于 CTA、激活态、光晕） */
  --accent: #818cf8;
  --accent-grad: linear-gradient(135deg, #6366f1, #a855f7);
  --glow: 0 0 24px rgba(124, 108, 255, 0.35);
  /* 语义色（沿用） */
  --success: #34d399;  --warn: #fbbf24;  --danger: #f87171;
  /* 几何与动效 */
  --r-sm: 10px;  --r-md: 14px;  --r-lg: 20px;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --t-fast: 120ms;  --t-med: 200ms;  --t-slow: 320ms;
}
```

- **背景**：`--bg-0` 底 + 两团固定低透明度径向光晕（左上靛蓝、右下紫），营造星云纵深；不用图片资源。
- **玻璃拟态**：PromptBar、Inspector、侧板、弹层用 `--glass` + `backdrop-filter`（Tauri WKWebView 原生支持）。
- **排版**：现有字体栈（PingFang SC 等）；标题收紧字距；点数/金额 `font-variant-numeric: tabular-nums`。
- **微交互**：按钮按压 `scale(0.98)`、悬停浮起 + 边框提亮、面板/侧板滑入、骨架流光 keyframes、toast 右上滑入、结果落位淡入、全局 `:focus-visible` 焦点环（`--accent`）。
- 渐变与光晕**克制使用**：只出现在生成按钮、激活导航项、进行中状态和登录卡 logo。

### 5. 交互逻辑细则

- **全局 toast（右上角）**：轮询检测到任务 `succeeded`（"生成完成"）/`failed`（"生成失败"）、购买建单成功、dev 支付完成、收据已复制、API 错误（`ApiError.message`）。
- **快捷键**（App 全局 keydown）：`Cmd/Ctrl+Enter`（焦点在提示词输入框时）= 生成；`Cmd/Ctrl+1..4` = 切视图（经 `viewForShortcutDigit`）；`Esc` = 关闭资产详情侧板 / 购买弹层。除以上组合外不拦截输入框按键。
- **三态**：四个视图各自定义空状态（含行动引导）；加载骨架用于生成中画布（流光），余额等零散数据用占位文案；用户数据加载失败显示错误横幅 + 「重新加载」。
- **生成主流程**：提示词条"生成"一键 optimize+submit → 任务立即出现在画布（骨架）+ 历史条 + 任务角标 → 轮询更新 → 完成后画布自动展示结果 + toast。画布"当前选中任务"默认跟随最新提交的任务。
- **认证失效**：API 返回 401 时清除会话回登录屏（沿用现有行为）。

### 6. 测试策略与锚点

- **新增模型测试**：`navModel.test.ts`（导航项、快捷键映射、角标计数）、`templatesModel.test.ts`（数量/行业覆盖/克隆隔离/查询）、`toastModel.test.ts`（追加上限、过期、dismiss、不可变性）。
- **组件测试**：现有 38 个桌面测试按新信息架构更新，业务流程全保留（登录、优化+提交、资产保存/列表、套餐购买、订单/收据）；涉及非创作视图的流程先点击对应导航按钮。新增用例：视图切换（点击 + 快捷键）、模板点击填入提示词并切模式、失败任务重试、任务完成 toast、资产详情侧板开合。
- **稳定测试锚点**（实现时不得破坏）：导航按钮可访问名 `创作/资产库/任务/账户`；IconRail `aria-label="Workspace views"`；模式胶囊组沿用 `aria-label="Studio modes"`；生成按钮可访问名 `生成`；toast 容器 `role="status"`。
- **验收**：`pnpm --filter @gw-link-omniai/desktop test` 全绿（预期 50+）、`typecheck` 干净、`package.json` 无新增依赖、API/shared 零改动、对本地 API（:8787）全流程可用。

### 7. Git 策略

- 分支 `implement/desktop-studio-redesign`，从当前 main 工作树出发。
- 当前未提交改动的处理：Tauri 图标重生成（修复启动 panic 的独立问题）单独作 chore commit；现有 styles.css/App.tsx/main.tsx 未提交样式作为重设计起点吸收进本分支首个任务，随重构被替换。
- 每任务 TDD + 单独 commit；完成后 final review → `--no-ff` 合并 main → fetch 核对分歧后推送。

## 成功标准

1. 桌面端呈现三栏生成器工作台，四视图独立、商务功能全部收纳进账户视图。
2. 生成主流程一键完成且全程有实时反馈（骨架/角标/toast/自动落位）。
3. 深空科技感设计系统落地：token 化、玻璃面板、统一动效，无新依赖。
4. 分行业模板 ≥12 个、6 行业，点击即可开始创作。
5. 桌面测试 50+ 全绿、typecheck 干净、API 与 shared 契约零改动。
