import { afterEach, describe, expect, it } from "vitest";
import { createLocalStorageTokenStore } from "../tokenStore";

afterEach(() => localStorage.clear());

describe("createLocalStorageTokenStore", () => {
  it("saves, loads, and clears a token", () => {
    const store = createLocalStorageTokenStore();
    expect(store.load()).toBeUndefined();

    store.save("tok-1");
    expect(store.load()).toBe("tok-1");

    store.clear();
    expect(store.load()).toBeUndefined();
  });
});
