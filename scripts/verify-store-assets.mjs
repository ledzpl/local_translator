import { resolve } from "node:path";
import { verifyStoreAssetManifest } from "./store-asset-integrity.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = await verifyStoreAssetManifest(root);
console.log(
  `Verified store assets for v${manifest.extensionVersion}: ` +
  `${Object.keys(manifest.assets).length} PNG files`
);
