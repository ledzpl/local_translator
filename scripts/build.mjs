import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

await viteBuild({ root });

await esbuild({
  entryPoints: [join(root, "src/background/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  outfile: join(dist, "background.js"),
  sourcemap: false
});

await esbuild({
  entryPoints: [join(root, "src/content/index.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  outfile: join(dist, "content.js"),
  sourcemap: false
});

const ortDist = join(root, "node_modules/onnxruntime-web/dist");
const wasmDist = join(dist, "wasm");
await mkdir(wasmDist, { recursive: true });
const ortFiles = (await readdir(ortDist)).filter(
  (file) =>
    file.startsWith("ort-wasm-simd-threaded.jsep.") &&
    (file.endsWith(".wasm") || file.endsWith(".mjs"))
);
await Promise.all(
  ortFiles.map((file) => cp(join(ortDist, file), join(wasmDist, file)))
);

const iconDist = join(dist, "icons");
await mkdir(iconDist, { recursive: true });
await Promise.all(
  [16, 32, 48, 128].map((size) =>
    writeFile(join(iconDist, `icon-${size}.png`), createIconPng(size))
  )
);

const licenseDist = join(dist, "LICENSES");
await mkdir(licenseDist, { recursive: true });
await Promise.all([
  cp(join(root, "PRIVACY_POLICY.md"), join(dist, "PRIVACY_POLICY.md")),
  cp(join(root, "THIRD_PARTY_NOTICES.md"), join(dist, "THIRD_PARTY_NOTICES.md")),
  cp(
    join(root, "node_modules/@huggingface/transformers/LICENSE"),
    join(licenseDist, "transformers-js-Apache-2.0.txt")
  ),
  cp(
    join(root, "LICENSES/onnxruntime-MIT.txt"),
    join(licenseDist, "onnxruntime-MIT.txt")
  ),
  cp(
    join(root, "LICENSES/supertonic-code-MIT.txt"),
    join(licenseDist, "supertonic-code-MIT.txt")
  ),
  cp(
    join(root, "node_modules/@huggingface/jinja/LICENSE"),
    join(licenseDist, "huggingface-jinja-MIT.txt")
  ),
  cp(
    join(root, "node_modules/flatbuffers/LICENSE"),
    join(licenseDist, "flatbuffers-Apache-2.0.txt")
  ),
  cp(
    join(root, "LICENSES/guid-typescript-ISC.txt"),
    join(licenseDist, "guid-typescript-ISC.txt")
  ),
  cp(
    join(root, "node_modules/long/LICENSE"),
    join(licenseDist, "long-Apache-2.0.txt")
  ),
  cp(
    join(root, "node_modules/platform/LICENSE"),
    join(licenseDist, "platform-MIT.txt")
  ),
  cp(
    join(root, "node_modules/protobufjs/LICENSE"),
    join(licenseDist, "protobufjs-and-helpers-BSD-3-Clause.txt")
  )
]);

console.log(`Built Chrome extension at ${dist}`);

function createIconPng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const padding = Math.max(1, Math.round(size * 0.125));
  const artworkSize = size - padding * 2;
  const radius = artworkSize * 0.23;
  const center = (size - 1) / 2;
  const ringRadius = artworkSize * 0.255;
  const ringWidth = Math.max(1.5, artworkSize * 0.095);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const localX = x - padding;
      const localY = y - padding;
      if (
        localX < 0 ||
        localY < 0 ||
        localX >= artworkSize ||
        localY >= artworkSize
      ) {
        continue;
      }
      const index = (y * size + x) * 4;
      const edgeX = Math.min(localX, artworkSize - 1 - localX);
      const edgeY = Math.min(localY, artworkSize - 1 - localY);
      const cornerX = Math.max(0, radius - edgeX);
      const cornerY = Math.max(0, radius - edgeY);
      const inside = cornerX * cornerX + cornerY * cornerY <= radius * radius;
      if (!inside) continue;

      const distance = Math.hypot(x - center, y - center);
      const inRing = Math.abs(distance - ringRadius) <= ringWidth / 2;
      const dotDistance = Math.hypot(
        x - (padding + artworkSize * 0.76),
        y - (padding + artworkSize * 0.76)
      );
      const inDot = dotDistance <= artworkSize * 0.07;
      const color = inRing || inDot ? [221, 255, 68] : [20, 24, 22];
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = 255;
    }
  }

  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
