import * as babel from "@babel/core";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// React Native (and its Expo/community-adjacent packages) ship raw Flow+ESM
// source (e.g. `import typeof X from './Y'`), which is the exact syntax Metro
// strips via @react-native/babel-preset. Plain esbuild/tsc cannot parse it,
// and @vitejs/plugin-react unconditionally skips anything under node_modules
// (see its transform hook), so we need our own transform for RN's node_modules
// source, mirroring what Metro/Jest would do at build/test time.
const nativeSourcePattern = /\/node_modules\/(react-native|@react-native|expo(-[a-z-]+)?|@expo)\//;
const transformablePattern = /\.[jt]sx?$/;

function reactNativeFlowTransform(): Plugin {
  return {
    name: "react-native-flow-transform",
    enforce: "pre",
    async transform(code, id) {
      const [filepath] = id.split("?");
      console.error("[rn-flow-transform] considering", filepath);
      if (!nativeSourcePattern.test(filepath) || !transformablePattern.test(filepath)) {
        return null;
      }
      console.error("[rn-flow-transform] TRANSFORMING", filepath);
      const result = await babel.transformAsync(code, {
        filename: filepath,
        babelrc: false,
        configFile: false,
        presets: ["babel-preset-expo"],
        sourceMaps: true
      });
      if (!result?.code) {
        return null;
      }
      return { code: result.code, map: result.map };
    }
  };
}

export default defineConfig({
  plugins: [reactNativeFlowTransform(), react()],
  test: {
    environment: "node",
    server: {
      deps: {
        inline: [nativeSourcePattern, "react-native"]
      }
    }
  }
});
