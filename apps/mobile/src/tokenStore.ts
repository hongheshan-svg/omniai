import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "gw-link-omniai.token";

export interface TokenStore {
  save(token: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

export function createAsyncStorageTokenStore(): TokenStore {
  return {
    async save(token: string): Promise<void> {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    },
    async load(): Promise<string | null> {
      return await AsyncStorage.getItem(TOKEN_KEY);
    },
    async clear(): Promise<void> {
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
  };
}
