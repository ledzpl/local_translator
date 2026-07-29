import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const required = [
  "manifest.json",
  "popup.html",
  "offscreen.html",
  "privacy.html",
  "privacy.css",
  "background.js",
  "content.js",
  "PRIVACY_POLICY.md",
  "THIRD_PARTY_NOTICES.md",
  "LICENSES/transformers-js-Apache-2.0.txt",
  "LICENSES/onnxruntime-MIT.txt",
  "LICENSES/supertonic-code-MIT.txt",
  "LICENSES/huggingface-jinja-MIT.txt",
  "LICENSES/flatbuffers-Apache-2.0.txt",
  "LICENSES/guid-typescript-ISC.txt",
  "LICENSES/long-Apache-2.0.txt",
  "LICENSES/platform-MIT.txt",
  "LICENSES/protobufjs-and-helpers-BSD-3-Clause.txt",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png"
];
const pinnedRevisions = [
  "f7874a1ac60758872a4f78aac0df95b17b776994",
  "5c2c73ac70bee9c58f5a7ac5e84a36bee25db8ee",
  "9c374f0b7aca709787cea97b047bfbbd1559d177",
  "3cadd1ee6394adea1bd021217a0e650ede09a323"
];

for (const file of required) {
  await access(join(dist, file), constants.R_OK);
}

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest V3가 아닙니다.");
if (manifest.version !== packageJson.version) {
  throw new Error(`manifest/package 버전이 다릅니다: ${manifest.version}/${packageJson.version}`);
}
if (!manifest.permissions.includes("offscreen")) throw new Error("offscreen 권한이 없습니다.");
if (!manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'")) {
  throw new Error("WASM CSP가 없습니다.");
}

const files = await walkFiles(dist);
const relativeFiles = files.map((file) => relative(dist, file));
const sourceMaps = relativeFiles.filter((file) => file.endsWith(".map"));
if (sourceMaps.length > 0) {
  throw new Error(`릴리즈 패키지에 source map이 있습니다: ${sourceMaps.join(", ")}`);
}

const wasmFiles = files.filter((file) => extname(file) === ".wasm");
const wasmFactories = files.filter(
  (file) =>
    file.endsWith(".mjs") &&
    (
      file.includes("ort-wasm-simd-threaded.jsep") ||
      file.includes("ort-wasm-simd-threaded.asyncify")
    )
);
if (wasmFiles.length !== 2) {
  throw new Error(`ONNX Runtime WASM 변형은 정확히 두 개여야 합니다: ${wasmFiles.length}`);
}
if (wasmFactories.length !== 2) {
  throw new Error(`로컬 ONNX Runtime factory는 정확히 두 개여야 합니다: ${wasmFactories.length}`);
}

const executableFiles = files.filter((file) =>
  [".js", ".mjs", ".html"].includes(extname(file))
);
const executableSources = await Promise.all(
  executableFiles.map(async (file) => ({
    file: relative(dist, file),
    source: await readFile(file, "utf8")
  }))
);
const remoteCodePatterns = [
  /https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|cdn\.skypack\.dev)/i,
  /import\s*\(\s*["']https?:\/\//i,
  /importScripts\s*\(\s*["']https?:\/\//i,
  /new\s+(?:Shared)?Worker\s*\(\s*["']https?:\/\//i,
  /<script[^>]+src\s*=\s*["']https?:\/\//i,
  /fetch\s*\(\s*["']https?:\/\/[^"']+\.(?:js|mjs|wasm)(?:[?#][^"']*)?["']/i,
  /https?:\/\/[^\s"'`<>]+\/[^/\s"'`<>]+\.(?:mjs|wasm)(?:[?#][^\s"'`<>]*)?/i
];
for (const { file, source } of executableSources) {
  const matched = remoteCodePatterns.find((pattern) => pattern.test(source));
  if (matched) throw new Error(`${file}에서 원격 실행 코드 경로를 찾았습니다: ${matched}`);
}

const offscreenEntry = executableSources
  .find(({ file }) => /(?:^|\/)offscreen-[^/]+\.js$/.test(file));
if (!offscreenEntry) throw new Error("offscreen 실행 번들을 찾지 못했습니다.");
const packagedSource = executableSources.map(({ source }) => source).join("\n");
for (const revision of pinnedRevisions) {
  if (!packagedSource.includes(revision)) {
    throw new Error(`실행 번들에 고정 모델 revision이 없습니다: ${revision}`);
  }
}

const duplicateLargeFiles = await findDuplicateLargeFiles(files);
if (duplicateLargeFiles.length > 0) {
  throw new Error(`중복 대용량 파일이 있습니다: ${duplicateLargeFiles.join(" / ")}`);
}

const icon = await readRgbaPng(join(dist, "icons/icon-128.png"));
if (icon.width !== 128 || icon.height !== 128) {
  throw new Error("128px 스토어 아이콘 크기가 올바르지 않습니다.");
}
const bounds = alphaBounds(icon);
if (!bounds || bounds.minX < 16 || bounds.minY < 16 || bounds.maxX > 111 || bounds.maxY > 111) {
  throw new Error(`스토어 아이콘에 16px 투명 여백이 없습니다: ${JSON.stringify(bounds)}`);
}

const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size)))
  .reduce((sum, size) => sum + size, 0);
if (totalBytes > 55 * 1024 * 1024) {
  throw new Error(`릴리즈 패키지가 55MB를 초과합니다: ${(totalBytes / 1024 / 1024).toFixed(1)}MB`);
}

console.log(
  `Verified MV3 release package: ${relativeFiles.length} files, ` +
  `${(totalBytes / 1024 / 1024).toFixed(1)}MB, local WebGPU/WASM runtimes only`
);

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  }));
  return nested.flat();
}

async function findDuplicateLargeFiles(paths) {
  const byHash = new Map();
  for (const path of paths) {
    const info = await stat(path);
    if (info.size < 1024 * 1024) continue;
    const hash = createHash("sha256").update(await readFile(path)).digest("hex");
    const names = byHash.get(hash) ?? [];
    names.push(relative(dist, path));
    byHash.set(hash, names);
  }
  return Array.from(byHash.values())
    .filter((names) => names.length > 1)
    .map((names) => names.join(", "));
}

async function readRgbaPng(path) {
  const png = await readFile(path);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(signature)) throw new Error(`${path}는 PNG가 아닙니다.`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    if (raw[row] !== 0) throw new Error("아이콘 PNG는 지원하지 않는 필터를 사용합니다.");
    raw.copy(pixels, y * width * 4, row + 1, row + 1 + width * 4);
  }
  return { width, height, pixels };
}

function alphaBounds({ width, height, pixels }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}
