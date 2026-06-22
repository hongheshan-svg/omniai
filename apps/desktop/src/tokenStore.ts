export interface TokenStore {
  load(): string | undefined;
  save(token: string): void;
  clear(): void;
}

const TOKEN_KEY = "gw-link-omniai.token";

export function createLocalStorageTokenStore(): TokenStore {
  const storage = typeof localStorage === "undefined" ? undefined : localStorage;
  return {
    load: () => storage?.getItem(TOKEN_KEY) ?? undefined,
    save: (token) => storage?.setItem(TOKEN_KEY, token),
    clear: () => storage?.removeItem(TOKEN_KEY)
  };
}
