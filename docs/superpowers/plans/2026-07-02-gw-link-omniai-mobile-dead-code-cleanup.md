# Mobile Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the three unreferenced mobile skeleton files left over from Slice 4.

**Architecture:** Pure deletion — `homeModel.ts`, `sessionModel.ts`, and `homeModel.test.ts` have no production importers (verified by grep). Removing them drops the 4 homeModel tests; no other code changes.

**Tech Stack:** git, vitest, tsc.

## Global Constraints

- Delete ONLY: `apps/mobile/src/homeModel.ts`, `apps/mobile/src/sessionModel.ts`, `apps/mobile/src/__tests__/homeModel.test.ts`.
- Do NOT touch `apps/admin/src/sessionModel.ts` (live — used by admin `appShell`).
- No production code edits (nothing imports the deleted files). No doc changes.
- After deletion: mobile suite 29 → 25 (appModel 20 + tokenStore 3 + resultModel 2); full workspace + typechecks stay green; `grep -rn "homeModel\|sessionModel\|getMobileHomeActions\|getMobileSessionCta" apps/mobile` returns nothing.

---

## Task 1: Delete the dead mobile skeleton files

**Files:**
- Delete: `apps/mobile/src/homeModel.ts`
- Delete: `apps/mobile/src/sessionModel.ts`
- Delete: `apps/mobile/src/__tests__/homeModel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (removal only).

- [ ] **Step 1: Confirm the files are unreferenced (pre-flight)**

Run: `grep -rn "homeModel\|sessionModel\|getMobileHomeActions\|getMobileSessionCta" apps/mobile --include="*.ts" --include="*.tsx"`
Expected: matches ONLY inside the three files being deleted (`homeModel.ts`, `sessionModel.ts`, `__tests__/homeModel.test.ts`). If any OTHER file matches, STOP and report — the deletion is not safe.

- [ ] **Step 2: Delete the three files**

```bash
git rm apps/mobile/src/homeModel.ts apps/mobile/src/sessionModel.ts apps/mobile/src/__tests__/homeModel.test.ts
```

- [ ] **Step 3: Verify no residual references**

Run: `grep -rn "homeModel\|sessionModel\|getMobileHomeActions\|getMobileSessionCta" apps/mobile --include="*.ts" --include="*.tsx"`
Expected: no output (empty).

- [ ] **Step 4: Run the mobile suite + typecheck**

Run: `pnpm --filter @gw-link-omniai/mobile test`
Expected: 25 tests (appModel 20 + tokenStore 3 + resultModel 2) — homeModel's 4 tests are gone.

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full workspace**

Run: `pnpm test`
Expected: all packages green (mobile 25; shared 33 / admin 6 / desktop 30 / api 239 unchanged).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git commit -m "chore(mobile): remove dead skeleton modules (homeModel, sessionModel)

Unreferenced since Slice 13 replaced the skeleton shell with appModel.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ delete the 3 files (spec §设计) → Task 1 Step 2
- ✅ verify no residual refs (spec §测试策略) → Task 1 Steps 1, 3
- ✅ full green (spec §交付清单) → Task 1 Steps 4-5
- ✅ non-goals honored (admin sessionModel untouched; no doc changes) → Global Constraints

**Placeholder scan:** none — exact paths + commands + expected outputs.

**Type consistency:** N/A (deletion only; no new symbols).
