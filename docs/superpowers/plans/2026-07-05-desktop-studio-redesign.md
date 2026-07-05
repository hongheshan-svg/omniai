# Desktop Studio Redesign Implementation Plan (Slice 30)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面端重构为三栏生成器工作台（图标导航 + 结果画布/提示词条 + 参数检查器），四视图（创作/资产库/任务/账户）、深空科技感设计系统、一键生成流、全局 toast、快捷键、分行业模板——零新依赖、零 API/shared 改动。

**Architecture:** `App.tsx`（702 行单文件）拆为外壳 + `components/` + `views/`；新增无框架模块 `navModel.ts` / `templatesModel.ts` / `toastModel.ts`（纯函数 + vitest）；`styles.css` 变为入口，@import `styles/` 下 tokens/base/components/views 四个文件。共享状态由 App 持有 props 下传，不引入状态库/路由库。

**Tech Stack:** React 18 + Vite + Tauri 2（现有），vitest + @testing-library/react（现有），纯 CSS（无 Tailwind/组件库）。

**Spec:** `docs/superpowers/specs/2026-07-05-gw-link-omniai-desktop-studio-redesign-design.md`

## Global Constraints

- **零新依赖**：`apps/desktop/package.json` 的 dependencies/devDependencies 不得变更。
- **零后端改动**：`apps/api`、`packages/shared` 不得修改（desktop 只消费现有契约）。
- **稳定测试锚点**（不得破坏）：导航按钮可访问名 `创作`/`资产库`/`任务`/`账户`；IconRail 导航 `aria-label="Workspace views"`；模式胶囊组 `aria-label="Studio modes"`；生成按钮可访问名 `生成`；优化按钮可访问名 `优化提示词`；toast 容器 `aria-label="通知"`；登录锚点 `登录邮箱或手机号`/`发送验证码`/`登录`/`开发验证码：`；会话 CTA `Signed in as creator`（来自 getDesktopSessionCta）。
- **Model 模块惯例**：新模块是无框架纯函数，返回值克隆/不可变（不外泄内部引用）。
- **UI 文案中文，代码/注释/commit 英文**；commit 末尾必须带 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 每个任务结束时 `pnpm --filter @gw-link-omniai/desktop test` 与 `pnpm --filter @gw-link-omniai/desktop typecheck` 必须全绿。
- 分支：`implement/desktop-studio-redesign`（从 main 当前工作树创建；工作树里有未提交改动，Task 1 先收编为 baseline commits）。
- 测试运行命令格式：`pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`（单文件）。

## File Map（全景）

| 文件 | 职责 | 任务 |
| --- | --- | --- |
| `src/navModel.ts` (新) | 视图枚举、导航项、快捷键映射、活跃任务计数 | 1 |
| `src/generationModel.ts` (改) | 新增 `selectActiveTaskIds`（queued+running） | 1 |
| `src/templatesModel.ts` (新) | 12 个分行业提示词模板 + 查询 | 2 |
| `src/toastModel.ts` (新) | toast 队列纯函数 | 3 |
| `src/styles.css` (改) + `src/styles/{tokens,base,components,views}.css` (新) | 深空设计系统 | 4 |
| `src/components/AuthScreen.tsx` (新) | 登录屏 | 5 |
| `src/components/IconRail.tsx` (新) | 左侧图标导航 | 6 |
| `src/views/{StudioView,AssetsView,TasksView,AccountView}.tsx` (新) | 四视图 | 6-12 |
| `src/components/{PromptBar,ResultCanvas}.tsx` (新) | 提示词条、结果画布 | 7 |
| `src/components/Inspector.tsx` (新) | 参数检查器 | 8 |
| `src/components/{TemplateGallery,HistoryStrip}.tsx` (新) | 模板墙、历史条 | 9 |
| `src/components/ToastHost.tsx` (新) | 全局通知 | 13 |
| `src/App.tsx` (改) | 外壳：状态 + 路由 + 快捷键 | 5-13 |
| `src/__tests__/*.test.ts(x)` | 各任务同步更新 | 全部 |

---

### Task 1: Baseline commits + navModel + selectActiveTaskIds

工作树里有上一轮遗留的未提交改动，先收编成两个 baseline commits，然后 TDD 实现 navModel。

**Files:**
- Commit（已存在于工作树）: `apps/desktop/src-tauri/icons/*`（重新生成的全套图标，修复启动 panic）
- Commit（已存在于工作树）: `apps/desktop/src/styles.css`、`apps/desktop/src/App.tsx`、`apps/desktop/src/main.tsx`（过渡期深色样式，将被本切片替换）
- Create: `apps/desktop/src/navModel.ts`
- Modify: `apps/desktop/src/generationModel.ts`（文件末尾追加一个函数）
- Test: `apps/desktop/src/__tests__/navModel.test.ts`、`apps/desktop/src/__tests__/generationModel.test.ts`（追加）

**Interfaces:**
- Produces: `type WorkspaceView = "studio" | "assets" | "tasks" | "account"`；`getWorkspaceNavItems(): WorkspaceNavItem[]`（4 项，label 创作/资产库/任务/账户）；`viewForShortcutDigit(digit: string): WorkspaceView | null`；`countActiveTasks(tasks: readonly GenerationTask[]): number`；`selectActiveTaskIds(tasks: GenerationTask[]): string[]`（generationModel）。

- [ ] **Step 1: Baseline commits**

```bash
cd /Users/zhengshan/projects/gw-link-image-video
git checkout -b implement/desktop-studio-redesign
git add apps/desktop/src-tauri/icons/
git commit -m "chore(desktop): regenerate tauri icon set to fix malformed icon startup panic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git add apps/desktop/src/styles.css apps/desktop/src/App.tsx apps/desktop/src/main.tsx
git commit -m "feat(desktop): interim dark styling baseline (superseded by studio redesign)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

预期：两个 commit 成功；`git status` 中 apps/desktop 下无未跟踪/未暂存文件。

- [ ] **Step 2: Write failing tests**

新建 `apps/desktop/src/__tests__/navModel.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { GenerationTask } from "@gw-link-omniai/shared";
import { countActiveTasks, getWorkspaceNavItems, viewForShortcutDigit } from "../navModel";

function makeTask(id: string, status: GenerationTask["status"]): GenerationTask {
  return {
    id,
    mode: "text",
    status,
    prompt: "p",
    optimizedPrompt: "op",
    preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
    resultPreview: { title: "t", description: "d" },
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:00.000Z"
  };
}

describe("navModel", () => {
  it("lists the four workspace views in order", () => {
    const items = getWorkspaceNavItems();
    expect(items.map((item) => item.view)).toEqual(["studio", "assets", "tasks", "account"]);
    expect(items.map((item) => item.label)).toEqual(["创作", "资产库", "任务", "账户"]);
  });

  it("returns cloned nav items", () => {
    const first = getWorkspaceNavItems();
    first[0].label = "mutated";
    expect(getWorkspaceNavItems()[0].label).toBe("创作");
  });

  it("maps shortcut digits 1-4 to views and rejects others", () => {
    expect(viewForShortcutDigit("1")).toBe("studio");
    expect(viewForShortcutDigit("2")).toBe("assets");
    expect(viewForShortcutDigit("3")).toBe("tasks");
    expect(viewForShortcutDigit("4")).toBe("account");
    expect(viewForShortcutDigit("5")).toBeNull();
    expect(viewForShortcutDigit("a")).toBeNull();
  });

  it("counts queued and running tasks as active", () => {
    const tasks = [
      makeTask("t1", "queued"),
      makeTask("t2", "running"),
      makeTask("t3", "succeeded"),
      makeTask("t4", "failed")
    ];
    expect(countActiveTasks(tasks)).toBe(2);
    expect(countActiveTasks([])).toBe(0);
  });
});
```

在 `apps/desktop/src/__tests__/generationModel.test.ts` 现有 describe 内追加：

```ts
  it("selects queued and running task ids as active", () => {
    const tasks = [
      makeTask("g1", "queued"),
      makeTask("g2", "running"),
      makeTask("g3", "succeeded")
    ];
    expect(selectActiveTaskIds(tasks)).toEqual(["g1", "g2"]);
  });
```

（若该测试文件没有 `makeTask` 辅助函数，按其现有构造任务的方式内联构造两个不同 status 的任务；import 行加入 `selectActiveTaskIds`。）

- [ ] **Step 3: Run tests to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/navModel.test.ts src/__tests__/generationModel.test.ts`
Expected: FAIL — `Cannot find module '../navModel'`、`selectActiveTaskIds is not a function`。

- [ ] **Step 4: Implement**

新建 `apps/desktop/src/navModel.ts`：

```ts
import type { GenerationTask } from "@gw-link-omniai/shared";

export type WorkspaceView = "studio" | "assets" | "tasks" | "account";

export interface WorkspaceNavItem {
  view: WorkspaceView;
  label: string;
}

const navItems: WorkspaceNavItem[] = [
  { view: "studio", label: "创作" },
  { view: "assets", label: "资产库" },
  { view: "tasks", label: "任务" },
  { view: "account", label: "账户" }
];

const shortcutViews: Record<string, WorkspaceView> = {
  "1": "studio",
  "2": "assets",
  "3": "tasks",
  "4": "account"
};

export function getWorkspaceNavItems(): WorkspaceNavItem[] {
  return navItems.map((item) => ({ ...item }));
}

export function viewForShortcutDigit(digit: string): WorkspaceView | null {
  return shortcutViews[digit] ?? null;
}

export function countActiveTasks(tasks: readonly GenerationTask[]): number {
  return tasks.filter((task) => task.status === "queued" || task.status === "running").length;
}
```

在 `apps/desktop/src/generationModel.ts` 末尾追加：

```ts
export function selectActiveTaskIds(tasks: GenerationTask[]): string[] {
  return tasks
    .filter((task) => task.status === "queued" || task.status === "running")
    .map((task) => task.id);
}
```

- [ ] **Step 5: Run tests to verify pass + full suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿（38 + 5 个新用例）。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/navModel.ts apps/desktop/src/generationModel.ts apps/desktop/src/__tests__/navModel.test.ts apps/desktop/src/__tests__/generationModel.test.ts
git commit -m "feat(desktop): add navModel (workspace views, shortcuts, active count) and selectActiveTaskIds

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: templatesModel（分行业提示词模板）

**Files:**
- Create: `apps/desktop/src/templatesModel.ts`
- Test: `apps/desktop/src/__tests__/templatesModel.test.ts`

**Interfaces:**
- Produces: `interface IndustryTemplate { id: string; industry: string; title: string; prompt: string; mode: CreationMode }`；`getIndustryTemplates(): IndustryTemplate[]`（12 个，6 行业 × 2）；`listIndustries(): string[]`（去重保序）；`templatesForIndustry(industry: string): IndustryTemplate[]`。

- [ ] **Step 1: Write failing test**

新建 `apps/desktop/src/__tests__/templatesModel.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { getIndustryTemplates, listIndustries, templatesForIndustry } from "../templatesModel";

describe("templatesModel", () => {
  it("provides at least 12 templates across 6 industries, 2+ each", () => {
    const templates = getIndustryTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(12);
    const industries = listIndustries();
    expect(industries).toEqual(["电商", "广告", "建筑", "游戏", "影视", "时尚"]);
    for (const industry of industries) {
      expect(templatesForIndustry(industry).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every template an id, title, non-trivial prompt and valid mode", () => {
    for (const template of getIndustryTemplates()) {
      expect(template.id).toMatch(/^[a-z0-9-]+$/);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.prompt.length).toBeGreaterThan(20);
      expect(["text", "image", "video"]).toContain(template.mode);
    }
  });

  it("has unique template ids", () => {
    const ids = getIndustryTemplates().map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns clones so callers cannot mutate internal data", () => {
    getIndustryTemplates()[0].title = "mutated";
    expect(getIndustryTemplates()[0].title).not.toBe("mutated");
    templatesForIndustry("电商")[0].prompt = "mutated";
    expect(templatesForIndustry("电商")[0].prompt).not.toBe("mutated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/templatesModel.test.ts`
Expected: FAIL — `Cannot find module '../templatesModel'`。

- [ ] **Step 3: Implement**

新建 `apps/desktop/src/templatesModel.ts`（提示词文案按下方原文使用，不要缩写）：

