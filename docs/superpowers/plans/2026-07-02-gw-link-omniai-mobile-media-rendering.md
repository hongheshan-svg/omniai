# Mobile Media Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render image and video generation results (and saved assets) in the mobile app as thumbnails, not just text.

**Architecture:** Add a framework-free `formatDuration` helper (mm:ss) unit-tested with vitest. Extend the thin `App.tsx` task-row and asset-row renderers to show image results via RN's built-in `Image` and video results via a `posterUrl` thumbnail + duration label. No new dependency; no inline playback.

**Tech Stack:** React Native 0.74 (built-in `Image`), Expo 51, vitest.

## Global Constraints

- Image → RN built-in `Image` (`<Image source={{ uri }} accessibilityLabel={alt} style={styles.media} />`); no new dependency.
- Video → `posterUrl` thumbnail via `Image` + `<Text>时长 {formatDuration(durationSeconds)}</Text>`; NO inline playback (deferred).
- `formatDuration(seconds)` → `mm:ss` (e.g. `15`→`"0:15"`, `90`→`"1:30"`, `3661`→`"61:01"`); non-finite/0/negative → `"0:00"`.
- Render at BOTH sites: task rows (`GenerationTask.result`) and asset rows (`CreationAsset.content`). Text result unchanged (asset text needs no extra render — summary covers it).
- App.tsx is a thin RN view, typecheck-only (NOT unit-tested — RN can't render under vite-node). The only unit-tested unit is `formatDuration`.
- `media` style: `{ width: 160, height: 120, marginTop: 8 }`.
- Non-goals: inline video playback, image zoom/fullscreen/gallery, load-placeholder/retry UI, desktop changes.
- Each task green before commit.

---

## Task 1: mobile resultModel.formatDuration

**Files:**
- Create: `apps/mobile/src/resultModel.ts`
- Test: `apps/mobile/src/__tests__/resultModel.test.ts`

**Interfaces:**
- Produces: `formatDuration(seconds: number): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/__tests__/resultModel.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatDuration } from "../resultModel";

describe("formatDuration", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(15)).toBe("0:15");
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("clamps non-finite or negative input to 0:00", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/resultModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement resultModel**

Create `apps/mobile/src/resultModel.ts`:

```typescript
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gw-link-omniai/mobile exec vitest run src/__tests__/resultModel.test.ts`
Expected: PASS (2 tests / 7 assertions).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: no errors.

```bash
git add apps/mobile/src/resultModel.ts apps/mobile/src/__tests__/resultModel.test.ts
git commit -m "feat(mobile): add formatDuration helper for video results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: App.tsx image/video rendering

**Files:**
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: `formatDuration` (Task 1); RN `Image`; `GenerationTask.result` / `CreationAsset.content` (shared union: `text|image|video`).

- [ ] **Step 1: Add `Image` to the react-native import**

In `apps/mobile/App.tsx`, change line 2:

```typescript
import { SafeAreaView, View, Text, TextInput, Button, FlatList, StyleSheet } from "react-native";
```
to:
```typescript
import { SafeAreaView, View, Text, TextInput, Button, FlatList, Image, StyleSheet } from "react-native";
```

- [ ] **Step 2: Add the formatDuration import**

After the `createMobileAppController` import line (currently the last import), add:

```typescript
import { formatDuration } from "./src/resultModel";
```

- [ ] **Step 3: Render image/video in the task row**

In the task `FlatList` `renderItem`, replace this block:

```tsx
                {item.result?.kind === "text" ? <Text numberOfLines={2}>结果: {item.result.text}</Text> : null}
```
with:
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

- [ ] **Step 4: Render image/video in the asset row**

In the asset `FlatList` `renderItem`, replace this block:

```tsx
              <View style={styles.task}>
                <Text>{getAssetModeLabel(item.mode)}</Text>
                <Text numberOfLines={1}>{summarizeAssetPrompt(item)}</Text>
              </View>
```
with:
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

- [ ] **Step 5: Add the media style**

In the `StyleSheet.create({...})`, add a `media` entry. Change:

```typescript
  task: { padding: 8, borderBottomWidth: 1, borderColor: "#ccc" },
```
to:
```typescript
  task: { padding: 8, borderBottomWidth: 1, borderColor: "#ccc" },
  media: { width: 160, height: 120, marginTop: 8 },
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: no errors. (App.tsx is typecheck-only; media rendering is not unit-tested — RN can't render under vite-node.)

- [ ] **Step 7: Run the mobile suite + full workspace**

Run: `pnpm --filter @gw-link-omniai/mobile test`
Expected: existing mobile tests + resultModel all pass (appModel 20 + tokenStore 3 + homeModel 4 + resultModel 2 = 29).

Run: `pnpm test`
Expected: all packages green.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): render image and video results as thumbnails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README.md**

Under `### Mobile API Integration`, change the "Core flow" bullet's tail. Change:

```markdown
- Core flow: login, submit a generation, list your tasks, show balance, refresh a
  `running` task's status, and save a succeeded result to a filtered asset
  library. Top-up and image/video rendering remain later slices.
```
to:
```markdown
- Core flow: login, submit a generation, list your tasks (image/video results and
  saved assets render as thumbnails, video with a poster + duration), show balance,
  refresh a `running` task's status, and save a succeeded result to a filtered asset
  library. Inline video playback and top-up remain later slices.
```

- [ ] **Step 2: Update mvp-skeleton.md**

Under `## Mobile API Integration Slice`, append after the existing final sentence:

```markdown
Image results (and saved image assets) render via React Native's built-in `Image`;
video results render a `posterUrl` thumbnail plus a `formatDuration` (mm:ss) label
— inline playback is deferred. `App.tsx` stays typecheck-only, so the media
rendering is not unit-tested; the framework-free `formatDuration` helper carries
the unit coverage.
```

- [ ] **Step 3: Full workspace validation**

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document mobile media rendering (Slice 17)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ formatDuration + test (spec §1) → Task 1
- ✅ task-row image/video render (spec §2) → Task 2 Step 3
- ✅ asset-row image/video render (spec §2) → Task 2 Step 4
- ✅ media style (spec §2) → Task 2 Step 5
- ✅ Image import + formatDuration import (spec §2) → Task 2 Steps 1-2
- ✅ docs (spec §文档) → Task 3
- ✅ non-goals honored (no playback, no zoom, no desktop change)

**Placeholder scan:** none — all code/commands/expected outputs concrete.

**Type consistency:** `formatDuration(seconds: number): string` consistent across helper, test, and both App.tsx call sites. `result?.kind` (task) and `content.kind` (asset) both discriminate the same `text|image|video` union with fields `url`/`alt` (image) and `url`/`posterUrl`/`durationSeconds` (video). `styles.media` referenced after definition.
