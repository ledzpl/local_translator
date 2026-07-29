import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const extensionPath = join(root, "dist");
const outputDir = join(root, "store-assets");
const profilePath = await mkdtemp(join(tmpdir(), "ongeul-store-assets-"));
await mkdir(outputDir, { recursive: true });

let context;
try {
  context = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromium.executablePath(),
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-component-update",
      "--no-first-run"
    ]
  });
  const serviceWorker =
    context.serviceWorkers()[0] ??
    await context.waitForEvent("serviceworker", { timeout: 20_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  if (!extensionId) throw new Error("확장 프로그램 ID를 확인하지 못했습니다.");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.addStyleTag({
    content: `
      html, body {
        width: 1280px !important;
        min-height: 800px !important;
        overflow: hidden !important;
      }
      body {
        background:
          radial-gradient(circle at 72% 5%, rgba(221,255,68,.18), transparent 32%),
          linear-gradient(135deg, #171b19, #0d0f0f 64%) !important;
      }
      #app { width: 460px; margin: 0 auto; }
    `
  });
  await popup.getByRole("heading", {
    name: "번역을 시작하기 전에 확인해 주세요"
  }).waitFor();
  await popup.screenshot({
    path: join(outputDir, "screenshot-privacy-1280x800.png")
  });

  await popup.locator("#privacy-consent-check").check();
  await popup.getByRole("button", { name: "동의하고 시작" }).click();
  await popup.getByRole("heading", { name: "페이지 안에서 번역" }).waitFor();
  // Let the real active-tab status request settle before normalizing that card
  // for the listing screenshot; otherwise its async result can overwrite it.
  await popup.waitForTimeout(750);
  await popup.evaluate(() => {
    const status = document.querySelector("#page-status");
    const translate = document.querySelector("#page-translate-button");
    const restore = document.querySelector("#page-restore-button");
    if (status) {
      status.textContent = "본문 원문 아래에 한국어를 순서대로 표시합니다.";
    }
    if (translate) translate.textContent = "페이지 안에 한국어 표시";
    if (restore instanceof HTMLElement) restore.hidden = true;
  });
  await popup.getByRole("textbox", { name: "번역할 텍스트" }).fill(
    "The model translates this text inside the browser."
  );
  await popup.locator("#source-language").selectOption("en");
  await popup.screenshot({
    path: join(outputDir, "screenshot-translator-1280x800.png")
  });

  const promo = await context.newPage();
  await promo.setViewportSize({ width: 440, height: 280 });
  await promo.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body { width: 440px; height: 280px; margin: 0; overflow: hidden; }
          body {
            display: grid;
            place-items: center;
            background:
              radial-gradient(circle at 76% 18%, rgba(221,255,68,.24), transparent 29%),
              linear-gradient(145deg, #1a1e1c, #0c0e0e 72%);
          }
          .mark {
            position: relative;
            width: 132px;
            height: 132px;
            border-radius: 32px;
            background: #151817;
            box-shadow: 0 30px 70px rgba(0,0,0,.42);
          }
          .ring {
            position: absolute;
            inset: 34px;
            border: 14px solid #ddff44;
            border-radius: 50%;
          }
          .dot {
            position: absolute;
            right: 25px;
            bottom: 25px;
            width: 17px;
            height: 17px;
            border-radius: 50%;
            background: #ddff44;
            box-shadow: 0 0 0 10px rgba(221,255,68,.08);
          }
        </style>
      </head>
      <body><div class="mark"><div class="ring"></div><div class="dot"></div></div></body>
    </html>`);
  await promo.screenshot({
    path: join(outputDir, "promo-small-440x280.png")
  });

  console.log(`STORE_ASSETS=${outputDir}`);
} finally {
  await context?.close().catch(() => undefined);
  await rm(profilePath, { recursive: true, force: true });
}
