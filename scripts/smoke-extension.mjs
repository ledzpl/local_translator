import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const extensionPath = join(root, "dist");
const withModel = process.argv.includes("--with-model");
const keepProfile = process.argv.includes("--keep-profile");
const requestedModel = process.argv.includes("--m2m100") ? "m2m100" : "small100";
const profilePath = await mkdtemp(join(tmpdir(), "ongeul-chrome-smoke-"));
const errors = [];

let context;
try {
  context = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromium.executablePath(),
    headless: true,
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
  if (requestedModel === "m2m100") {
    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ modelPreference: "m2m100" });
    });
  }

  serviceWorker.on("console", (message) => {
    if (message.type() === "error") errors.push(`worker: ${message.text()}`);
  });

  const popup = await context.newPage();
  popup.on("console", (message) => {
    if (message.type() === "error") errors.push(`popup: ${message.text()}`);
  });
  popup.on("pageerror", (error) => errors.push(`popup: ${error.message}`));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await popup.getByRole("heading", { name: "온글." }).waitFor();
  await popup.getByRole("heading", { name: "페이지 안에서 번역" }).waitFor();
  const selectedModel = await popup.locator("#model-preference").inputValue();
  if (selectedModel !== requestedModel) {
    throw new Error(`요청한 모델이 선택되지 않았습니다: ${selectedModel}`);
  }
  const deviceDisabled = await popup.locator("#device-preference").isDisabled();
  if (requestedModel === "small100" && !deviceDisabled) {
    throw new Error("SMaLL-100의 WASM 전용 장치 설정이 UI에 반영되지 않았습니다.");
  }
  if (requestedModel === "m2m100" && deviceDisabled) {
    throw new Error("M2M100 장치 설정이 비활성화됐습니다.");
  }
  if (await popup.getByRole("button", { name: "확장 새로고침" }).isVisible()) {
    throw new Error("정상 서비스 워커에서 확장 새로고침 안내가 표시됐습니다.");
  }
  await popup.getByRole("textbox", { name: "번역할 텍스트" }).fill(
    withModel ? "The browser translates this sentence locally." : "브라우저 로컬 번역"
  );
  await popup.locator("#source-language").selectOption(withModel ? "en" : "auto");

  if (withModel) {
    await popup.getByRole("button", { name: "한국어로 번역" }).click();
    await popup.waitForFunction(
      () => {
        const result = document.querySelector("#result-text");
        return result && !result.classList.contains("loading-lines");
      },
      undefined,
      { timeout: 15 * 60_000 }
    );
    const result = (await popup.locator("#result-text").innerText()).trim();
    const resultMeta = (await popup.locator("#result-meta").innerText()).trim();
    if (!/[가-힣]/.test(result) || /<\/?(?:pad|s)>/i.test(result)) {
      throw new Error(`한국어 번역 결과를 확인하지 못했습니다: ${result} (${resultMeta})`);
    }
    const engineStatus = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "GET_ENGINE_STATUS"
      })
    );
    const expectedModelId =
      requestedModel === "small100"
        ? "casawolice/small100-onnx"
        : "Xenova/m2m100_418M";
    if (
      engineStatus.state !== "ready" ||
      engineStatus.modelId !== expectedModelId ||
      (requestedModel === "small100" && engineStatus.fallbackFromModelId)
    ) {
      throw new Error(`요청한 모델 엔진이 준비되지 않았습니다: ${JSON.stringify(engineStatus)}`);
    }
    console.log(`MODEL_TRANSLATION=${result}`);
    console.log(`MODEL_RUNTIME=${resultMeta}`);
    console.log(`MODEL_ENGINE=${engineStatus.modelId}`);

    const warmResult = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "TRANSLATE",
        requestId: crypto.randomUUID(),
        text: "Clear navigation helps readers understand a complex webpage.",
        sourceLanguage: "en",
        origin: "popup"
      })
    );
    if (
      !warmResult.ok ||
      !/[가-힣]/.test(warmResult.translation) ||
      /<\/?(?:pad|s)>/i.test(warmResult.translation)
    ) {
      throw new Error(`웜업 번역 결과를 확인하지 못했습니다: ${JSON.stringify(warmResult)}`);
    }
    console.log(`WARM_TRANSLATION=${warmResult.translation}`);
    console.log(`WARM_RUNTIME_MS=${warmResult.elapsedMs}`);
  }

  const mockYoutube = await context.newPage();
  mockYoutube.on("console", (message) => {
    if (message.type() === "error") errors.push(`youtube: ${message.text()}`);
  });
  mockYoutube.on("pageerror", (error) => errors.push(`youtube: ${error.message}`));
  await mockYoutube.route("https://www.youtube.com/watch?v=ongeul-smoke", async (route) => {
    await route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html>
        <html lang="en">
          <body style="margin:0;background:#111;color:white">
            <div class="html5-video-player" style="position:relative;width:900px;height:506px">
              <button class="ytp-subtitles-button" aria-pressed="true">CC</button>
              <div class="ytp-caption-window-container" style="position:absolute;bottom:20px">
                <span class="ytp-caption-segment">${
                  withModel ? "Local models keep text private." : "브라우저 로컬 번역"
                }</span>
              </div>
            </div>
          </body>
        </html>`
    });
  });
  await mockYoutube.goto("https://www.youtube.com/watch?v=ongeul-smoke");

  const subtitleHost = mockYoutube.locator('[data-ongeul-overlay="subtitle"]');
  await subtitleHost.waitFor({ state: "attached", timeout: withModel ? 120_000 : 15_000 });
  await mockYoutube.waitForFunction(
    () => {
      const host = document.querySelector('[data-ongeul-overlay="subtitle"]');
      return Boolean(host?.shadowRoot?.querySelector(".subtitle")?.textContent?.trim());
    },
    undefined,
    { timeout: withModel ? 120_000 : 15_000 }
  );
  const subtitle = await subtitleHost.evaluate((host) =>
    host.shadowRoot?.querySelector(".subtitle")?.textContent?.trim()
  );
  if (!subtitle || !/[가-힣]/.test(subtitle)) {
    throw new Error(`YouTube 한국어 오버레이를 확인하지 못했습니다: ${subtitle ?? ""}`);
  }

  let pageTranslation;
  const webPage = await context.newPage();
  webPage.on("console", (message) => {
    if (message.type() === "error") errors.push(`webpage: ${message.text()}`);
  });
  webPage.on("pageerror", (error) => errors.push(`webpage: ${error.message}`));
  await webPage.route("https://huggingface.co/ongeul-webpage-smoke", async (route) => {
    await route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html>
        <html lang="en">
          <body>
            <main style="padding:32px">
              <p id="article-copy">${
                withModel
                  ? "A private webpage keeps its text inside the browser."
                  : "브라우저 로컬 번역"
              }</p>
            </main>
          </body>
        </html>`
    });
  });
  await webPage.goto("https://huggingface.co/ongeul-webpage-smoke");
  await webPage.bringToFront();

  const started = await popup.evaluate(async () =>
    chrome.runtime.sendMessage({
      target: "background",
      type: "START_PAGE_TRANSLATION"
    })
  );
  if (withModel && (!started || started.total < 1)) {
    throw new Error(`페이지 번역 대상을 찾지 못했습니다: ${JSON.stringify(started)}`);
  }
  if (!withModel && (started?.state !== "complete" || started.total !== 0)) {
    throw new Error(`동적 페이지 주입에 실패했습니다: ${JSON.stringify(started)}`);
  }

  if (withModel) {
    const pageTranslationHost = webPage.locator(
      "#article-copy > [data-ongeul-page-translation]"
    );
    await pageTranslationHost.waitFor({ state: "attached", timeout: 120_000 });
    await webPage.waitForFunction(
      () => {
        const host = document.querySelector(
          "#article-copy > [data-ongeul-page-translation]"
        );
        return /[가-힣]/.test(
          host?.shadowRoot?.querySelector(".text")?.textContent ?? ""
        );
      },
      undefined,
      { timeout: 120_000 }
    );
    pageTranslation = await pageTranslationHost.evaluate((host) =>
      host.shadowRoot?.querySelector(".text")?.textContent?.trim()
    );

    const completed = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "GET_PAGE_TRANSLATION_STATUS"
      })
    );
    if (completed.state !== "complete" || completed.completed < 1) {
      throw new Error(`페이지 번역이 완료되지 않았습니다: ${JSON.stringify(completed)}`);
    }
  }

  const restored = await popup.evaluate(async () =>
    chrome.runtime.sendMessage({
      target: "background",
      type: "RESTORE_PAGE_TRANSLATION"
    })
  );
  if (restored.state !== "idle") {
    throw new Error(`페이지 번역 복원에 실패했습니다: ${JSON.stringify(restored)}`);
  }
  if (await webPage.locator("[data-ongeul-page-translation]").count()) {
    throw new Error("원문 복원 후 페이지 번역 노드가 남아 있습니다.");
  }

  const browserSession = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await browserSession.send("Target.getTargets");
  const extensionTargets = targetInfos
    .filter((target) => target.url.startsWith(`chrome-extension://${extensionId}/`))
    .map((target) => ({ type: target.type, url: target.url }));

  if (!extensionTargets.some((target) => target.url.endsWith("/offscreen.html"))) {
    throw new Error("오프스크린 번역 엔진 문서가 생성되지 않았습니다.");
  }
  if (errors.length > 0) {
    throw new Error(`Chrome 콘솔 오류:\n${errors.join("\n")}`);
  }

  console.log(`EXTENSION_ID=${extensionId}`);
  console.log(`SERVICE_WORKER=${serviceWorker.url()}`);
  console.log(`YOUTUBE_SUBTITLE=${subtitle}`);
  console.log(`PAGE_DYNAMIC_INJECTION=${started.state}`);
  if (pageTranslation) console.log(`PAGE_TRANSLATION=${pageTranslation}`);
  console.log(`EXTENSION_TARGETS=${JSON.stringify(extensionTargets)}`);
  console.log("SMOKE_TEST=PASS");
} catch (error) {
  console.error(`SMOKE_ERRORS=${JSON.stringify(errors)}`);
  if (context) {
    console.error(
      `OPEN_PAGES=${JSON.stringify(
        context.pages().map((page) => ({ url: page.url() }))
      )}`
    );
  }
  throw error;
} finally {
  await context?.close().catch(() => undefined);
  if (keepProfile) {
    console.log(`PROFILE_PATH=${profilePath}`);
  } else {
    await rm(profilePath, { recursive: true, force: true });
  }
}
