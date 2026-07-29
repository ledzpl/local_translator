import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const releaseDir = join(root, "release");
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8")
);
const expectedNodeVersion = (
  await readFile(join(root, ".nvmrc"), "utf8")
).trim();
const expectedNpmVersion = String(packageJson.packageManager).replace(
  /^npm@/,
  ""
);
const npmVersion = commandOutput("npm", ["--version"]);
if (process.version !== `v${expectedNodeVersion}`) {
  throw new Error(
    `릴리즈 Node 버전이 다릅니다: ${process.version} ` +
    `(필수 v${expectedNodeVersion})`
  );
}
if (npmVersion !== expectedNpmVersion) {
  throw new Error(
    `릴리즈 npm 버전이 다릅니다: ${npmVersion} ` +
    `(필수 ${expectedNpmVersion})`
  );
}

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const version = String(manifest.version);
if (!/^\d+(?:\.\d+){0,3}$/.test(version)) {
  throw new Error(`릴리즈 버전 형식이 올바르지 않습니다: ${version}`);
}

await mkdir(releaseDir, { recursive: true });
const zipPath = join(releaseDir, `ongeul-local-translator-v${version}.zip`);
const checksumPath = `${zipPath}.sha256`;
const metadataPath = `${zipPath}.metadata.json`;
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "ongeul-release-package-")
);
const stagedDist = join(temporaryRoot, "dist");
const temporaryZip = join(temporaryRoot, `ongeul-v${version}.zip`);
const verificationZip = join(temporaryRoot, `ongeul-v${version}-verify.zip`);
let checksum;
let size;
try {
  await cp(dist, stagedDist, { recursive: true });
  const stagedFiles = (await walkFiles(stagedDist))
    .map((file) => file.slice(stagedDist.length + 1))
    .sort();
  const fixedTimestamp = new Date("2000-01-01T00:00:00.000Z");
  await Promise.all(
    stagedFiles.map(async (file) => {
      const path = join(stagedDist, file);
      await chmod(path, 0o644);
      await utimes(path, fixedTimestamp, fixedTimestamp);
    })
  );
  createZip(temporaryZip, stagedDist, stagedFiles);
  createZip(verificationZip, stagedDist, stagedFiles);
  const archive = await readFile(temporaryZip);
  const verificationArchive = await readFile(verificationZip);
  if (!archive.equals(verificationArchive)) {
    throw new Error("동일한 입력에서 재현 가능한 ZIP을 만들지 못했습니다.");
  }

  const entries = execFileSync("unzip", ["-Z1", temporaryZip], {
    encoding: "utf8"
  }).trim().split("\n");
  if (!entries.includes("manifest.json")) {
    throw new Error("ZIP 루트에 manifest.json이 없습니다.");
  }
  if (entries.some((entry) => entry.startsWith("/") || entry.includes("../"))) {
    throw new Error("ZIP에 안전하지 않은 경로가 있습니다.");
  }
  if (entries.some((entry) => entry.endsWith(".map"))) {
    throw new Error("ZIP에 source map이 포함됐습니다.");
  }

  checksum = createHash("sha256").update(archive).digest("hex");
  await writeFile(zipPath, archive);
  await writeFile(checksumPath, `${checksum}  ${zipPath.split("/").at(-1)}\n`);
  size = (await stat(zipPath)).size;
  const packageLock = await readFile(join(root, "package-lock.json"));
  const storeAssetManifest = await readFile(
    join(root, "store-assets", "asset-manifest.json")
  );
  const parsedStoreAssetManifest = JSON.parse(storeAssetManifest.toString());
  if (parsedStoreAssetManifest.extensionVersion !== version) {
    throw new Error(
      "스토어 자산 매니페스트 버전이 릴리즈 버전과 일치하지 않습니다."
    );
  }
  await writeFile(
    metadataPath,
    `${JSON.stringify({
      schemaVersion: 2,
      extensionVersion: version,
      artifact: zipPath.split("/").at(-1),
      sha256: checksum,
      bytes: size,
      gitCommit: commandOutput("git", ["rev-parse", "HEAD"]),
      gitDirty: commandOutput("git", ["status", "--porcelain"]).length > 0,
      node: process.version,
      npm: npmVersion,
      packageLockSha256: createHash("sha256")
        .update(packageLock)
        .digest("hex"),
      storeAssets: {
        manifestSha256: createHash("sha256")
          .update(storeAssetManifest)
          .digest("hex"),
        uiSourceSha256: parsedStoreAssetManifest.uiSourceSha256,
        assetSha256: Object.fromEntries(
          Object.entries(parsedStoreAssetManifest.assets)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([file, details]) => [file, details.sha256])
        )
      },
      entries: await Promise.all(stagedFiles.map(async (file) => {
        const bytes = await readFile(join(stagedDist, file));
        return {
          file,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex")
        };
      }))
    }, null, 2)}\n`
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`RELEASE_ZIP=${zipPath}`);
console.log(`RELEASE_SIZE_MB=${(size / 1024 / 1024).toFixed(1)}`);
console.log(`RELEASE_SHA256=${checksum}`);
console.log(`RELEASE_METADATA=${metadataPath}`);

function createZip(path, cwd, files) {
  execFileSync("zip", ["-X", "-q", path, ...files], {
    cwd,
    stdio: "inherit",
    env: { ...process.env, TZ: "UTC" }
  });
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  }));
  return nested.flat();
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unknown";
  }
}
