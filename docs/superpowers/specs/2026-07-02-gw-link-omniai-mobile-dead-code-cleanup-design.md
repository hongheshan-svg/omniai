# GW-LINK OmniAI Mobile 死代码清理设计规格

**日期**: 2026-07-02
**Slice**: 19 — Mobile 死代码清理

---

## 摘要

删除 mobile 的三个死文件——`homeModel.ts`、`sessionModel.ts`、`__tests__/homeModel.test.ts`——它们是 Slice 4 Expo skeleton 的遗留，Slice 13 用 `appModel` 取代后再无生产引用。

## 动机

`getMobileHomeActions`（homeModel）和 `getMobileSessionCta`（sessionModel）曾用于早期占位壳。Slice 13 引入 `createMobileAppController` + 单屏 `App.tsx` 后，这两个模块不再被任何生产代码引用；`homeModel.test.ts` 只测这段死代码。opus 在 Slice 13 最终审查中标记为 follow-up。本切片清除这笔负债。

## 死代码确认（grep 已验证）

- `sessionModel.ts`（`getMobileSessionCta`）：仅被 `homeModel.ts` 与 `homeModel.test.ts` 引用。
- `homeModel.ts`（`getMobileHomeActions`）：仅被 `homeModel.test.ts` 引用。
- `homeModel.test.ts`：仅测上述两者（4 个断言块）。
- `App.tsx`、入口 `index.ts`、根 `tests/workspace.test.mjs`、架构文档均无引用。

## 设计

删除三个文件：
- `apps/mobile/src/homeModel.ts`
- `apps/mobile/src/sessionModel.ts`
- `apps/mobile/src/__tests__/homeModel.test.ts`

无生产代码改动（无人 import）。删除后 mobile 测试从 29 降到 25（appModel 20 + tokenStore 3 + resultModel 2）。

## 非目标

- 不碰 `apps/admin/src/sessionModel.ts`（活代码，被 `appShell` 的 `getAdminSessionBanner` 使用）。
- 不改文档（README / mvp-skeleton 未提及这些文件）。
- 不动其他 mobile 文件。

## 测试策略

纯删除，无新测试。验收 = 删除后 `pnpm test`（mobile 25，其余不变）+ `pnpm typecheck` 全绿；`grep -rn "homeModel\|sessionModel\|getMobileHomeActions\|getMobileSessionCta" apps/mobile` 返回空。

## 任务分解

1. 删除三个文件 + 验证全量绿 + grep 确认无残留 + 提交。

## 交付清单

- [ ] 删除 homeModel.ts / sessionModel.ts / homeModel.test.ts
- [ ] `pnpm test`（mobile 25）+ `pnpm typecheck` 全绿
- [ ] grep 确认 apps/mobile 无残留引用
