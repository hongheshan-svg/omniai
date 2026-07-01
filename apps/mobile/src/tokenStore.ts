import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "gw-link-omniai.token";

export interface TokenStore {
  save(token: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

export function createSecureTokenStore(): TokenStore {
  return {
    async save(token: string): Promise<void> {
      await SecureStore.setItemAsync(TOKEN_KEY, token, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
      });
    },
    async load(): Promise<string | null> {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    },
    async clear(): Promise<void> {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
  };
}
