import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const TRANSFORMERS_REMOTE_WASM_DEFAULTS = [
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@\$\{[^}]+\}\/dist\//g,
  /https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\$\{[^}]+\}\/dist\//g
];

export default defineConfig({
  plugins: [localTransformersWasmPlugin()],
  resolve: {
    conditions: ["onnxruntime-web-use-extern-wasm"]
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        offscreen: resolve(import.meta.dirname, "offscreen.html")
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".wasm")
            ? "wasm/[name][extname]"
            : "assets/[name]-[hash][extname]"
      }
    }
  }
});

function localTransformersWasmPlugin(): Plugin {
  return {
    name: "ongeul-local-transformers-wasm",
    enforce: "post",
    renderChunk(code) {
      const localized = TRANSFORMERS_REMOTE_WASM_DEFAULTS.reduce(
        (source, pattern) => source.replace(pattern, "wasm/"),
        code
      );
      return localized === code ? null : { code: localized, map: null };
    }
  };
}
