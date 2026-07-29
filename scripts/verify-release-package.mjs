import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStoreAssetManifest } from "./store-asset-integrity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const releaseDir = join(root, "release");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const version = String(manifest.version);
const artifact = `ongeul-local-translator-v${version}.zip`;
const zipPath = join(releaseDir, artifact);
const checksumPath = `${zipPath}.sha256`;
const metadataPath = `${zipPath}.metadata.json`;

const archive = await readFile(zipPath);
const checksumLine = (await readFile(checksumPath, "utf8")).trim();
const checksumMatch = checksumLine.match(/^([a-f0-9]{64}) {2}(.+)$/u);
if (!checksumMatch || checksumMatch[2] !== artifact) {
  throw new Error("릴리즈 SHA-256 파일 형식이나 대상 파일명이 올바르지 않습니다.");
}
const archiveSha256 = sha256(archive);
if (archiveSha256 !== checksumMatch[1]) {
  throw new Error("릴리즈 ZIP의 SHA-256이 checksum 파일과 일치하지 않습니다.");
}

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
if (
  metadata.schemaVersion !== 2 ||
  metadata.extensionVersion !== version ||
  metadata.artifact !== artifact ||
  metadata.sha256 !== archiveSha256 ||
  metadata.bytes !== (await stat(zipPath)).size
) {
  throw new Error("릴리즈 메타데이터가 ZIP 또는 manifest 버전과 일치하지 않습니다.");
}

const zipEntries = execFileSync("unzip", ["-Z1", zipPath], {
  encoding: "utf8"
}).trim().split("\n").filter(Boolean);
if (new Set(zipEntries).size !== zipEntries.length) {
  throw new Error("릴리즈 ZIP에 중복 entry가 있습니다.");
}
if (
  !zipEntries.includes("manifest.json") ||
  zipEntries.some(
    (entry) =>
      entry.startsWith("/") ||
      entry.includes("../") ||
      entry.endsWith(".map")
  )
) {
  throw new Error("릴리즈 ZIP의 entry 구성이 안전하지 않습니다.");
}

const metadataEntries = new Map(
  metadata.entries.map((entry) => [entry.file, entry])
);
const distFiles = (await walkFiles(dist))
  .map((file) => file.slice(dist.length + 1))
  .sort();
if (
  JSON.stringify([...zipEntries].sort()) !== JSON.stringify(distFiles) ||
  metadataEntries.size !== distFiles.length
) {
  throw new Error("릴리즈 ZIP, 현재 dist와 메타데이터의 파일 목록이 다릅니다.");
}

for (const file of distFiles) {
  const expected = metadataEntries.get(file);
  if (!expected) throw new Error(`릴리즈 메타데이터에 ${file}이 없습니다.`);
  const zippedBytes = execFileSync("unzip", ["-p", zipPath, file], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024
  });
  const distBytes = await readFile(join(dist, file));
  if (
    expected.bytes !== zippedBytes.length ||
    expected.sha256 !== sha256(zippedBytes) ||
    !zippedBytes.equals(distBytes)
  ) {
    throw new Error(`릴리즈 entry가 현재 dist와 다릅니다: ${file}`);
  }
}

const packageLock = await readFile(join(root, "package-lock.json"));
if (metadata.packageLockSha256 !== sha256(packageLock)) {
  throw new Error("릴리즈 메타데이터의 package-lock hash가 현재 파일과 다릅니다.");
}
const storeAssetManifest = await readFile(
  join(root, "store-assets", "asset-manifest.json")
);
const verifiedStoreAssets = await verifyStoreAssetManifest(root);
if (
  metadata.storeAssets?.manifestSha256 !== sha256(storeAssetManifest) ||
  metadata.storeAssets?.uiSourceSha256 !== verifiedStoreAssets.uiSourceSha256
) {
  throw new Error("릴리즈 메타데이터가 현재 스토어 자산과 연결되지 않습니다.");
}
for (const [file, details] of Object.entries(verifiedStoreAssets.assets)) {
  if (metadata.storeAssets.assetSha256?.[file] !== details.sha256) {
    throw new Error(`릴리즈 메타데이터의 스토어 자산 hash가 다릅니다: ${file}`);
  }
}

console.log(`Verified release package v${version}: ${zipEntries.length} entries`);
console.log(`RELEASE_SHA256=${archiveSha256}`);
console.log(`RELEASE_GIT_DIRTY=${Boolean(metadata.gitDirty)}`);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  }));
  return nested.flat();
}
