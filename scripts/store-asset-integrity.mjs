import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const STORE_ASSET_SPECS = {
  "screenshot-privacy-1280x800.png": { width: 1280, height: 800 },
  "screenshot-translator-1280x800.png": { width: 1280, height: 800 },
  "promo-small-440x280.png": { width: 440, height: 280 }
};

export async function createStoreAssetManifest(root) {
  const dist = join(root, "dist");
  const storeAssets = join(root, "store-assets");
  const manifest = JSON.parse(
    await readFile(join(dist, "manifest.json"), "utf8")
  );
  const assets = {};
  for (const [file, expected] of Object.entries(STORE_ASSET_SPECS)) {
    const bytes = await readFile(join(storeAssets, file));
    const dimensions = readPngDimensions(bytes, file);
    if (
      dimensions.width !== expected.width ||
      dimensions.height !== expected.height
    ) {
      throw new Error(
        `${file} 크기가 올바르지 않습니다: ` +
        `${dimensions.width}x${dimensions.height}`
      );
    }
    assets[file] = {
      ...dimensions,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  }
  return {
    schemaVersion: 1,
    extensionVersion: manifest.version,
    uiSourceSha256: await computeUiSourceHash(dist),
    assets
  };
}

export async function verifyStoreAssetManifest(root) {
  const path = join(root, "store-assets", "asset-manifest.json");
  const recorded = JSON.parse(await readFile(path, "utf8"));
  const current = await createStoreAssetManifest(root);
  if (JSON.stringify(recorded) !== JSON.stringify(current)) {
    throw new Error(
      "스토어 이미지가 현재 UI 빌드와 일치하지 않습니다. " +
      "npm run store:assets를 다시 실행해 주세요."
    );
  }
  return current;
}

async function computeUiSourceHash(dist) {
  const assetFiles = (await readdir(join(dist, "assets")))
    .filter((file) => /\.(?:js|css)$/u.test(file))
    .map((file) => `assets/${file}`);
  const files = [
    "manifest.json",
    "popup.html",
    "privacy.html",
    "privacy.css",
    "background.js",
    ...assetFiles
  ].sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(dist, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readPngDimensions(bytes, file) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error(`${file}은 올바른 PNG가 아닙니다.`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}
