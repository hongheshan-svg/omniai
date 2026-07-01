import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock AsyncStorage
const mockStorage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    setItem: async (k: string, v: string) => {
      mockStorage.set(k, v);
    },
    getItem: async (k: string) => mockStorage.get(k) ?? null,
    removeItem: async (k: string) => {
      mockStorage.delete(k);
    }
  }
}));

const { createAsyncStorageTokenStore } = await import("../tokenStore.js");

describe("TokenStore", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  afterEach(() => {
    mockStorage.clear();
  });

  it("saves and loads token", async () => {
    const store = createAsyncStorageTokenStore();
    await store.save("test-token-123");
    const loaded = await store.load();
    expect(loaded).toBe("test-token-123");
  });

  it("load returns null when no token", async () => {
    const store = createAsyncStorageTokenStore();
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it("clear removes token", async () => {
    const store = createAsyncStorageTokenStore();
    await store.save("test-token");
    await store.clear();
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });
});
