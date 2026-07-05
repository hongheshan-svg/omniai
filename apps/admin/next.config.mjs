/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@gw-link-omniai/shared"],
  // The shared package is consumed as TS source and its barrel uses NodeNext-style
  // ".js" specifiers (e.g. `from "./apiClient.js"`). Map them back to the real .ts
  // sources so Next's webpack can resolve them (tsx/vitest/tsc already do this).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"]
    };
    return config;
  }
};

export default nextConfig;
