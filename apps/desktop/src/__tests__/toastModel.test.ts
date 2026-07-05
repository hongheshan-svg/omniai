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
