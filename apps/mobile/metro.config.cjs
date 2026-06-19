const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const expoNodeModules = path.resolve(
  path.dirname(require.resolve("expo/package.json")),
  ".."
);

config.resolver.nodeModulesPaths = Array.from(
  new Set([...(config.resolver.nodeModulesPaths ?? []), expoNodeModules])
);

module.exports = config;
