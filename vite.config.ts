import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const TRANSFORMERS_REMOTE_WASM_DEFAULT =
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@\$\{[^}]+\}\/dist\//g;

export default defineConfig({
  plugins: [localTransformersWasmPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
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
      const localized = code.replace(TRANSFORMERS_REMOTE_WASM_DEFAULT, "wasm/");
      return localized === code ? null : { code: localized, map: null };
    }
  };
}
