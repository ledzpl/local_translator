import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const releaseDir = join(root, "release");
const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
const version = String(manifest.version);
if (!/^\d+(?:\.\d+){0,3}$/.test(version)) {
  throw new Error(`릴리즈 버전 형식이 올바르지 않습니다: ${version}`);
}

await mkdir(releaseDir, { recursive: true });
const zipPath = join(releaseDir, `ongeul-local-translator-v${version}.zip`);
const checksumPath = `${zipPath}.sha256`;
await rm(zipPath, { force: true });
await rm(checksumPath, { force: true });

execFileSync("zip", ["-X", "-q", "-r", zipPath, "."], {
  cwd: dist,
  stdio: "inherit"
});

const entries = execFileSync("unzip", ["-Z1", zipPath], {
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

const archive = await readFile(zipPath);
const checksum = createHash("sha256").update(archive).digest("hex");
await writeFile(checksumPath, `${checksum}  ${zipPath.split("/").at(-1)}\n`);
const size = (await stat(zipPath)).size;

console.log(`RELEASE_ZIP=${zipPath}`);
console.log(`RELEASE_SIZE_MB=${(size / 1024 / 1024).toFixed(1)}`);
console.log(`RELEASE_SHA256=${checksum}`);