```ts
import type { CreationMode } from "@gw-link-omniai/shared";

export interface IndustryTemplate {
  id: string;
  industry: string;
  title: string;
  prompt: string;
  mode: CreationMode;
}

const industryTemplates: IndustryTemplate[] = [
  {
    id: "ecommerce-product-shot",
    industry: "电商",
    title: "产品主图",
    mode: "image",
    prompt: "为一款陶瓷咖啡杯拍摄电商主图：纯色浅灰背景，柔和顶光，45 度俯拍，突出釉面质感，构图居中留白，适合电商平台展示。"
  },
  {
    id: "ecommerce-detail-copy",
    industry: "电商",
    title: "详情页卖点文案",
    mode: "text",
    prompt: "为一款便携式榨汁杯写电商详情页文案：提炼 3 个核心卖点，每个卖点一句主标题加两行说明，语气清新有活力，结尾附一句促购语。"
  },
  {
    id: "ad-summer-poster",
    industry: "广告",
    title: "品牌活动海报",
    mode: "image",
    prompt: "设计一张夏日冰咖啡促销海报：冷色调蓝绿背景，杯身结霜特写，冰块飞溅动感，顶部留出标题区域，整体风格清爽通透。"
  },
  {
    id: "ad-15s-spot",
    industry: "广告",
    title: "15 秒广告短片",
    mode: "video",
    prompt: "生成一段 15 秒运动鞋广告短片：清晨城市街道，跑者由远及近，特写鞋底缓震形变，镜头随步伐节奏切换，结尾定格产品侧面。"
  },
  {
    id: "arch-exterior-render",
    industry: "建筑",
    title: "建筑外观效果图",
    mode: "image",
    prompt: "渲染一栋滨水文化中心的外观效果图：流线型白色曲面屋顶，大面积玻璃幕墙，黄昏暖光，水面倒影，写实建筑摄影风格。"
  },
  {
    id: "arch-interior-walkthrough",
    industry: "建筑",
    title: "室内漫游镜头",
    mode: "video",
    prompt: "生成一段现代美术馆室内漫游视频：镜头缓慢推进穿过挑高中庭，自然天光从天窗洒下，白色墙面与木质地板，运镜平稳克制。"
  },
  {
    id: "game-character-art",
    industry: "游戏",
    title: "角色原画",
    mode: "image",
    prompt: "绘制一名东方玄幻风格的剑客角色原画：青灰长袍，腰间古剑，姿态沉静立于山崖，水墨质感笔触，背景大面积留白。"
  },
  {
    id: "game-scene-concept",
    industry: "游戏",
    title: "场景概念图",
    mode: "image",
    prompt: "绘制一张废弃太空站内部的游戏场景概念图：冷蓝应急灯光，漂浮杂物，远处舷窗外是星云，氛围紧张神秘，电影感构图。"
  },
  {
    id: "film-storyboard-script",
    industry: "影视",
    title: "分镜头脚本",
    mode: "text",
    prompt: "为一支 60 秒城市夜景短片写分镜头脚本：按镜号列出景别、运镜、画面内容和时长，共 8 个镜头，风格孤独而温柔。"
  },
  {
    id: "film-concept-clip",
    industry: "影视",
    title: "概念场景短片",
    mode: "video",
    prompt: "生成一段雨夜霓虹街道的电影概念短片：手持镜头缓慢横移，雨滴在镜头前虚化成光斑，行人撑伞剪影，赛博朋克色调。"
  },
  {
    id: "fashion-lookbook",
    industry: "时尚",
    title: "服装大片",
    mode: "image",
    prompt: "拍摄一组秋冬羊绒大衣时尚大片：模特站在清晨雾气弥漫的街头，驼色大衣配同色系围巾，胶片颗粒质感，低饱和色调。"
  },
  {
    id: "fashion-launch-copy",
    industry: "时尚",
    title: "新品发布文案",
    mode: "text",
    prompt: "为一个小众设计师品牌的秋冬新品系列写发布文案：主题围绕「城市漫游者」，一段品牌叙事加三句单品亮点，语气克制高级。"
  }
];

export function getIndustryTemplates(): IndustryTemplate[] {
  return industryTemplates.map((template) => ({ ...template }));
}

export function listIndustries(): string[] {
  return [...new Set(industryTemplates.map((template) => template.industry))];
}

export function templatesForIndustry(industry: string): IndustryTemplate[] {
  return industryTemplates
    .filter((template) => template.industry === industry)
    .map((template) => ({ ...template }));
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/templatesModel.ts apps/desktop/src/__tests__/templatesModel.test.ts
git commit -m "feat(desktop): add industry prompt templates model (6 industries, 12 templates)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: toastModel（通知队列）

**Files:**
- Create: `apps/desktop/src/toastModel.ts`
- Test: `apps/desktop/src/__tests__/toastModel.test.ts`

**Interfaces:**
- Produces: `type ToastKind = "success" | "error" | "info"`；`interface Toast { id: string; kind: ToastKind; message: string; createdAt: string }`；`TOAST_TTL_MS = 5000`；`MAX_TOASTS = 5`；`pushToast(toasts, toast): Toast[]`；`expireToasts(toasts, nowIso): Toast[]`；`dismissToast(toasts, id): Toast[]`。

- [ ] **Step 1: Write failing test**

新建 `apps/desktop/src/__tests__/toastModel.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { MAX_TOASTS, TOAST_TTL_MS, dismissToast, expireToasts, pushToast, type Toast } from "../toastModel";

function makeToast(id: string, createdAt = "2026-07-05T00:00:00.000Z"): Toast {
  return { id, kind: "info", message: `msg-${id}`, createdAt };
}

