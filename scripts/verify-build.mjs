import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const required = [
  "manifest.json",
  "popup.html",
  "offscreen.html",
  "background.js",
  "content.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png"
];

for (const file of required) {
  await access(join(dist, file), constants.R_OK);
}

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest V3가 아닙니다.");
if (!manifest.permissions.includes("offscreen")) throw new Error("offscreen 권한이 없습니다.");
if (!manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'")) {
  throw new Error("WASM CSP가 없습니다.");
}

const assetFiles = await readdir(join(dist, "assets"));
const bundledWasmFiles = assetFiles.filter((file) => file.endsWith(".wasm"));
const bundledWasmFactories = assetFiles.filter(
  (file) => file.includes("ort-wasm-simd-threaded") && file.endsWith(".mjs")
);
const runtimeFiles = await readdir(join(dist, "wasm"));
const wasmFiles = [
  ...bundledWasmFiles,
  ...runtimeFiles.filter((file) => file.endsWith(".wasm"))
];
const wasmFactories = [
  ...bundledWasmFactories,
  ...runtimeFiles.filter((file) => file.endsWith(".mjs"))
];
if (wasmFiles.length === 0) throw new Error("로컬 ONNX Runtime WASM 파일이 없습니다.");
if (wasmFactories.length === 0) throw new Error("로컬 ONNX Runtime factory가 없습니다.");

const scripts = await Promise.all(
  ["background.js", "content.js"].map((file) => readFile(join(dist, file), "utf8"))
);
if (scripts.some((source) => /import\s*\(\s*["']https?:\/\//.test(source))) {
  throw new Error("원격 실행 코드를 참조합니다.");
}

console.log(
  `Verified MV3 package: ${required.length} core files, ${wasmFiles.length} WASM runtime`
);
