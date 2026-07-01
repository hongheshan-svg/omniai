import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock expo-secure-store
const mockStorage = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  setItemAsync: async (k: string, v: string) => {
    mockStorage.set(k, v);
  },
  getItemAsync: async (k: string) => mockStorage.get(k) ?? null,
  deleteItemAsync: async (k: string) => {
    mockStorage.delete(k);
  }
}));

const { createSecureTokenStore } = await import("../tokenStore.js");

describe("TokenStore (secure)", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  afterEach(() => {
    mockStorage.clear();
  });

  it("saves and loads token", async () => {
    const store = createSecureTokenStore();
    await store.save("test-token-123");
    const loaded = await store.load();
    expect(loaded).toBe("test-token-123");
  });

  it("load returns null when no token", async () => {
    const store = createSecureTokenStore();
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it("clear removes token", async () => {
    const store = createSecureTokenStore();
    await store.save("test-token");
    await store.clear();
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });
});