describe("toastModel", () => {
  it("appends a toast without mutating the input", () => {
    const initial: Toast[] = [makeToast("t1")];
    const next = pushToast(initial, makeToast("t2"));
    expect(next.map((toast) => toast.id)).toEqual(["t1", "t2"]);
    expect(initial).toHaveLength(1);
  });

  it("drops the oldest toast beyond MAX_TOASTS", () => {
    let toasts: Toast[] = [];
    for (let index = 1; index <= MAX_TOASTS + 2; index += 1) {
      toasts = pushToast(toasts, makeToast(`t${index}`));
    }
    expect(toasts).toHaveLength(MAX_TOASTS);
    expect(toasts[0].id).toBe("t3");
  });

  it("expires toasts older than TOAST_TTL_MS", () => {
    const base = Date.parse("2026-07-05T00:00:00.000Z");
    const fresh = makeToast("fresh", new Date(base + 4000).toISOString());
    const stale = makeToast("stale", new Date(base).toISOString());
    const now = new Date(base + TOAST_TTL_MS).toISOString();
    expect(expireToasts([stale, fresh], now).map((toast) => toast.id)).toEqual(["fresh"]);
  });

  it("dismisses a toast by id", () => {
    const toasts = [makeToast("t1"), makeToast("t2")];
    expect(dismissToast(toasts, "t1").map((toast) => toast.id)).toEqual(["t2"]);
    expect(dismissToast(toasts, "missing")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/toastModel.test.ts`
Expected: FAIL — `Cannot find module '../toastModel'`。

- [ ] **Step 3: Implement**

新建 `apps/desktop/src/toastModel.ts`：

```ts
export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: string;
}

export const TOAST_TTL_MS = 5000;
export const MAX_TOASTS = 5;

export function pushToast(toasts: readonly Toast[], toast: Toast): Toast[] {
  const next = [...toasts, toast];
  return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
}

export function expireToasts(toasts: readonly Toast[], nowIso: string): Toast[] {
  const now = Date.parse(nowIso);
  return toasts.filter((toast) => Date.parse(toast.createdAt) + TOAST_TTL_MS > now);
}

export function dismissToast(toasts: readonly Toast[], id: string): Toast[] {
  return toasts.filter((toast) => toast.id !== id);
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/toastModel.ts apps/desktop/src/__tests__/toastModel.test.ts
git commit -m "feat(desktop): add toast queue model (push cap, ttl expiry, dismiss)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 深空设计系统 CSS

纯 CSS 任务：建立 token 化设计系统。此任务后 App 仍是旧结构（部分旧类名失效导致过渡期视觉不完整是预期的），测试不受影响。

**Files:**
- Create: `apps/desktop/src/styles/tokens.css`、`apps/desktop/src/styles/base.css`、`apps/desktop/src/styles/components.css`、`apps/desktop/src/styles/views.css`
- Modify: `apps/desktop/src/styles.css`（整体替换为 4 行 @import 入口）

**Interfaces:**
- Produces（后续任务使用的类名，不得改名）: 布局 `.workspace .rail .rail-nav .rail-label .badge .main .topbar .spacer .view`；创作 `.studio .studio-center .canvas .canvas-empty .canvas-result .canvas-text .canvas-media .canvas-skeleton .canvas-failed .shimmer .history .thumb .prompt-dock .prompt-bar .mode-pills .prompt-input .prompt-actions .estimate .inspector .inspector-section`；模板 `.template-industry .template-grid .template-card`；资产 `.asset-toolbar .filters .asset-grid .asset-card .asset-thumb .asset-overlay .asset-panel .panel-close`；任务 `.task-groups .task-group .task-row`；账户 `.account-grid .card .pkg .pkg-meta .pkg-price .receipt .detail .modal-backdrop .modal`；登录 `.auth .auth-card .auth-brand .logo .sub .sent .devcode`；通用 `.btn .btn-primary .btn-ghost .btn-sm .chip .spark .user-btn .field .stack .row .actions .alert .alert--error .alert--ok .empty .muted .status .status--{queued,running,succeeded,failed,paid,pending} .toasts .toast .toast--{success,error,info} .skeleton-line .items .item`。

- [ ] **Step 1: Write `styles/tokens.css`**

```css
:root {
  /* layered depth */
  --bg-0: #07080d;
  --bg-1: #0c0e16;
  --bg-2: #12151f;
  --bg-3: #191d2b;
  --glass: rgba(18, 21, 31, 0.6);
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);

  /* text hierarchy */
  --text-1: #f2f4f8;
  --text-2: #9aa3b5;
  --text-3: #5c6478;

  /* accent — CTA, active states, glow only */
  --accent: #818cf8;
  --accent-grad: linear-gradient(135deg, #6366f1, #a855f7);
  --glow: 0 0 24px rgba(124, 108, 255, 0.35);

  /* semantics */
  --success: #34d399;
  --warn: #fbbf24;
  --danger: #f87171;

  /* geometry & motion */
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 20px;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --t-fast: 120ms;
  --t-med: 200ms;
  --t-slow: 320ms;

  --font:
    -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
}
```

- [ ] **Step 2: Write `styles/base.css`**

```css
* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-1);
  background-color: var(--bg-0);
  background-image:
    radial-gradient(1200px 800px at -10% -20%, rgba(99, 102, 241, 0.14), transparent 60%),
    radial-gradient(1000px 700px at 110% 120%, rgba(168, 85, 247, 0.1), transparent 60%);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}

h1,
h2,
h3,
h4 {
  margin: 0;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-1);
}

h1 { font-size: 17px; }
h2 { font-size: 15px; }
h3 { font-size: 14px; }

p {
  margin: 0;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

ul,
ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

img,
video {
  max-width: 100%;
  border-radius: var(--r-sm);
  display: block;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}

::-webkit-scrollbar-track {
  background: transparent;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.muted {
  color: var(--text-3);
  font-size: 12px;
}

.empty {
  color: var(--text-3);
  padding: 28px 0;
  text-align: center;
}

.spacer {
  flex: 1;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  align-items: center;
}

@keyframes shimmer {
  from { background-position: -400px 0; }
  to { background-position: 400px 0; }
}

@keyframes fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(16px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 12px rgba(124, 108, 255, 0.2); }
  50% { box-shadow: 0 0 28px rgba(124, 108, 255, 0.45); }
}
```

- [ ] **Step 3: Write `styles/components.css`**

```css
/* ---- buttons ---- */
button {
  font-family: var(--font);
  cursor: pointer;
}

.btn,
.btn-sm,
.btn-ghost,
.user-btn {
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-1);
  border-radius: var(--r-sm);
  padding: 8px 14px;
  font-size: 13px;
  transition:
    transform var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}

.btn-sm {
  padding: 5px 10px;
  font-size: 12px;
}

.btn:hover,
.btn-sm:hover,
.btn-ghost:hover,
.user-btn:hover {
  border-color: var(--border-strong);
  background: var(--bg-3);
}

.btn:active,
.btn-sm:active,
.btn-primary:active {
  transform: scale(0.98);
}

.btn-ghost {
  background: transparent;
}

.btn-primary {
  border: none;
  background: var(--accent-grad);
  color: #fff;
  font-weight: 600;
  border-radius: var(--r-sm);
  padding: 9px 18px;
  font-size: 13px;
  box-shadow: var(--glow);
  transition:
    transform var(--t-fast) var(--ease),
    filter var(--t-fast) var(--ease);
}

.btn-primary:hover {
  filter: brightness(1.1);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

/* ---- form fields ---- */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 12px;
  color: var(--text-2);
}

input,
textarea,
select {
  font-family: var(--font);
  font-size: 13px;
  color: var(--text-1);
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 9px 12px;
  transition: border-color var(--t-fast) var(--ease);
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: var(--accent);
}

textarea {
  resize: vertical;
  min-height: 64px;
}

/* ---- chips & status ---- */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.spark {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent-grad);
  box-shadow: 0 0 8px rgba(124, 108, 255, 0.6);
}

.status {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.status--queued { background: rgba(251, 191, 36, 0.12); color: var(--warn); }
.status--running { background: rgba(129, 140, 248, 0.14); color: var(--accent); animation: pulse-glow 2s infinite; }
.status--succeeded,
.status--paid { background: rgba(52, 211, 153, 0.12); color: var(--success); }
.status--failed { background: rgba(248, 113, 113, 0.12); color: var(--danger); }
.status--pending { background: rgba(251, 191, 36, 0.12); color: var(--warn); }

/* ---- surfaces ---- */
.item {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-2);
  padding: 14px;
  transition: border-color var(--t-fast) var(--ease);
}

.item:hover {
  border-color: var(--border-strong);
}

.items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  padding: 18px;
}

/* ---- alerts ---- */
.alert {
  border-radius: var(--r-sm);
  padding: 10px 14px;
  font-size: 13px;
  border: 1px solid transparent;
}

.alert--error {
  background: rgba(248, 113, 113, 0.1);
  border-color: rgba(248, 113, 113, 0.3);
  color: var(--danger);
}

.alert--ok {
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.3);
  color: var(--success);
}

/* ---- skeleton ---- */
.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: var(--bg-3);
}

.shimmer {
  background-image: linear-gradient(
    90deg,
    var(--bg-3) 0%,
    rgba(129, 140, 248, 0.18) 50%,
    var(--bg-3) 100%
  );
  background-size: 400px 100%;
  animation: shimmer 1.4s linear infinite;
}

/* ---- modal ---- */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 5, 9, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}

.modal {
  width: min(520px, calc(100vw - 48px));
  max-height: 80vh;
  overflow-y: auto;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-lg);
  background: var(--glass);
  backdrop-filter: blur(20px);
  padding: 22px;
  animation: fade-up var(--t-med) var(--ease);
}

/* ---- toasts ---- */
.toasts {
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 80;
  width: 300px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: var(--r-md);
  border: 1px solid var(--border-strong);
  background: var(--glass);
  backdrop-filter: blur(20px);
  padding: 10px 14px;
  font-size: 13px;
  animation: slide-in-right var(--t-med) var(--ease);
}

.toast--success { border-left: 3px solid var(--success); }
.toast--error { border-left: 3px solid var(--danger); }
.toast--info { border-left: 3px solid var(--accent); }

.toast button {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-3);
  font-size: 14px;
  padding: 0 2px;
}

/* ---- receipt / detail ---- */
.receipt {
  margin: 10px 0 0;
  display: grid;
  gap: 6px;
}

.receipt div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.receipt dt { color: var(--text-3); }
.receipt dd { margin: 0; font-variant-numeric: tabular-nums; }

.detail {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
  display: grid;
  gap: 4px;
  font-size: 13px;
  color: var(--text-2);
}
```

- [ ] **Step 4: Write `styles/views.css`**

```css
/* ================= workspace shell ================= */
.workspace {
  display: grid;
  grid-template-columns: 64px 1fr;
  height: 100vh;
  overflow: hidden;
}

.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 16px 8px;
  border-right: 1px solid var(--border);
  background: var(--bg-1);
}

.rail .logo {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--accent-grad);
  box-shadow: var(--glow);
}

.rail-nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.rail-nav button {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 100%;
  padding: 9px 0 7px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  transition:
    color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}

.rail-nav button:hover {
  color: var(--text-1);
  background: var(--bg-2);
}

.rail-nav button[aria-pressed="true"] {
  color: var(--text-1);
  background: var(--bg-2);
  box-shadow: inset 2px 0 0 var(--accent);
}

.rail-nav svg {
  width: 18px;
  height: 18px;
}

.rail-label {
  font-size: 10px;
  letter-spacing: 0.04em;
}

.badge {
  position: absolute;
  top: 4px;
  right: 10px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent-grad);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 22px;
  border-bottom: 1px solid var(--border);
  background: rgba(12, 14, 22, 0.7);
  backdrop-filter: blur(14px);
}

.view {
  flex: 1;
  overflow-y: auto;
  padding: 22px;
  animation: fade-up var(--t-med) var(--ease);
}

/* ================= studio ================= */
.studio {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  height: 100%;
}

.studio-center {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.canvas {
  flex: 1;
  min-height: 320px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-1);
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.canvas-result {
  animation: fade-up var(--t-slow) var(--ease);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.canvas-text {
  font-size: 15px;
  line-height: 1.9;
  white-space: pre-wrap;
  color: var(--text-1);
}

.canvas-media img,
.canvas-media video {
  max-height: 52vh;
  margin: 0 auto;
  border-radius: var(--r-md);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.canvas-skeleton {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
}

.canvas-skeleton .skeleton-line:nth-child(1) { width: 40%; }
.canvas-skeleton .skeleton-line:nth-child(2) { width: 85%; }
.canvas-skeleton .skeleton-line:nth-child(3) { width: 70%; }

.canvas-failed,
.canvas-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-3);
  text-align: center;
}

.history {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.history button {
  flex: 0 0 auto;
  width: 72px;
  height: 54px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text-3);
  font-size: 11px;
  overflow: hidden;
  padding: 0;
  transition: border-color var(--t-fast) var(--ease);
}

.history button[aria-pressed="true"] {
  border-color: var(--accent);
}

.history .thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 0;
}

.prompt-dock {
  display: flex;
  justify-content: center;
}

.prompt-bar {
  width: min(720px, 100%);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-lg);
  background: var(--glass);
  backdrop-filter: blur(20px);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}

.mode-pills {
  display: flex;
  gap: 6px;
}

.mode-pills button {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-3);
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  transition: all var(--t-fast) var(--ease);
}

.mode-pills button[aria-pressed="true"] {
  color: var(--text-1);
  border-color: var(--border-strong);
  background: var(--bg-3);
}

.prompt-input {
  width: 100%;
  border: none;
  background: transparent;
  padding: 2px 0;
  font-size: 14px;
  min-height: 40px;
}

.prompt-input:focus {
  border: none;
  outline: none;
}

.prompt-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.estimate {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.inspector {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-1);
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.inspector-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.inspector-section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.inspector-section h3 {
  font-size: 12px;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ================= templates ================= */
.template-industry {
  margin-bottom: 18px;
}

.template-industry h3 {
  margin-bottom: 10px;
  color: var(--text-2);
  font-size: 13px;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.template-card {
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-2);
  padding: 12px;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.5;
  transition:
    transform var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}

.template-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
}

.template-card h4 {
  font-size: 13px;
  margin-bottom: 4px;
}

/* ================= assets ================= */
.asset-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.filters {
  display: flex;
  gap: 6px;
}

.filters button {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-3);
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 12px;
  transition: all var(--t-fast) var(--ease);
}

.filters button[aria-pressed="true"] {
  color: var(--text-1);
  border-color: var(--border-strong);
  background: var(--bg-2);
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.asset-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-2);
  overflow: hidden;
  text-align: left;
  padding: 0;
  transition:
    transform var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}

.asset-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
}

.asset-thumb {
  height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-1);
  overflow: hidden;
  color: var(--text-3);
  font-size: 22px;
}

.asset-thumb img,
.asset-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 0;
}

.asset-overlay {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.asset-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(380px, 90vw);
  border-left: 1px solid var(--border-strong);
  background: var(--glass);
  backdrop-filter: blur(24px);
  padding: 22px;
  overflow-y: auto;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: slide-in-right var(--t-med) var(--ease);
}

.panel-close {
  align-self: flex-end;
}

/* ================= tasks ================= */
.task-groups {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.task-group h2 {
  margin-bottom: 10px;
  color: var(--text-2);
}

.task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-2);
  padding: 12px 14px;
}

.task-row .grow {
  flex: 1;
  min-width: 0;
}

/* ================= account ================= */
.account-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  align-items: start;
}

.pkg {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-2);
  padding: 12px 14px;
}

.pkg-meta {
  color: var(--text-3);
  font-size: 12px;
}

.pkg-price {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

/* ================= auth ================= */
.auth {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.auth-card {
  width: min(400px, 100%);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-lg);
  background: var(--glass);
  backdrop-filter: blur(20px);
  padding: 32px 28px;
  animation: fade-up var(--t-slow) var(--ease);
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.auth-brand .logo {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: var(--accent-grad);
  box-shadow: var(--glow);
}

.auth .sub {
  color: var(--text-3);
  font-size: 12px;
  margin-bottom: 22px;
}

.sent {
  color: var(--text-2);
  font-size: 13px;
}

.devcode {
  font-size: 13px;
  color: var(--warn);
  background: rgba(251, 191, 36, 0.08);
  border: 1px dashed rgba(251, 191, 36, 0.35);
  border-radius: var(--r-sm);
  padding: 8px 12px;
}

/* ================= responsive ================= */
@media (max-width: 960px) {
  .studio {
    grid-template-columns: 1fr;
  }

  .inspector {
    order: 3;
  }
}
```

- [ ] **Step 5: Replace `styles.css` with the entry**

`apps/desktop/src/styles.css` 整体替换为：

```css
@import "./styles/tokens.css";
@import "./styles/base.css";
@import "./styles/components.css";
@import "./styles/views.css";
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck && pnpm --filter @gw-link-omniai/desktop exec vite build`
Expected: 测试/类型全绿；vite build 成功（验证 @import 被正确打包）。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/styles.css apps/desktop/src/styles/
git commit -m "feat(desktop): deep-space design system (tokens, base, components, views css)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: AuthScreen 组件抽取

纯重构：登录 JSX 从 App.tsx 抽成受控组件，行为与测试锚点不变。现有登录相关测试是安全网。

**Files:**
- Create: `apps/desktop/src/components/AuthScreen.tsx`
- Modify: `apps/desktop/src/App.tsx`（未认证分支改为渲染 `<AuthScreen …/>`，删除对应内联 JSX）

**Interfaces:**
- Produces: `AuthScreen(props: AuthScreenProps)`，props 见下。后续任务不改此组件。

- [ ] **Step 1: Create `components/AuthScreen.tsx`**

```tsx
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
```

- [ ] **Step 2: Wire into App.tsx**

未认证分支（`if (!session.authenticated) { return ( <main className="auth"> … ) }` 整块）替换为：

```tsx
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
```

顶部加 `import { AuthScreen } from "./components/AuthScreen";`。

- [ ] **Step 3: Verify + Commit**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿（登录流测试不变直接通过）。

```bash
git add apps/desktop/src/components/AuthScreen.tsx apps/desktop/src/App.tsx
git commit -m "refactor(desktop): extract AuthScreen component from App

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 工作台外壳（IconRail + 四视图迁移 + 快捷键）

结构性核心任务：已登录 UI 从单屏卡片堆叠迁移为 图标导航 + 顶栏 + 四视图。现有面板 JSX 按归属移入各视图（本任务不改面板内部结构，只搬家），测试同步加导航步骤。

**Files:**
- Create: `apps/desktop/src/components/IconRail.tsx`、`apps/desktop/src/views/StudioView.tsx`、`apps/desktop/src/views/TasksView.tsx`、`apps/desktop/src/views/AssetsView.tsx`、`apps/desktop/src/views/AccountView.tsx`
- Modify: `apps/desktop/src/App.tsx`（已认证分支整体重写为外壳）、`apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `getWorkspaceNavItems/viewForShortcutDigit/countActiveTasks/selectActiveTaskIds`、Task 5 的 `AuthScreen`。
- Produces: 四个视图组件的 props 契约（后续任务在其上扩展）；App 内 `view: WorkspaceView` 状态与 `openView` 测试辅助函数。

- [ ] **Step 1: Write failing tests（新增外壳用例 + 更新 signIn 后的导航辅助）**

在 `App.test.tsx` 的 `signIn` 函数后新增辅助：

```tsx
function openView(label: "创作" | "资产库" | "任务" | "账户") {
  const nav = screen.getByRole("navigation", { name: "Workspace views" });
  fireEvent.click(within(nav).getByRole("button", { name: label }));
}
```

新增三个用例（放在 describe 末尾）：

```tsx
  it("switches workspace views from the icon rail", async () => {
    const client = createFakeClient();
    await signIn(client);
    openView("资产库");
    expect(screen.getByLabelText("资产库")).toBeTruthy();
    openView("任务");
    expect(screen.getByLabelText("任务中心")).toBeTruthy();
    openView("账户");
    expect(screen.getByLabelText("订单")).toBeTruthy();
    openView("创作");
    expect(screen.getByRole("navigation", { name: "Studio modes" })).toBeTruthy();
  });

  it("switches views with Cmd+digit shortcuts", async () => {
    const client = createFakeClient();
    await signIn(client);
    fireEvent.keyDown(window, { key: "3", metaKey: true });
    expect(screen.getByLabelText("任务中心")).toBeTruthy();
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(screen.getByRole("navigation", { name: "Studio modes" })).toBeTruthy();
  });

  it("shows an active-task badge on the tasks nav item", async () => {
    const runningTask: GenerationTask = {
      id: "task-run",
      mode: "text",
      status: "running",
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      resultPreview: { title: "生成任务", description: "进行中" },
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    };
    const client = createFakeClient({ listGenerations: async () => [runningTask] });
    await signIn(client);
    const nav = screen.getByRole("navigation", { name: "Workspace views" });
    expect(within(nav).getByText("1")).toBeTruthy();
  });
```

同时按下表更新现有用例（在断言/操作前插入导航步骤；其余断言不变）：

| 用例 | 修改 |
| --- | --- |
| optimizes then submits a generation into the task center | `提交生成` 点击后插入 `openView("任务")` |
| shows the generated text in the task center | 同上 |
| saves a succeeded text task to the asset library | 提交后 `openView("任务")`，点击 保存到资产库 后 `openView("资产库")` 再断言资产 |
| renders a generated image in the task center | 提交后 `openView("任务")` |
| saves a succeeded image task to the asset library | 同 text 保存用例的两步导航 |
| lists the user's assets read-only (no save button) | signIn 后 `openView("资产库")` |
| refreshes a running task from the task center | signIn 后 `openView("任务")` |
| renders and saves a generated video | 提交后 `openView("任务")`，保存后 `openView("资产库")` |
| tops up the balance from the header | 更名 `tops up the balance from the account view`；signIn 后 `openView("账户")` 再点 `充值` |
| buys a package (pending + pay link), then dev-completes it | signIn 后 `openView("账户")` |
| expands a paid order to show detail and a receipt | signIn 后 `openView("账户")` |
| copies a paid order's receipt to the clipboard | signIn 后 `openView("账户")` |
| expands a pending order to show detail without a receipt | signIn 后 `openView("账户")` |
| auto-polls a running task to completion | signIn 后 `openView("任务")`（若其断言基于任务中心文案） |

余下用例（登录流、余额顶栏、insufficient credits、session 恢复、token 存取、does not poll）不需要导航修改。

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`
Expected: FAIL — 找不到 `Workspace views` 导航。

- [ ] **Step 3: Create `components/IconRail.tsx`**

```tsx
import type { WorkspaceNavItem, WorkspaceView } from "../navModel";

const icons: Record<WorkspaceView, JSX.Element> = {
  studio: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    </svg>
  ),
  assets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  )
};

export interface IconRailProps {
  items: WorkspaceNavItem[];
  active: WorkspaceView;
  activeTaskCount: number;
  onSelect(view: WorkspaceView): void;
}

export function IconRail({ items, active, activeTaskCount, onSelect }: IconRailProps) {
  return (
    <aside className="rail">
      <span className="logo" aria-hidden="true" />
      <nav aria-label="Workspace views" className="rail-nav">
        {items.map((item) => (
          <button
            key={item.view}
            type="button"
            aria-pressed={active === item.view}
            onClick={() => onSelect(item.view)}
          >
            {icons[item.view]}
            <span className="rail-label">{item.label}</span>
            {item.view === "tasks" && activeTaskCount > 0 ? (
              <span className="badge" aria-hidden="true">
                {activeTaskCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 4: Create the four v0 views（面板 JSX 从旧 App.tsx 对应段落搬入，结构不变）**

`views/StudioView.tsx`：

```tsx
import { useMemo } from "react";
import type { CreationMode, PromptOptimization } from "@gw-link-omniai/shared";
import { getStudioModeContent, getStudioModes, getStudioTemplates } from "../studioModel";

export interface StudioViewProps {
  mode: CreationMode;
  promptText: string;
  optimization?: PromptOptimization;
  onModeChange(mode: CreationMode): void;
  onPromptChange(text: string): void;
  onOptimize(): void;
  onSubmit(): void;
}

export function StudioView({ mode, promptText, optimization, onModeChange, onPromptChange, onOptimize, onSubmit }: StudioViewProps) {
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(mode), [mode]);
  const templates = useMemo(() => getStudioTemplates(mode), [mode]);
  const promptInputId = `${mode}-studio-prompt`;

  return (
    <div className="stack">
      <nav aria-label="Studio modes" className="mode-pills">
        {studioModes.map((candidate) => (
          <button
            key={candidate.mode}
            type="button"
            aria-pressed={mode === candidate.mode}
            onClick={() => onModeChange(candidate.mode)}
          >
            {candidate.title}
          </button>
        ))}
      </nav>

      <section aria-labelledby="current-studio-mode-title" className="card">
        <h2 id="current-studio-mode-title">{content.title}</h2>
        <p className="muted">{content.description}</p>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor={promptInputId}>{content.promptLabel}</label>
          <textarea
            id={promptInputId}
            name={`${mode}Prompt`}
            placeholder={content.promptPlaceholder}
            value={promptText}
            onChange={(event) => onPromptChange(event.target.value)}
          />
        </div>

        <section aria-label="提示词模板" style={{ marginTop: 12 }}>
          <h3>提示词模板</h3>
          <ul className="items" style={{ marginTop: 8 }}>
            {templates.map((template) => (
              <li key={template.id} className="item">
                <h4>{template.name}</h4>
                <p className="muted">{template.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="btn-primary" onClick={onOptimize}>
            优化提示词
          </button>
        </div>
      </section>

      {optimization ? (
        <section aria-label="提示词优化结果" className="card">
          <h2>优化结果</h2>
          <p style={{ marginTop: 8 }}>{optimization.optimizedPrompt}</p>
          <dl className="receipt">
            {optimization.sections.map((part) => (
              <div key={part.label}>
                <dt>{part.label}</dt>
                <dd>{part.value}</dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby="preset-suggestion-title" style={{ marginTop: 10 }}>
            <h3 id="preset-suggestion-title">推荐参数</h3>
            <p className="muted">{optimization.preset.modelId}</p>
            <p className="muted">
              预计点数：{optimization.preset.creditEstimate.credits}{" "}
              {optimization.preset.creditEstimate.credits === 1 ? "credit" : "credits"}
            </p>
          </section>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn-primary" onClick={onSubmit}>
              提交生成
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
```

`views/TasksView.tsx`（旧「任务中心」panel 原样搬入）：

```tsx
import type { GenerationTask } from "@gw-link-omniai/shared";
import { getGenerationStatusLabel, summarizeGenerationPrompt } from "../generationModel";
import { getStudioModeContent } from "../studioModel";

export interface TasksViewProps {
  tasks: GenerationTask[];
  onSaveAsset(task: GenerationTask): void;
  onRefreshTask(task: GenerationTask): void;
}

export function TasksView({ tasks, onSaveAsset, onRefreshTask }: TasksViewProps) {
  return (
    <section aria-label="任务中心" className="stack">
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
                  {task.result?.kind === "image" ? <img src={task.result.url} alt={task.result.alt} /> : null}
                  {task.result?.kind === "video" ? (
                    <video controls src={task.result.url} poster={task.result.posterUrl} />
                  ) : null}
                  <div className="actions">
                    {task.status === "succeeded" && task.result ? (
                      <button type="button" className="btn-sm" onClick={() => onSaveAsset(task)}>
                        保存到资产库
                      </button>
                    ) : null}
                    {task.status === "running" ? (
                      <button type="button" className="btn-sm" onClick={() => onRefreshTask(task)}>
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
  );
}
```

`views/AssetsView.tsx`（旧「资产库」panel 原样搬入，filter 计算入内）：

```tsx
import { useMemo } from "react";
import type { CreationAsset } from "@gw-link-omniai/shared";
import { filterCreationAssets, getAssetFilterLabel, summarizeAssetPrompt, type AssetFilter } from "@gw-link-omniai/shared";

const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];

export interface AssetsViewProps {
  assets: CreationAsset[];
  filter: AssetFilter;
  onFilterChange(filter: AssetFilter): void;
}

export function AssetsView({ assets, filter, onFilterChange }: AssetsViewProps) {
  const filteredAssets = useMemo(() => filterCreationAssets(assets, filter), [assets, filter]);
  return (
    <section aria-label="资产库" className="stack">
      <div className="asset-toolbar">
        <h2>资产库</h2>
        <nav aria-label="资产过滤" className="filters">
          {assetFilters.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={filter === candidate}
              onClick={() => onFilterChange(candidate)}
            >
              {getAssetFilterLabel(candidate)}
            </button>
          ))}
        </nav>
      </div>
      {filteredAssets.length === 0 ? (
        <p className="empty">暂无资产</p>
      ) : (
        <ol className="items">
          {filteredAssets.map((asset) => (
            <li key={asset.id}>
              <article className="item">
                <h3>{asset.title}</h3>
                <p>{asset.preview.description}</p>
                {asset.content.kind === "image" ? <img src={asset.content.url} alt={asset.content.alt} /> : null}
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
  );
}
```

`views/AccountView.tsx`（旧「套餐」「订单」panel + 充值 搬入）：

```tsx
import type { CreditAmount, CreditPackage, Order } from "@gw-link-omniai/shared";
import { formatCreditBalance } from "../creditModel";
import { buildReceiptLines, formatDateTime, formatMoney, formatPackagePrice, getOrderStatusLabel } from "../orderModel";

export interface AccountViewProps {
  balance?: CreditAmount;
  packages: CreditPackage[];
  orders: Order[];
  selectedOrderId: string | null;
  onTopUp(): void;
  onBuy(pkg: CreditPackage): void;
  onDevComplete(orderId: string): void;
  onSelectOrder(orderId: string | null): void;
  onCopyReceipt(order: Order, packageName: string): void;
}

export function AccountView({
  balance,
  packages,
  orders,
  selectedOrderId,
  onTopUp,
  onBuy,
  onDevComplete,
  onSelectOrder,
  onCopyReceipt
}: AccountViewProps) {
  return (
    <div className="account-grid">
      <section aria-label="点数" className="card stack">
        <h2>点数余额</h2>
        {balance ? (
          <div className="row">
            <span className="chip">
              <span className="spark" aria-hidden="true" />
              {formatCreditBalance(balance)}
            </span>
            <button type="button" className="btn-sm" onClick={onTopUp}>
              充值
            </button>
          </div>
        ) : (
          <p className="empty">余额加载中</p>
        )}
      </section>

      <section aria-label="套餐" className="card stack">
        <h2>积分套餐</h2>
        {packages.map((pkg) => (
          <div className="pkg" key={pkg.id}>
            <div>
              <div style={{ fontWeight: 600 }}>{pkg.displayName}</div>
              <div className="pkg-meta">{pkg.credits} 积分</div>
            </div>
            <div className="row">
              <span className="pkg-price">{formatPackagePrice(pkg)}</span>
              <button type="button" className="btn-primary btn-sm" onClick={() => onBuy(pkg)}>
                购买 {pkg.displayName}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section aria-label="订单" className="card stack">
        <h2>订单</h2>
        {orders.length === 0 ? (
          <p className="empty">暂无订单</p>
        ) : (
          <div className="stack">
            {orders.map((order) => {
              const expanded = order.id === selectedOrderId;
              const packageName = packages.find((pkg) => pkg.id === order.packageId)?.displayName ?? order.packageId;
              return (
                <div className="item" key={order.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>
                      {packageName} ·{" "}
                      <span className={`status status--${order.status}`}>{getOrderStatusLabel(order.status)}</span>
                    </span>
                    <button type="button" className="btn-sm" onClick={() => onSelectOrder(expanded ? null : order.id)}>
                      {expanded ? "收起" : "查看"}
                    </button>
                  </div>
                  {order.status === "pending" && (
                    <div className="actions">
                      {order.checkoutUrl ? <a href={order.checkoutUrl}>去支付</a> : null}
                      <button type="button" className="btn-sm" onClick={() => onDevComplete(order.id)}>
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
                          <button type="button" className="btn-sm" onClick={() => onCopyReceipt(order, packageName)}>
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
  );
}
```

- [ ] **Step 5: Rewrite App.tsx 已认证分支**

App.tsx 中：

1. import 增加：

```tsx
import { countActiveTasks, getWorkspaceNavItems, viewForShortcutDigit, type WorkspaceView } from "./navModel";
import { selectActiveTaskIds } from "./generationModel";
import { IconRail } from "./components/IconRail";
import { StudioView } from "./views/StudioView";
import { AssetsView } from "./views/AssetsView";
import { TasksView } from "./views/TasksView";
import { AccountView } from "./views/AccountView";
```

（`selectRunningTaskIds`、`getGenerationStatusLabel`、`summarizeGenerationPrompt`、`getStudioModes`、`getStudioModeContent`、`getStudioTemplates`、`filterCreationAssets`、`getAssetFilterLabel`、`summarizeAssetPrompt`、`buildReceiptLines`、`formatDateTime`、`formatMoney`、`formatPackagePrice`、`getOrderStatusLabel` 等已被视图接管的 import 从 App.tsx 移除，`buildReceiptText`、`formatCreditBalance` 保留。）

2. 状态新增 `const [view, setView] = useState<WorkspaceView>("studio");`，`handleSignedOut` 里补 `setView("studio");`。

3. 轮询 effect 的 `selectRunningTaskIds(tasks)` 改为 `selectActiveTaskIds(tasks)`（变量 `runningKey`/`runningIds` 改名 `activeKey`/`activeIds`）。

4. 快捷键 effect（已认证时挂载）：

```tsx
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
```

5. 已认证 return 整块替换为：

```tsx
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
              onModeChange={(mode) => {
                setSelectedMode(mode);
                setOptimization(undefined);
              }}
              onPromptChange={setPromptText}
              onOptimize={() => void handleOptimize()}
              onSubmit={() => void handleSubmitGeneration()}
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
```

同时删除 App.tsx 中已迁入视图的旧 JSX 与不再使用的局部变量（`studioModes`、`content`、`templates`、`assetFilters`、`filteredAssets`、`promptInputId`）。

- [ ] **Step 6: Run full suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿（含 3 个新外壳用例）。若有用例因导航缺失失败，按 Step 1 的表补导航步骤。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/components/IconRail.tsx apps/desktop/src/views/ apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): workspace shell with icon rail, four views and Cmd+digit shortcuts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: PromptBar + ResultCanvas + 一键生成

创作视图换代：画布为中心 + 底部悬浮提示词条；「生成」一键完成 optimize+submit；画布选中跟随最新提交。优化结果预览暂留画布下方（Task 8 移入 Inspector）。

**Files:**
- Create: `apps/desktop/src/components/PromptBar.tsx`、`apps/desktop/src/components/ResultCanvas.tsx`
- Modify: `apps/desktop/src/views/StudioView.tsx`（重写）、`apps/desktop/src/App.tsx`、`apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: Task 6 的外壳与 `openView`。
- Produces: App 新状态 `selectedTaskId: string | null`、`generating: boolean`；`handleGenerate(): Promise<void>`（无匹配优化则先 optimize 再 submit，成功后 `setSelectedTaskId(created.id)`）；`handleRetryTask(task: GenerationTask): Promise<void>`（用任务自带 mode/prompt/optimizedPrompt/preset 重新提交并选中新任务、切回 studio）；`ResultCanvas({ task, onSave, onRetry })`；`PromptBar` props 见代码。优化结果复用规则：`optimization.mode === selectedMode && optimization.originalPrompt === promptText` 才复用，否则重新 optimize。

- [ ] **Step 1: Write failing tests**

`App.test.tsx` 改造（旧任务中心结果断言改为画布断言）：

1. `optimizes then submits a generation into the task center` 更名 `optimizes then generates onto the canvas`：

```tsx
  it("optimizes then generates onto the canvas", async () => {
    const client = createFakeClient();
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    const canvas = await screen.findByLabelText("结果画布");
    await within(canvas).findByText("真实生成文案");
    expect(within(canvas).getByText("gw-text-balanced")).toBeTruthy();
  });
```

2. `shows the generated text in the task center` 更名 `keeps the generated task listed in the tasks view`：点击 `生成` 后 `openView("任务")`，断言任务中心出现 `已完成`（结果内容断言留在画布用例）。

3. 保存类用例（text/image/video）改为画布保存：`生成` 后在 `结果画布` 内点击 `保存到资产库`，再 `openView("资产库")` 断言资产出现（原断言内容不变）。image/video 的 `<img>`/`<video>` 存在性断言改为 `within(canvas)`。

4. 新增用例：

```tsx
  it("generates in one click without a prior optimize", async () => {
    const optimizePrompt = vi.fn(async () => textOptimization);
    const client = createFakeClient({ optimizePrompt });
    await signIn(client);

    fireEvent.change(screen.getByLabelText("文本创作需求"), { target: { value: "写一段品牌故事" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    const canvas = await screen.findByLabelText("结果画布");
    await within(canvas).findByText("真实生成文案");
    expect(optimizePrompt).toHaveBeenCalledTimes(1);
  });

  it("shows a shimmer skeleton while the task is generating", async () => {
    const client = createFakeClient({
      createGeneration: async (request) => ({
        id: "task-running",
        mode: request.mode,
        status: "running" as const,
        prompt: request.prompt,
        optimizedPrompt: request.optimizedPrompt,
        preset: request.preset,
        resultPreview: { title: "生成任务", description: "进行中" },
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z"
      }),
      listGenerations: async () => []
    });
    await signIn(client);
    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    const canvas = await screen.findByLabelText("结果画布");
    await within(canvas).findByText("生成中");
  });
```

注意：骨架用例里 `listGenerations` 返回空，App 在提交后需将返回的任务合并进列表（见 Step 3 实现——`setTasks` 用「插入或替换」而不是全量替换后丢弃）。

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx`
Expected: FAIL — 找不到 `结果画布` / `生成` 按钮。

- [ ] **Step 3: Implement**

`components/ResultCanvas.tsx`：

```tsx
import type { GenerationTask } from "@gw-link-omniai/shared";
import { getGenerationStatusLabel } from "../generationModel";

export interface ResultCanvasProps {
  task?: GenerationTask;
  onSave(task: GenerationTask): void;
  onRetry(task: GenerationTask): void;
}

export function ResultCanvas({ task, onSave, onRetry }: ResultCanvasProps) {
  return (
    <section aria-label="结果画布" className="canvas">
      {!task ? (
        <div className="canvas-empty">
          <h2>从一个想法开始</h2>
          <p>在下方输入提示词，生成结果会展示在这里。</p>
        </div>
      ) : task.status === "queued" || task.status === "running" ? (
        <div className="canvas-skeleton" role="status">
          <span className="skeleton-line shimmer" />
          <span className="skeleton-line shimmer" />
          <span className="skeleton-line shimmer" />
          <p className="muted">
            {getGenerationStatusLabel(task.status)} · {task.preset.modelId}
          </p>
        </div>
      ) : task.status === "failed" ? (
        <div className="canvas-failed">
          <h2>生成失败</h2>
          <p className="muted">{task.resultPreview.description}</p>
          <button type="button" className="btn-primary" onClick={() => onRetry(task)}>
            重试
          </button>
        </div>
      ) : (
        <div className="canvas-result">
          {task.result?.kind === "text" ? <p className="canvas-text">{task.result.text}</p> : null}
          {task.result?.kind === "image" ? (
            <div className="canvas-media">
              <img src={task.result.url} alt={task.result.alt} />
            </div>
          ) : null}
          {task.result?.kind === "video" ? (
            <div className="canvas-media">
              <video controls src={task.result.url} poster={task.result.posterUrl} />
            </div>
          ) : null}
          <div className="row">
            <span className="muted">{task.preset.modelId}</span>
            <div className="spacer" />
            {task.result ? (
              <button type="button" className="btn-sm" onClick={() => onSave(task)}>
                保存到资产库
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
```

`components/PromptBar.tsx`：

```tsx
import type { CreationMode } from "@gw-link-omniai/shared";
import type { StudioModeContent } from "../studioModel";

export interface PromptBarProps {
  mode: CreationMode;
  modes: StudioModeContent[];
  content: StudioModeContent;
  promptText: string;
  estimateCredits?: number;
  generating: boolean;
  onModeChange(mode: CreationMode): void;
  onPromptChange(text: string): void;
  onOptimize(): void;
  onGenerate(): void;
}

export function PromptBar({
  mode,
  modes,
  content,
  promptText,
  estimateCredits,
  generating,
  onModeChange,
  onPromptChange,
  onOptimize,
  onGenerate
}: PromptBarProps) {
  return (
    <div className="prompt-dock">
      <div className="prompt-bar">
        <nav aria-label="Studio modes" className="mode-pills">
          {modes.map((candidate) => (
            <button
              key={candidate.mode}
              type="button"
              aria-pressed={mode === candidate.mode}
              onClick={() => onModeChange(candidate.mode)}
            >
              {candidate.title}
            </button>
          ))}
        </nav>
        <textarea
          className="prompt-input"
          aria-label={content.promptLabel}
          placeholder={content.promptPlaceholder}
          value={promptText}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onGenerate();
            }
          }}
        />
        <div className="prompt-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={onOptimize} disabled={generating}>
            优化提示词
          </button>
          <div className="spacer" />
          {typeof estimateCredits === "number" ? (
            <span className="estimate">预计 {estimateCredits} 点</span>
          ) : null}
          <button type="button" className="btn-primary" onClick={onGenerate} disabled={generating}>
            生成
          </button>
        </div>
      </div>
    </div>
  );
}
```

`views/StudioView.tsx` 重写：

```tsx
import { useMemo } from "react";
import type { CreationMode, GenerationTask, PromptOptimization } from "@gw-link-omniai/shared";
import { getStudioModeContent, getStudioModes } from "../studioModel";
import { PromptBar } from "../components/PromptBar";
import { ResultCanvas } from "../components/ResultCanvas";

export interface StudioViewProps {
  mode: CreationMode;
  promptText: string;
  optimization?: PromptOptimization;
  selectedTask?: GenerationTask;
  generating: boolean;
  onModeChange(mode: CreationMode): void;
  onPromptChange(text: string): void;
  onOptimize(): void;
  onGenerate(): void;
  onSaveAsset(task: GenerationTask): void;
  onRetryTask(task: GenerationTask): void;
}

export function StudioView({
  mode,
  promptText,
  optimization,
  selectedTask,
  generating,
  onModeChange,
  onPromptChange,
  onOptimize,
  onGenerate,
  onSaveAsset,
  onRetryTask
}: StudioViewProps) {
  const studioModes = useMemo(() => getStudioModes(), []);
  const content = useMemo(() => getStudioModeContent(mode), [mode]);
  const estimateCredits = optimization ? optimization.preset.creditEstimate.credits : undefined;

  return (
    <div className="studio">
      <div className="studio-center">
        <ResultCanvas task={selectedTask} onSave={onSaveAsset} onRetry={onRetryTask} />

        {optimization ? (
          <section aria-label="提示词优化结果" className="card">
            <h3>优化结果</h3>
            <p style={{ marginTop: 6 }}>{optimization.optimizedPrompt}</p>
            <p className="muted" style={{ marginTop: 6 }}>
              {optimization.preset.modelId} · 预计点数 {optimization.preset.creditEstimate.credits}
            </p>
          </section>
        ) : null}

        <PromptBar
          mode={mode}
          modes={studioModes}
          content={content}
          promptText={promptText}
          estimateCredits={estimateCredits}
          generating={generating}
          onModeChange={onModeChange}
          onPromptChange={onPromptChange}
          onOptimize={onOptimize}
          onGenerate={onGenerate}
        />
      </div>
    </div>
  );
}
```

`App.tsx` 修改：

1. 状态新增：

```tsx
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
```

`handleSignedOut` 里补 `setSelectedTaskId(null);`。

2. 任务合并辅助 + 派生选中任务（放在组件内、handlers 之前）：

```tsx
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId),
    [tasks, selectedTaskId]
  );

  function upsertTask(list: GenerationTask[], task: GenerationTask): GenerationTask[] {
    return list.some((existing) => existing.id === task.id)
      ? list.map((existing) => (existing.id === task.id ? task : existing))
      : [task, ...list];
  }
```

3. `handleSubmitGeneration` 替换为：

```tsx
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
    if (!token) {
      return;
    }
    let activeOptimization = optimization;
    if (
      !activeOptimization ||
      activeOptimization.mode !== selectedMode ||
      activeOptimization.originalPrompt !== promptText
    ) {
      setActionError(undefined);
      try {
        activeOptimization = await api.optimizePrompt({ mode: selectedMode, prompt: promptText });
        setOptimization(activeOptimization);
      } catch (error) {
        setActionError(errorMessage(error));
        return;
      }
    }
    await submitTask({
      mode: activeOptimization.mode,
      prompt: activeOptimization.originalPrompt,
      optimizedPrompt: activeOptimization.optimizedPrompt,
      preset: activeOptimization.preset
    });
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
```

（`GenerationTaskRequest` 加入 shared 类型 import。）

4. StudioView 调用点替换为新 props：

```tsx
            <StudioView
              mode={selectedMode}
              promptText={promptText}
              optimization={optimization}
              selectedTask={selectedTask}
              generating={generating}
              onModeChange={(mode) => {
                setSelectedMode(mode);
                setOptimization(undefined);
              }}
              onPromptChange={setPromptText}
              onOptimize={() => void handleOptimize()}
              onGenerate={() => void handleGenerate()}
              onSaveAsset={(task) => void handleSaveAsset(task)}
              onRetryTask={(task) => void handleRetryTask(task)}
            />
```

- [ ] **Step 4: Run full suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/PromptBar.tsx apps/desktop/src/components/ResultCanvas.tsx apps/desktop/src/views/StudioView.tsx apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): canvas-centric studio with floating prompt bar and one-click generate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Inspector（模型选择 + 优化词编辑 + 点数明细）

**Files:**
- Create: `apps/desktop/src/components/Inspector.tsx`
- Modify: `apps/desktop/src/views/StudioView.tsx`（加右栏；Task 7 的临时优化结果 card 移入 Inspector）、`apps/desktop/src/App.tsx`、`apps/desktop/src/__tests__/App.test.tsx`（createFakeClient 的 listModels 改为返回模型；新增 3 用例）

**Interfaces:**
- Consumes: Task 7 的 `submitTask/handleGenerate`。
- Produces: App 状态 `models: ProductModel[]`（loadUserData 并行加载 `api.listModels()`）、`selectedModelId: string | undefined`；提交时 `preset = { ...opt.preset, modelId: resolvedModelId }`；新优化返回时 `setSelectedModelId(opt.preset.modelId)`。锚点：`模型选择`（select 的 aria-label）、`优化后提示词`（textarea 的 aria-label）、`提示词优化结果`（Inspector 内 section）。

- [ ] **Step 1: Write failing tests**

`createFakeClient` 的 `listModels: async () => { throw new Error("unused"); }` 替换为：

```ts
    listModels: async () => [
      { id: "gw-text-balanced", displayName: "均衡文本", capability: "text" as const, tags: [], visibility: "visible" as const, minimumPlan: "free" as const, creditUnitCost: 1 },
      { id: "gw-text-quality", displayName: "高质量文本", capability: "text" as const, tags: [], visibility: "visible" as const, minimumPlan: "free" as const, creditUnitCost: 2 },
      { id: "gw-image-creative", displayName: "创意图像", capability: "image" as const, tags: [], visibility: "visible" as const, minimumPlan: "free" as const, creditUnitCost: 2 }
    ],
```

新增用例：

```tsx
  it("overrides the suggested model before generating", async () => {
    const createGeneration = vi.fn(createFakeClient().createGeneration);
    const client = createFakeClient({ createGeneration });
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.change(screen.getByLabelText("模型选择"), { target: { value: "gw-text-quality" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await screen.findByLabelText("结果画布");
    await vi.waitFor(() => expect(createGeneration).toHaveBeenCalled());
    expect(createGeneration.mock.calls[0][0].preset.modelId).toBe("gw-text-quality");
  });

  it("resets the model override when a fresh optimization arrives", async () => {
    const client = createFakeClient();
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.change(screen.getByLabelText("模型选择"), { target: { value: "gw-text-quality" } });
    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await vi.waitFor(() => {
      expect((screen.getByLabelText("模型选择") as HTMLSelectElement).value).toBe("gw-text-balanced");
    });
  });

  it("edits the optimized prompt before generating", async () => {
    const createGeneration = vi.fn(createFakeClient().createGeneration);
    const client = createFakeClient({ createGeneration });
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.change(screen.getByLabelText("优化后提示词"), { target: { value: "改写后的提示词" } });
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await vi.waitFor(() => expect(createGeneration).toHaveBeenCalled());
    expect(createGeneration.mock.calls[0][0].optimizedPrompt).toBe("改写后的提示词");
  });
```

注意第三个用例：编辑 `optimization.optimizedPrompt` 后 `handleGenerate` 的复用判断依据是 `originalPrompt`/`mode`（编辑优化词不触发重新 optimize）。

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "model"
`
Expected: FAIL — 找不到 `模型选择`。

- [ ] **Step 3: Implement**

`components/Inspector.tsx`：

```tsx
import type { CreationMode, ProductModel, PromptOptimization } from "@gw-link-omniai/shared";

export interface InspectorProps {
  mode: CreationMode;
  models: ProductModel[];
  optimization?: PromptOptimization;
  selectedModelId?: string;
  onModelChange(modelId: string): void;
  onOptimizedPromptChange(text: string): void;
}

export function Inspector({
  mode,
  models,
  optimization,
  selectedModelId,
  onModelChange,
  onOptimizedPromptChange
}: InspectorProps) {
  const modeModels = models.filter((model) => model.capability === mode && model.visibility === "visible");
  const currentModelId = selectedModelId ?? optimization?.preset.modelId ?? modeModels[0]?.id ?? "";
  const currentModel = modeModels.find((model) => model.id === currentModelId);

  return (
    <aside className="inspector" aria-label="参数检查器">
      <div className="inspector-section">
        <h3>模型</h3>
        {modeModels.length > 0 ? (
          <select aria-label="模型选择" value={currentModelId} onChange={(event) => onModelChange(event.target.value)}>
            {modeModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        ) : (
          <p className="muted">当前模式暂无可用模型</p>
        )}
        {currentModel ? <p className="muted">单次消耗 {currentModel.creditUnitCost} 点</p> : null}
      </div>

      {optimization ? (
        <section aria-label="提示词优化结果" className="inspector-section">
          <h3>优化后提示词</h3>
          <textarea
            aria-label="优化后提示词"
            value={optimization.optimizedPrompt}
            onChange={(event) => onOptimizedPromptChange(event.target.value)}
          />
          <dl className="receipt">
            {optimization.sections.map((part) => (
              <div key={part.label}>
                <dt>{part.label}</dt>
                <dd>{part.value}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            预计点数 {optimization.preset.creditEstimate.credits}
            {optimization.preset.creditEstimate.credits === 1 ? " credit" : " credits"}
          </p>
        </section>
      ) : (
        <div className="inspector-section">
          <h3>优化</h3>
          <p className="muted">点击「优化提示词」后，这里会展示优化结果与推荐参数。</p>
        </div>
      )}
    </aside>
  );
}
```

`views/StudioView.tsx`：props 追加 `models: ProductModel[]`、`selectedModelId?: string`、`onModelChange(modelId: string): void`、`onOptimizedPromptChange(text: string): void`；删除 Task 7 的临时优化结果 card；`.studio` 内 `.studio-center` 之后渲染：

```tsx
      <Inspector
        mode={mode}
        models={models}
        optimization={optimization}
        selectedModelId={selectedModelId}
        onModelChange={onModelChange}
        onOptimizedPromptChange={onOptimizedPromptChange}
      />
```

`App.tsx`：

1. 状态：`const [models, setModels] = useState<ProductModel[]>([]);`、`const [selectedModelId, setSelectedModelId] = useState<string | undefined>(undefined);`
2. `loadUserData` 的 Promise.all 追加 `api.listModels()` → `setModels(loadedModels);`
3. `handleOptimize` 成功后补 `setSelectedModelId(result.preset.modelId);`（把现有一行拆为先存变量再 set 两个状态）；`handleGenerate` 的「重新 optimize」分支同样在 `setOptimization` 后补 `setSelectedModelId(activeOptimization.preset.modelId);`
4. `handleGenerate` 组装请求时解析覆盖（fresh 优化时用建议值）：

```tsx
    const resolvedModelId = freshOptimization
      ? activeOptimization.preset.modelId
      : selectedModelId ?? activeOptimization.preset.modelId;
    await submitTask({
      mode: activeOptimization.mode,
      prompt: activeOptimization.originalPrompt,
      optimizedPrompt: activeOptimization.optimizedPrompt,
      preset: { ...activeOptimization.preset, modelId: resolvedModelId }
    });
```

（`freshOptimization` 为布尔局部变量：进入重新 optimize 分支时置 true。）

5. `onOptimizedPromptChange`：`(text) => setOptimization((prev) => (prev ? { ...prev, optimizedPrompt: text } : prev))`。
6. 模式切换回调里补 `setSelectedModelId(undefined);`；`handleSignedOut` 补 `setModels([]); setSelectedModelId(undefined);`。

- [ ] **Step 4: Run full suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/Inspector.tsx apps/desktop/src/views/StudioView.tsx apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): parameter inspector with model override and optimized-prompt editing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: TemplateGallery + HistoryStrip + 模板按钮

**Files:**
- Create: `apps/desktop/src/components/TemplateGallery.tsx`、`apps/desktop/src/components/HistoryStrip.tsx`
- Modify: `apps/desktop/src/components/PromptBar.tsx`（加 模板 按钮）、`apps/desktop/src/views/StudioView.tsx`、`apps/desktop/src/App.tsx`、`apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `getIndustryTemplates/listIndustries/templatesForIndustry`、Task 7 的画布/选中机制。
- Produces: 画布空态（`selectedTask` 为空）显示 `TemplateGallery`（`aria-label="灵感模板"`）；模板卡可访问名为模板 title；`HistoryStrip`（`aria-label="历史任务"`，按钮 `aria-label` 为 `查看任务 ${task.id}`，最多 12 个）；PromptBar `onShowTemplates` 按钮 `模板`；App `handleApplyTemplate(template)`：切模式、填提示词、清空 optimization/override/选中。

- [ ] **Step 1: Write failing tests**

```tsx
  it("fills the prompt bar from an industry template", async () => {
    const client = createFakeClient();
    await signIn(client);

    const gallery = screen.getByLabelText("灵感模板");
    fireEvent.click(within(gallery).getByRole("button", { name: "产品主图" }));

    const modeNav = screen.getByRole("navigation", { name: "Studio modes" });
    expect(within(modeNav).getByRole("button", { name: "图片创作" }).getAttribute("aria-pressed")).toBe("true");
    const promptInput = screen.getByLabelText("图片创作需求") as HTMLTextAreaElement;
    expect(promptInput.value).toContain("陶瓷咖啡杯");
  });

  it("selects a past task from the history strip", async () => {
    const past: GenerationTask = {
      id: "task-past",
      mode: "text",
      status: "succeeded",
      prompt: "旧任务",
      optimizedPrompt: "旧任务优化",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      resultPreview: { title: "生成任务", description: "已生成。" },
      result: { kind: "text", text: "历史生成内容", format: "plain" },
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z"
    };
    const client = createFakeClient({ listGenerations: async () => [past] });
    await signIn(client);

    fireEvent.click(screen.getByLabelText("查看任务 task-past"));
    const canvas = screen.getByLabelText("结果画布");
    expect(within(canvas).getByText("历史生成内容")).toBeTruthy();
  });

  it("returns to the template gallery via the template button", async () => {
    const client = createFakeClient();
    await signIn(client);

    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    const canvas = await screen.findByLabelText("结果画布");
    await within(canvas).findByText("真实生成文案");

    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    expect(screen.getByLabelText("灵感模板")).toBeTruthy();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "template"`
Expected: FAIL — 找不到 `灵感模板`。

- [ ] **Step 3: Implement**

`components/TemplateGallery.tsx`：

```tsx
import { listIndustries, templatesForIndustry, type IndustryTemplate } from "../templatesModel";

export interface TemplateGalleryProps {
  onApply(template: IndustryTemplate): void;
}

const modeLabels: Record<IndustryTemplate["mode"], string> = {
  text: "文本",
  image: "图片",
  video: "视频"
};

export function TemplateGallery({ onApply }: TemplateGalleryProps) {
  return (
    <div aria-label="灵感模板" role="region">
      <div className="canvas-empty" style={{ flex: "0 0 auto", paddingBottom: 18 }}>
        <h2>从一个行业场景开始</h2>
        <p>挑一个模板，提示词会自动填入下方输入框。</p>
      </div>
      {listIndustries().map((industry) => (
        <div key={industry} className="template-industry">
          <h3>{industry}</h3>
          <div className="template-grid">
            {templatesForIndustry(industry).map((template) => (
              <button key={template.id} type="button" className="template-card" onClick={() => onApply(template)}>
                <h4>{template.title}</h4>
                <p>
                  {modeLabels[template.mode]} · {template.prompt.slice(0, 42)}…
                </p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

注意：模板卡的可访问名是按钮全文，`getByRole("button", { name: "产品主图" })` 需要精确匹配失败——因此 `h4` 外的说明文字放 `aria-hidden`：`<p aria-hidden="true">…</p>`，并给按钮 `aria-label={template.title}`。（实现时以此为准。）

`components/HistoryStrip.tsx`：

```tsx
import type { GenerationTask } from "@gw-link-omniai/shared";

const modeGlyphs: Record<GenerationTask["mode"], string> = {
  text: "文",
  image: "图",
  video: "视"
};

export interface HistoryStripProps {
  tasks: GenerationTask[];
  selectedTaskId: string | null;
  onSelect(taskId: string): void;
}

export function HistoryStrip({ tasks, selectedTaskId, onSelect }: HistoryStripProps) {
  const recent = tasks.slice(0, 12);
  if (recent.length === 0) {
    return null;
  }
  return (
    <div className="history" role="toolbar" aria-label="历史任务">
      {recent.map((task) => (
        <button
          key={task.id}
          type="button"
          aria-label={`查看任务 ${task.id}`}
          aria-pressed={task.id === selectedTaskId}
          onClick={() => onSelect(task.id)}
        >
          {task.result?.kind === "image" ? (
            <img className="thumb" src={task.result.url} alt="" />
          ) : task.result?.kind === "video" ? (
            <img className="thumb" src={task.result.posterUrl} alt="" />
          ) : (
            <span>{modeGlyphs[task.mode]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
```

`PromptBar.tsx`：props 追加 `onShowTemplates(): void;`，`prompt-actions` 里「优化提示词」按钮前插入：

```tsx
          <button type="button" className="btn-ghost btn-sm" onClick={onShowTemplates}>
            模板
          </button>
```

`views/StudioView.tsx`：props 追加 `tasks: GenerationTask[]`、`selectedTaskId: string | null`、`onSelectTask(taskId: string): void`、`onShowTemplates(): void`、`onApplyTemplate(template: IndustryTemplate): void`；`ResultCanvas` 改为 `selectedTask` 为空时渲染画布容器内的 `TemplateGallery`：

```tsx
        <section aria-label="结果画布" className="canvas">
          {selectedTask ? (
            <ResultCanvasBody task={selectedTask} onSave={onSaveAsset} onRetry={onRetryTask} />
          ) : (
            <TemplateGallery onApply={onApplyTemplate} />
          )}
        </section>
```

实现方式：把 `ResultCanvas.tsx` 的最外层 `<section>` 去掉、导出为 `ResultCanvasBody`（内容不变，空态分支删除——空态由 gallery 接管），`StudioView` 持有 `<section aria-label="结果画布">` 容器。画布下方渲染 `<HistoryStrip tasks={tasks} selectedTaskId={selectedTaskId} onSelect={onSelectTask} />`。

`App.tsx`：

```tsx
  function handleApplyTemplate(template: IndustryTemplate) {
    setSelectedMode(template.mode);
    setPromptText(template.prompt);
    setOptimization(undefined);
    setSelectedModelId(undefined);
    setSelectedTaskId(null);
  }
```

StudioView 传入 `tasks={tasks}`、`selectedTaskId={selectedTaskId}`、`onSelectTask={setSelectedTaskId}`、`onShowTemplates={() => setSelectedTaskId(null)}`、`onApplyTemplate={handleApplyTemplate}`。

- [ ] **Step 4: Run full suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/TemplateGallery.tsx apps/desktop/src/components/HistoryStrip.tsx apps/desktop/src/components/PromptBar.tsx apps/desktop/src/components/ResultCanvas.tsx apps/desktop/src/views/StudioView.tsx apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): industry template gallery and history strip in the studio canvas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: AssetsView 网格 + 详情侧板

**Files:**
- Modify: `apps/desktop/src/views/AssetsView.tsx`（重写为网格 + 侧板）、`apps/desktop/src/App.tsx`（`selectedAssetId` 状态 + Esc 关闭 + 复制文本）、`apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: App 状态 `selectedAssetId: string | null`；Esc 快捷键关闭侧板；锚点：资产卡按钮 `aria-label={asset.title}`、侧板 `aria-label="资产详情"`、关闭按钮 `关闭`、下载链接 `下载`、复制按钮 `复制文本`、复制成功提示文案 `已复制文本`。
- Consumes: `signIn` 辅助需支持注入 `copyText`：改签名为 `async function signIn(client: ApiClient, options: { copyText?: (text: string) => Promise<void> } = {})`，内部 `render(<App client={client} copyText={options.copyText} />)`；现有调用点不变。

- [ ] **Step 1: Write failing tests**

替换 `lists the user's assets read-only (no save button)` 为（保留其原有 fake 资产构造，若原用例有预置 `listAssets` 覆盖则沿用其资产数据；下面以文本资产为例）：

```tsx
  it("lists assets in a grid and opens the detail panel", async () => {
    const textAsset: CreationAsset = {
      id: "asset-1",
      mode: "text",
      title: "生成任务",
      content: { kind: "text", text: "已保存的文案", format: "plain" },
      preview: { title: "生成任务", description: "已保存。" },
      source: { taskId: "task-1", taskStatus: "succeeded" },
      prompt: "帮我写文案",
      optimizedPrompt: "请生成一段文案。",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      createdAt: "2026-07-01T00:00:00.000Z"
    };
    const client = createFakeClient({ listAssets: async () => [textAsset] });
    await signIn(client);
    openView("资产库");

    expect(screen.queryByRole("button", { name: "保存到资产库" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "生成任务" }));

    const panel = screen.getByLabelText("资产详情");
    expect(within(panel).getByText("帮我写文案")).toBeTruthy();
    expect(within(panel).getByText("gw-text-balanced")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "关闭" }));
    expect(screen.queryByLabelText("资产详情")).toBeNull();
  });

  it("closes the asset detail panel with Escape", async () => {
    const client = createFakeClient({ listAssets: async () => [textAsset] });
    await signIn(client);
    openView("资产库");
    fireEvent.click(screen.getByRole("button", { name: "生成任务" }));
    expect(screen.getByLabelText("资产详情")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("资产详情")).toBeNull();
  });

  it("copies a text asset from the detail panel", async () => {
    const copyText = vi.fn(async () => undefined);
    const client = createFakeClient({ listAssets: async () => [textAsset] });
    await signIn(client, { copyText });
    openView("资产库");
    fireEvent.click(screen.getByRole("button", { name: "生成任务" }));
    fireEvent.click(screen.getByRole("button", { name: "复制文本" }));
    await screen.findByText("已复制文本");
    expect(copyText).toHaveBeenCalledWith("已保存的文案");
  });

  it("offers a download link for media assets", async () => {
    const imageAsset: CreationAsset = {
      id: "asset-img",
      mode: "image",
      title: "海报图",
      content: { kind: "image", url: "data:image/png;base64,aGVsbG8=", alt: "海报" },
      preview: { title: "海报图", description: "已保存。" },
      source: { taskId: "task-2", taskStatus: "succeeded" },
      prompt: "一张海报",
      optimizedPrompt: "一张精修海报",
      preset: { modelId: "gw-image-creative", parameters: {}, creditEstimate: { credits: 2, unit: "credit" } },
      createdAt: "2026-07-01T00:00:00.000Z"
    };
    const client = createFakeClient({ listAssets: async () => [imageAsset] });
    await signIn(client);
    openView("资产库");
    fireEvent.click(screen.getByRole("button", { name: "海报图" }));
    const panel = screen.getByLabelText("资产详情");
    const link = within(panel).getByRole("link", { name: "下载" });
    expect(link.getAttribute("href")).toBe("data:image/png;base64,aGVsbG8=");
  });
```

`textAsset` 定义为 describe 外的文件级常量（第一个用例中的对象字面量原样上提），三个用例共用。Task 7 改过的保存类用例末尾断言（资产出现在资产库）改为断言网格卡片：`expect(screen.getByRole("button", { name: "生成任务" })).toBeTruthy()`（title 来自 `buildAssetRequestFromTask` = resultPreview.title）。

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "asset"`
Expected: FAIL。

- [ ] **Step 3: Implement**

`views/AssetsView.tsx` 重写：

```tsx
import { useMemo } from "react";
import type { CreationAsset } from "@gw-link-omniai/shared";
import { filterCreationAssets, getAssetFilterLabel, type AssetFilter } from "@gw-link-omniai/shared";
import { formatDateTime } from "../orderModel";

const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];

export interface AssetsViewProps {
  assets: CreationAsset[];
  filter: AssetFilter;
  selectedAssetId: string | null;
  onFilterChange(filter: AssetFilter): void;
  onSelectAsset(assetId: string | null): void;
  onCopyAssetText(asset: CreationAsset): void;
}

export function AssetsView({ assets, filter, selectedAssetId, onFilterChange, onSelectAsset, onCopyAssetText }: AssetsViewProps) {
  const filteredAssets = useMemo(() => filterCreationAssets(assets, filter), [assets, filter]);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);

  return (
    <section aria-label="资产库" className="stack">
      <div className="asset-toolbar">
        <h2>资产库</h2>
        <nav aria-label="资产过滤" className="filters">
          {assetFilters.map((candidate) => (
            <button key={candidate} type="button" aria-pressed={filter === candidate} onClick={() => onFilterChange(candidate)}>
              {getAssetFilterLabel(candidate)}
            </button>
          ))}
        </nav>
      </div>

      {filteredAssets.length === 0 ? (
        <div className="canvas-empty">
          <h2>还没有资产</h2>
          <p>生成满意的结果后，点「保存到资产库」就会出现在这里。</p>
        </div>
      ) : (
        <div className="asset-grid">
          {filteredAssets.map((asset) => (
            <button key={asset.id} type="button" className="asset-card" aria-label={asset.title} onClick={() => onSelectAsset(asset.id)}>
              <span className="asset-thumb">
                {asset.content.kind === "image" ? (
                  <img src={asset.content.url} alt={asset.content.alt} />
                ) : asset.content.kind === "video" ? (
                  <img src={asset.content.posterUrl} alt="" />
                ) : (
                  <span aria-hidden="true">文</span>
                )}
              </span>
              <span className="asset-overlay">
                <span>{asset.title}</span>
                <span className="muted">{formatDateTime(asset.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedAsset ? (
        <aside aria-label="资产详情" className="asset-panel">
          <button type="button" className="btn-sm panel-close" onClick={() => onSelectAsset(null)}>
            关闭
          </button>
          {selectedAsset.content.kind === "image" ? (
            <img src={selectedAsset.content.url} alt={selectedAsset.content.alt} />
          ) : null}
          {selectedAsset.content.kind === "video" ? (
            <video controls src={selectedAsset.content.url} poster={selectedAsset.content.posterUrl} />
          ) : null}
          {selectedAsset.content.kind === "text" ? <p className="canvas-text">{selectedAsset.content.text}</p> : null}
          <h2>{selectedAsset.title}</h2>
          <p>{selectedAsset.prompt}</p>
          <p className="muted">{selectedAsset.optimizedPrompt}</p>
          <p className="muted">{selectedAsset.preset.modelId}</p>
          <p className="muted">{formatDateTime(selectedAsset.createdAt)}</p>
          <div className="actions">
            {selectedAsset.content.kind === "text" ? (
              <button type="button" className="btn-sm" onClick={() => onCopyAssetText(selectedAsset)}>
                复制文本
              </button>
            ) : (
              <a className="btn-sm" href={selectedAsset.content.url} download>
                下载
              </a>
            )}
          </div>
        </aside>
      ) : null}
    </section>
  );
}
```

`App.tsx`：

1. `const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);`，`handleSignedOut` 补 `setSelectedAssetId(null);`。
2. Esc 分支加入快捷键 effect：

```tsx
      if (event.key === "Escape") {
        setSelectedAssetId(null);
      }
```

3. 复制文本 handler：

```tsx
  async function handleCopyAssetText(asset: CreationAsset) {
    if (asset.content.kind !== "text") {
      return;
    }
    try {
      await copy(asset.content.text);
      setCopyNotice("已复制文本");
    } catch {
      setCopyNotice(undefined);
      setActionError("复制失败，请重试");
    }
  }
```

4. AssetsView 调用点传入新 props。

- [ ] **Step 4: Run full suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/AssetsView.tsx apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): asset grid with detail side panel, download and copy actions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: TasksView 状态分组 + 重试 + 跳转画布

**Files:**
- Modify: `apps/desktop/src/views/TasksView.tsx`（重写）、`apps/desktop/src/App.tsx`（打开任务跳转）、`apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: 任务按组展示，组标题格式 `进行中（n）` / `已完成（n）` / `失败（n）`（全角括号，只渲染非空组——避免与状态 pill 文案冲突的精确匹配问题）；行内按钮 `打开`（`aria-label={"打开任务 " + task.id}`）、失败行 `重试`、进行中行保留 `刷新状态`；`onOpenTask(taskId)` = App `setSelectedTaskId(taskId); setView("studio")`。行内不再渲染结果内容与保存按钮（画布负责）。

- [ ] **Step 1: Write failing tests**

```tsx
  it("groups tasks by status with counts", async () => {
    const base = {
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" as const } },
      resultPreview: { title: "生成任务", description: "d" },
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    };
    const client = createFakeClient({
      listGenerations: async () => [
        { ...base, id: "t1", mode: "text" as const, status: "running" as const },
        { ...base, id: "t2", mode: "text" as const, status: "succeeded" as const, result: { kind: "text" as const, text: "内容", format: "plain" as const } },
        { ...base, id: "t3", mode: "text" as const, status: "failed" as const }
      ]
    });
    await signIn(client);
    openView("任务");

    expect(screen.getByText("进行中（1）")).toBeTruthy();
    expect(screen.getByText("已完成（1）")).toBeTruthy();
    expect(screen.getByText("失败（1）")).toBeTruthy();
  });

  it("retries a failed task with its own request fields", async () => {
    const failed: GenerationTask = {
      id: "t-fail",
      mode: "text",
      status: "failed",
      prompt: "原始提示词",
      optimizedPrompt: "优化提示词",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      resultPreview: { title: "生成任务", description: "失败了" },
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    };
    const fake = createFakeClient();
    const createGeneration = vi.fn(fake.createGeneration);
    const client = createFakeClient({ createGeneration, listGenerations: async () => [failed] });
    await signIn(client);
    openView("任务");

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await vi.waitFor(() => expect(createGeneration).toHaveBeenCalled());
    const request = createGeneration.mock.calls[0][0];
    expect(request).toMatchObject({ mode: "text", prompt: "原始提示词", optimizedPrompt: "优化提示词" });
    const canvas = await screen.findByLabelText("结果画布");
    await within(canvas).findByText("真实生成文案");
  });

  it("opens a task onto the studio canvas", async () => {
    const done: GenerationTask = {
      id: "t-done",
      mode: "text",
      status: "succeeded",
      prompt: "p",
      optimizedPrompt: "op",
      preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
      resultPreview: { title: "生成任务", description: "已生成。" },
      result: { kind: "text", text: "跳转查看内容", format: "plain" },
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    };
    const client = createFakeClient({ listGenerations: async () => [done] });
    await signIn(client);
    openView("任务");
    fireEvent.click(screen.getByLabelText("打开任务 t-done"));
    const canvas = screen.getByLabelText("结果画布");
    expect(within(canvas).getByText("跳转查看内容")).toBeTruthy();
  });
```

同时更新既有用例：`keeps the generated task listed in the tasks view` 的 `已完成` 断言改为 `已完成（1）` 组标题或行内状态 pill（用 `within` 定位行）；`auto-polls a running task to completion` 中对 `已完成` 的等待改为 `await screen.findByText("已完成（1）")`（或轮询后行内 pill）；`refreshes a running task from the task center` 保持 `刷新状态` 按钮交互，若其断言涉及行内结果文本，改为跳转画布断言。

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "task"`
Expected: FAIL。

- [ ] **Step 3: Implement**

`views/TasksView.tsx` 重写：

```tsx
import type { GenerationTask, GenerationTaskStatus } from "@gw-link-omniai/shared";
import { getGenerationStatusLabel, summarizeGenerationPrompt } from "../generationModel";
import { getStudioModeContent } from "../studioModel";

export interface TasksViewProps {
  tasks: GenerationTask[];
  onOpenTask(taskId: string): void;
  onRetryTask(task: GenerationTask): void;
  onRefreshTask(task: GenerationTask): void;
}

const groups: Array<{ title: string; statuses: GenerationTaskStatus[] }> = [
  { title: "进行中", statuses: ["queued", "running"] },
  { title: "已完成", statuses: ["succeeded"] },
  { title: "失败", statuses: ["failed"] }
];

export function TasksView({ tasks, onOpenTask, onRetryTask, onRefreshTask }: TasksViewProps) {
  return (
    <section aria-label="任务中心" className="task-groups">
      {tasks.length === 0 ? (
        <div className="canvas-empty">
          <h2>暂无生成任务</h2>
          <p>去创作视图提交一个想法吧。</p>
        </div>
      ) : (
        groups.map((group) => {
          const groupTasks = tasks.filter((task) => group.statuses.includes(task.status));
          if (groupTasks.length === 0) {
            return null;
          }
          return (
            <div key={group.title} className="task-group">
              <h2>{`${group.title}（${groupTasks.length}）`}</h2>
              <div className="stack">
                {groupTasks.map((task) => (
                  <article key={task.id} className="task-row">
                    <div className="grow">
                      <div className="row">
                        <h3>{getStudioModeContent(task.mode).title}</h3>
                        <span className={`status status--${task.status}`}>{getGenerationStatusLabel(task.status)}</span>
                      </div>
                      <p className="muted">{summarizeGenerationPrompt(task)}</p>
                      <p className="muted">
                        {task.preset.modelId} · 预计点数 {task.preset.creditEstimate.credits}
                      </p>
                    </div>
                    <div className="actions" style={{ marginTop: 0 }}>
                      {task.status === "running" ? (
                        <button type="button" className="btn-sm" onClick={() => onRefreshTask(task)}>
                          刷新状态
                        </button>
                      ) : null}
                      {task.status === "failed" ? (
                        <button type="button" className="btn-sm" onClick={() => onRetryTask(task)}>
                          重试
                        </button>
                      ) : null}
                      <button type="button" className="btn-sm" aria-label={`打开任务 ${task.id}`} onClick={() => onOpenTask(task.id)}>
                        打开
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
```

`App.tsx`：TasksView 调用点改为：

```tsx
            <TasksView
              tasks={tasks}
              onOpenTask={(taskId) => {
                setSelectedTaskId(taskId);
                setView("studio");
              }}
              onRetryTask={(task) => void handleRetryTask(task)}
              onRefreshTask={(task) => void handleRefreshTask(task)}
            />
```

（`handleSaveAsset` 不再从 TasksView 触达，保留在画布。）

- [ ] **Step 4: Run full suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/TasksView.tsx apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): grouped task center with retry and open-on-canvas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: AccountView 账户收纳 + 购买弹层

**Files:**
- Modify: `apps/desktop/src/views/AccountView.tsx`（加账户信息卡 + 购买弹层）、`apps/desktop/src/App.tsx`（`purchaseOpen` 状态 + Esc）、`apps/desktop/src/__tests__/App.test.tsx`

**Interfaces:**
- Produces: 账户信息卡 `aria-label="账户信息"`（displayName / destination / plan）；`选购套餐` 按钮打开弹层 `aria-label="购买积分"`（`.modal-backdrop > .modal`）；弹层内套餐行 + `购买 {displayName}` 按钮；购买后弹层内「最新订单」块显示 `去支付` 链接 + `（开发）完成支付`；`关闭` 按钮与 Esc 关闭弹层；订单列表原有锚点不变（`查看/收起`、`订单详情`、`收据`、`复制收据`、pending 行的 `去支付`/`（开发）完成支付` 保留）。AccountView props 追加 `session: SessionResponse; purchaseOpen: boolean; onOpenPurchase(): void; onClosePurchase(): void;`。

- [ ] **Step 1: Write failing tests**

更新 `buys a package (pending + pay link), then dev-completes it`：`openView("账户")` 后先 `fireEvent.click(screen.getByRole("button", { name: "选购套餐" }))`，再在 `screen.getByLabelText("购买积分")` 弹层内点击 `购买 100 积分`；`去支付` 链接与 `（开发）完成支付` 断言在弹层内 `within(...)` 完成；dev 完成后断言弹层内出现 `已支付` 且余额更新（原断言逻辑保留）。

新增：

```tsx
  it("shows the signed-in identity on the account view", async () => {
    const client = createFakeClient();
    await signIn(client);
    openView("账户");
    const card = screen.getByLabelText("账户信息");
    expect(within(card).getByText("creator")).toBeTruthy();
    expect(within(card).getByText("creator@example.com")).toBeTruthy();
  });

  it("closes the purchase modal with Escape", async () => {
    const client = createFakeClient();
    await signIn(client);
    openView("账户");
    fireEvent.click(screen.getByRole("button", { name: "选购套餐" }));
    expect(screen.getByLabelText("购买积分")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("购买积分")).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "account"`
Expected: FAIL。

- [ ] **Step 3: Implement**

`views/AccountView.tsx`：

1. props 追加（见 Interfaces）；import 增 `SessionResponse`。
2. `account-grid` 最前插入账户信息卡：

```tsx
      <section aria-label="账户信息" className="card stack">
        <h2>账户</h2>
        {session.user ? (
          <>
            <p>{session.user.displayName}</p>
            <p className="muted">{session.user.destination}</p>
            <p className="muted">套餐计划：{session.user.plan}</p>
          </>
        ) : null}
      </section>
```

3. 「点数余额」卡内 `充值` 按钮旁加：

```tsx
            <button type="button" className="btn-primary btn-sm" onClick={onOpenPurchase}>
              选购套餐
            </button>
```

4. 原「积分套餐」card 整段移入弹层；组件末尾渲染：

```tsx
      {purchaseOpen ? (
        <div className="modal-backdrop" onClick={onClosePurchase}>
          <div aria-label="购买积分" className="modal stack" role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="row">
              <h2>购买积分</h2>
              <div className="spacer" />
              <button type="button" className="btn-sm" onClick={onClosePurchase}>
                关闭
              </button>
            </div>
            {packages.map((pkg) => (
              <div className="pkg" key={pkg.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{pkg.displayName}</div>
                  <div className="pkg-meta">{pkg.credits} 积分</div>
                </div>
                <div className="row">
                  <span className="pkg-price">{formatPackagePrice(pkg)}</span>
                  <button type="button" className="btn-primary btn-sm" onClick={() => onBuy(pkg)}>
                    购买 {pkg.displayName}
                  </button>
                </div>
              </div>
            ))}
            {orders[0] && orders[0].status === "pending" ? (
              <div className="item stack">
                <h3>最新订单</h3>
                <div className="actions" style={{ marginTop: 0 }}>
                  {orders[0].checkoutUrl ? <a href={orders[0].checkoutUrl}>去支付</a> : null}
                  <button type="button" className="btn-sm" onClick={() => onDevComplete(orders[0].id)}>
                    （开发）完成支付
                  </button>
                </div>
              </div>
            ) : null}
            {orders[0] && orders[0].status === "paid" ? (
              <p className="muted">
                最新订单：<span className="status status--paid">已支付</span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
```

（若「已支付」文案与订单列表状态 pill 精确匹配冲突，测试断言用 `within(screen.getByLabelText("购买积分"))` 限定。）

`App.tsx`：`const [purchaseOpen, setPurchaseOpen] = useState(false);`；Esc 分支补 `setPurchaseOpen(false);`；`handleSignedOut` 补 `setPurchaseOpen(false);`；AccountView 传 `session={session} purchaseOpen={purchaseOpen} onOpenPurchase={() => setPurchaseOpen(true)} onClosePurchase={() => setPurchaseOpen(false)}`。

- [ ] **Step 4: Run full suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/views/AccountView.tsx apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx
git commit -m "feat(desktop): account view with identity card and purchase modal flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: ToastHost 全局通知 + 加载错误横幅 + 文档收尾

**Files:**
- Create: `apps/desktop/src/components/ToastHost.tsx`
- Modify: `apps/desktop/src/App.tsx`（toasts 状态、完成/失败检测、copyNotice/actionError 迁移为 toast、loadError 横幅）、`apps/desktop/src/__tests__/App.test.tsx`、`docs/architecture/mvp-skeleton.md`

**Interfaces:**
- Consumes: Task 3 的 toastModel。
- Produces: `ToastHost({ toasts, onDismiss })` — 容器 `aria-label="通知"` class `toasts`；error toast `role="alert"`、其余 `role="status"`；每条有 `aria-label="关闭通知"` 的按钮。App `notify(kind, message)`（id 用 `useRef` 计数器 `toast-${n}`）；1s interval 调 `expireToasts`（仅当有 toast）；任务由活跃转 `succeeded`/`failed` 时 toast `生成完成`/`生成失败`（用 `tasksRef` 读取前值，避免在 setState updater 里发副作用）；`copyNotice`/`actionError` 状态与横幅删除，改为 `notify`（错误类文案不变：`积分不足，无法生成`、`复制失败，请重试`、`已复制收据`、`已复制文本`）；`loadUserData` 失败设 `loadError`，视图顶部横幅 `部分数据加载失败` + `重新加载` 按钮。

- [ ] **Step 1: Write failing tests**

```tsx
  it("toasts when a polled task completes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const running: GenerationTask = {
        id: "t-poll",
        mode: "text",
        status: "running",
        prompt: "p",
        optimizedPrompt: "op",
        preset: { modelId: "gw-text-balanced", parameters: {}, creditEstimate: { credits: 1, unit: "credit" } },
        resultPreview: { title: "生成任务", description: "进行中" },
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z"
      };
      const done: GenerationTask = { ...running, status: "succeeded", result: { kind: "text", text: "完成内容", format: "plain" } };
      let polled = false;
      const client = createFakeClient({
        listGenerations: async () => [running],
        getGeneration: async () => {
          polled = true;
          return done;
        }
      });
      await signIn(client);
      await vi.advanceTimersByTimeAsync(5100);
      expect(polled).toBe(true);
      const host = screen.getByLabelText("通知");
      await within(host).findByText("生成完成");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses a toast manually", async () => {
    const client = createFakeClient({
      createGeneration: async () => {
        throw new ApiError("Insufficient credits", 402);
      }
    });
    await signIn(client);
    fireEvent.click(screen.getByRole("button", { name: "优化提示词" }));
    await screen.findByLabelText("提示词优化结果");
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    const host = screen.getByLabelText("通知");
    await within(host).findByText("积分不足，无法生成");
    fireEvent.click(within(host).getByRole("button", { name: "关闭通知" }));
    expect(within(host).queryByText("积分不足，无法生成")).toBeNull();
  });

  it("shows a reload banner when user data fails to load", async () => {
    let packageCalls = 0;
    const client = createFakeClient({
      listPackages: async () => {
        packageCalls += 1;
        if (packageCalls === 1) {
          throw new ApiError("boom", 500);
        }
        return [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }];
      }
    });
    await signIn(client);
    await screen.findByText("部分数据加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    openView("账户");
    await screen.findByText("100 积分");
  });
```

既有用例调整：`shows a friendly message when generation is rejected for insufficient credits` 的 `role="alert"` 断言仍成立（error toast 是 alert），但文案查找范围改为通知容器；`copies a paid order's receipt to the clipboard` 的 `已复制收据` 变为 toast 文本（`findByText` 不变）。删除对 `alert--ok` 横幅的任何结构性断言（若有）。

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @gw-link-omniai/desktop exec vitest run src/__tests__/App.test.tsx -t "toast"`
Expected: FAIL。

- [ ] **Step 3: Implement**

`components/ToastHost.tsx`：

```tsx
import type { Toast } from "../toastModel";

export interface ToastHostProps {
  toasts: Toast[];
  onDismiss(id: string): void;
}

export function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  return (
    <div className="toasts" aria-label="通知">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭通知" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

`App.tsx`：

1. 状态与工具：

```tsx
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const toastIdRef = useRef(0);
  const tasksRef = useRef<GenerationTask[]>([]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  function notify(kind: ToastKind, message: string) {
    toastIdRef.current += 1;
    setToasts((prev) =>
      pushToast(prev, { id: `toast-${toastIdRef.current}`, kind, message, createdAt: new Date().toISOString() })
    );
  }

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    const interval = setInterval(() => {
      setToasts((prev) => expireToasts(prev, new Date().toISOString()));
    }, 1000);
    return () => clearInterval(interval);
  }, [toasts.length]);
```

（import：`useRef`、`pushToast, expireToasts, dismissToast, type Toast, type ToastKind` 与 `ToastHost`。）

2. 完成/失败检测（`pollRunningTasks` 与 `handleRefreshTask` 里，取到 `updated` 后、setTasks 之前）：

```tsx
      const before = tasksRef.current.find((task) => task.id === updated.id);
      if (before && (before.status === "queued" || before.status === "running")) {
        if (updated.status === "succeeded") {
          notify("success", "生成完成");
        } else if (updated.status === "failed") {
          notify("error", "生成失败");
        }
      }
```

3. 迁移：删除 `copyNotice`/`actionError` 状态与两条横幅；所有 `setActionError(msg)` 改 `notify("error", msg)`（`setActionError(undefined)` 直接删除）；`setCopyNotice("已复制收据")` → `notify("success", "已复制收据")`；`setCopyNotice("已复制文本")` 同理。`handleBuy` 成功后追加 `notify("success", "订单已创建，请完成支付");`，`handleDevComplete` 成功后追加 `notify("success", "支付完成，点数已到账");`（购买/支付用例若受额外文案影响，断言用 `within` 限定原目标区域）。`handleSignedOut` 里补 `setToasts([]); setLoadError(undefined);`。
4. loadUserData 失败横幅：`handleVerifyLogin`/`restoreSession` 中 `await loadUserData(...)` 包成：

```tsx
      try {
        await loadUserData(authSession.token);
        setLoadError(undefined);
      } catch {
        setLoadError("部分数据加载失败");
      }
```

`.view` 顶部渲染：

```tsx
          {loadError ? (
            <div role="alert" className="alert alert--error" style={{ marginBottom: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <span>{loadError}</span>
              <button
                type="button"
                className="btn-sm"
                onClick={() => {
                  if (token) {
                    setLoadError(undefined);
                    void loadUserData(token).catch(() => setLoadError("部分数据加载失败"));
                  }
                }}
              >
                重新加载
              </button>
            </div>
          ) : null}
```

5. 外层（workspace div 内、与 `.main` 平级）渲染 `<ToastHost toasts={toasts} onDismiss={(id) => setToasts((prev) => dismissToast(prev, id))} />`。未认证分支也在 `AuthScreen` 旁渲染 ToastHost（包一层 fragment）。

- [ ] **Step 4: Update docs**

`docs/architecture/mvp-skeleton.md` 的桌面端章节追加：

```markdown
桌面端（Slice 30 起）为三栏生成器工作台：左侧图标导航（创作/资产库/任务/账户，任务角标）、中部结果画布 + 历史条 + 悬浮提示词条（一键 optimize+submit）、右侧参数检查器（模型覆盖、优化词编辑）。资产库为网格 + 详情侧板，任务中心按状态分组支持失败重试，商务功能收纳进账户视图（购买走弹层）。全局 toast、Cmd/Ctrl+Enter 与 Cmd/Ctrl+1..4 快捷键。视觉为深空 token 化设计系统（`apps/desktop/src/styles/`），无新增依赖。
```

- [ ] **Step 5: Run full suite + typecheck（全仓）**

Run: `pnpm --filter @gw-link-omniai/desktop test && pnpm --filter @gw-link-omniai/desktop typecheck && pnpm typecheck`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/ToastHost.tsx apps/desktop/src/App.tsx apps/desktop/src/__tests__/App.test.tsx docs/architecture/mvp-skeleton.md
git commit -m "feat(desktop): global toast notifications, load-error banner and docs update

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完成后

1. 最终全分支 review（对 `git merge-base main HEAD` 的完整 diff）。
2. `pnpm test`（root，含 workspace 测试）+ `pnpm typecheck` 全绿。
3. 手动验收：`pnpm dev:api` + `cd apps/desktop && pnpm dev`（浏览器 :1420）或 `pnpm tauri dev` 过一遍：登录 → 模板点击 → 一键生成 → 画布展示 → 保存资产 → 资产详情/下载 → 任务分组/重试 → 账户购买弹层 → toast。
4. finishing-a-development-branch：`--no-ff` 合并 main，fetch 核对分歧后推送。
