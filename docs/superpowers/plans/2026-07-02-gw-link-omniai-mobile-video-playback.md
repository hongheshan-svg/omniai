# Mobile Video Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade mobile video results from a poster thumbnail to an inline `expo-av` player with native controls.

**Architecture:** Add `expo-av`; extract a `VideoResult` component (`<Video>` with poster + native controls + duration label) reused at both the task-row and asset-row video branches. Image/text rendering unchanged. `formatDuration` (Slice 17) moves from App.tsx into `VideoResult`.

**Tech Stack:** React Native 0.74, Expo 51, expo-av ~14.0.7, vitest.

## Global Constraints

- Dependency: `expo-av` `~14.0.7` (Expo SDK 51 compatible). No app.json config plugin needed for basic playback.
- `VideoResult({ uri, posterUrl, durationSeconds })` renders `<Video source={{uri}} posterSource={{uri: posterUrl}} usePoster useNativeControls resizeMode={ResizeMode.CONTAIN} style={styles.video} />` + `<Text>时长 {formatDuration(durationSeconds)}</Text>`.
- `video` style: `{ width: 240, height: 160, marginTop: 8 }`.
- `VideoResult` reused at BOTH sites: task rows (`item.result`, video) and asset rows (`item.content`, video). Image + text branches unchanged.
- App.tsx removes its direct `formatDuration` import (now used only inside `VideoResult`).
- `VideoResult` and `App.tsx` are typecheck-only (NOT unit-tested — RN can't render under vite-node). `formatDuration` is already unit-tested (Slice 17). Real playback needs device/simulator manual verification (out of automated scope).
- Non-goals: custom controls/scrubber/PiP/fullscreen mgmt, background audio, iOS/Android permission config, desktop changes, image zoom.
- Each task green before commit.

---

## Task 1: expo-av dependency + VideoResult + App.tsx wiring

**Files:**
- Modify: `apps/mobile/package.json` (add expo-av)
- Create: `apps/mobile/src/VideoResult.tsx`
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: `formatDuration` from `./resultModel` (Slice 17); `Video`, `ResizeMode` from `expo-av`.
- Produces: `VideoResult({ uri: string; posterUrl: string; durationSeconds: number })`.

- [ ] **Step 1: Add the expo-av dependency**

In `apps/mobile/package.json`, add to `dependencies` (keep alphabetical-ish, after `expo-secure-store`):

```json
"expo-av": "~14.0.7",
```

Then install:

Run: `pnpm install`
Expected: lockfile updates; expo-av resolved. (Peer-version warnings for RN are acceptable as long as typecheck passes — do not chase exact peer alignment.)

- [ ] **Step 2: Create VideoResult.tsx**

Create `apps/mobile/src/VideoResult.tsx`:

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

- [ ] **Step 3: Swap App.tsx imports**

In `apps/mobile/App.tsx`, remove this import line:

```typescript
import { formatDuration } from "./src/resultModel";
```
and add (after the `createMobileAppController` import line):

```typescript
import { VideoResult } from "./src/VideoResult";
```

- [ ] **Step 4: Replace the task-row video branch**

In the task `FlatList` `renderItem`, replace:

```tsx
                {item.result?.kind === "video" ? (
                  <>
                    <Image source={{ uri: item.result.posterUrl }} accessibilityLabel="视频封面" style={styles.media} />
                    <Text>时长 {formatDuration(item.result.durationSeconds)}</Text>
                  </>
                ) : null}
```
with:
```tsx
                {item.result?.kind === "video" ? (
                  <VideoResult uri={item.result.url} posterUrl={item.result.posterUrl} durationSeconds={item.result.durationSeconds} />
                ) : null}
```

- [ ] **Step 5: Replace the asset-row video branch**

In the asset `FlatList` `renderItem`, replace:

```tsx
                {item.content.kind === "video" ? (
                  <>
                    <Image source={{ uri: item.content.posterUrl }} accessibilityLabel="视频封面" style={styles.media} />
                    <Text>时长 {formatDuration(item.content.durationSeconds)}</Text>
                  </>
                ) : null}
```
with:
```tsx
                {item.content.kind === "video" ? (
                  <VideoResult uri={item.content.url} posterUrl={item.content.posterUrl} durationSeconds={item.content.durationSeconds} />
                ) : null}
```

(The image branches — `item.result?.kind === "image"` and `item.content.kind === "image"` — keep using `<Image>` with `styles.media`, unchanged. The `Image` import stays.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @gw-link-omniai/mobile typecheck`
Expected: no errors. (VideoResult + App.tsx are typecheck-only; expo-av ships its own types.)

- [ ] **Step 7: Run the mobile suite + full workspace**

Run: `pnpm --filter @gw-link-omniai/mobile test`
Expected: 29 (appModel 20 + tokenStore 3 + homeModel 4 + resultModel 2) — no regression (the media components aren't unit-tested).

Run: `pnpm test`
Expected: all packages green.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/package.json apps/mobile/src/VideoResult.tsx apps/mobile/App.tsx pnpm-lock.yaml
git commit -m "feat(mobile): inline video playback with expo-av

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/mvp-skeleton.md`

- [ ] **Step 1: Update README.md**

Under `### Mobile API Integration`, change the "Core flow" bullet's media clause. Change:

```markdown
- Core flow: login, submit a generation, list your tasks (image/video results and
  saved assets render as thumbnails, video with a poster + duration), show balance,
  refresh a `running` task's status, and save a succeeded result to a filtered asset
  library. Inline video playback and top-up remain later slices.
```
to:
```markdown
- Core flow: login, submit a generation, list your tasks (image results render via
  `Image`; video results play inline via `expo-av` with native controls + a poster
  and duration), show balance, refresh a `running` task's status, and save a
  succeeded result to a filtered asset library. Top-up remains a later slice.
```

- [ ] **Step 2: Update mvp-skeleton.md**

Under `## Mobile API Integration Slice`, append after the existing final sentence:

```markdown
Video results play inline via `expo-av` (`<Video>` with native controls and a
`usePoster` poster) through a small reused `VideoResult` component; the duration
label reuses `formatDuration`. `VideoResult` and `App.tsx` stay typecheck-only, so
actual playback is verified manually on a device/simulator rather than in the unit
suite.
```

- [ ] **Step 3: Full workspace validation**

Run: `pnpm test`
Expected: all packages green.

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture/mvp-skeleton.md
git commit -m "docs: document mobile inline video playback (Slice 18)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ expo-av dependency (spec §依赖) → Task 1 Step 1
- ✅ VideoResult component (spec §VideoResult) → Task 1 Step 2
- ✅ App.tsx import swap + both video branches (spec §App.tsx 接入) → Task 1 Steps 3-5
- ✅ typecheck-only / manual-playback note (spec §测试策略) → constraints + Task 1 Step 7 + Task 2 mvp-skeleton
- ✅ docs (spec §文档) → Task 2
- ✅ non-goals honored (no custom controls, no permission config, no desktop change)

**Placeholder scan:** none — all code/commands/expected outputs concrete.

**Type consistency:** `VideoResult({ uri, posterUrl, durationSeconds })` props match both call sites (`item.result.*` and `item.content.*`, both the video variant with `url`/`posterUrl`/`durationSeconds`). `formatDuration(seconds: number): string` reused from Slice 17. `ResizeMode`/`Video` from expo-av.
