import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { assertSemanticTranslation } from "./translation-quality.mjs";

const root = resolve(import.meta.dirname, "..");
const extensionPath = join(root, "dist");
const withPageTts = process.argv.includes("--with-page-tts");
const withModel = process.argv.includes("--with-model") || withPageTts;
const withTts = process.argv.includes("--with-tts");
const requirePrimaryWebGpu = process.argv.includes("--require-primary-webgpu");
const profileArgument = process.argv.find((argument) =>
  argument.startsWith("--profile=")
);
const existingProfilePath = profileArgument?.slice("--profile=".length);
const keepProfile =
  process.argv.includes("--keep-profile") || Boolean(existingProfilePath);
const requestedModel = process.argv.includes("--small100")
  ? "small100"
  : process.argv.includes("--m2m100")
    ? "m2m100"
    : "translategemma";
const requestedDevice =
  requestedModel === "small100" || process.argv.includes("--wasm")
    ? "wasm"
    : "webgpu";
let profilePath =
  existingProfilePath ??
  await mkdtemp(join(tmpdir(), "ongeul-chrome-smoke-"));
const errors = [];

let context;
try {
  context = await launchExtensionWithRetry();

  const serviceWorker =
    context.serviceWorkers()[0] ??
    await context.waitForEvent("serviceworker", { timeout: 20_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  if (!extensionId) throw new Error("확장 프로그램 ID를 확인하지 못했습니다.");
  await serviceWorker.evaluate(async ({ modelPreference, devicePreference }) => {
    await chrome.storage.sync.clear();
    await chrome.storage.session.clear();
    if (modelPreference !== "translategemma") {
      await chrome.storage.sync.set({
        modelPreference,
        devicePreference
      });
    }
  }, {
    modelPreference: requestedModel,
    devicePreference: requestedDevice
  });

  serviceWorker.on("console", (message) => {
    if (message.type() === "error") errors.push(`worker: ${message.text()}`);
  });

  const popup = await context.newPage();
  popup.on("console", (message) => {
    if (message.type() === "error") errors.push(`popup: ${message.text()}`);
  });
  popup.on("pageerror", (error) => errors.push(`popup: ${error.message}`));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await popup.getByRole("heading", {
    name: "번역을 시작하기 전에 확인해 주세요"
  }).waitFor();
  const preConsent = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "TRANSLATE",
      requestId: crypto.randomUUID(),
      text: "This content must not be processed before consent.",
      sourceLanguage: "en",
      origin: "popup"
    });
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
    });
    return { response, offscreenCount: contexts.length };
  });
  if (
    preConsent.response?.ok !== false ||
    preConsent.response?.code !== "CONSENT_REQUIRED" ||
    preConsent.offscreenCount !== 0
  ) {
    throw new Error(
      `동의 전 번역·오프스크린 차단에 실패했습니다: ${JSON.stringify(preConsent)}`
    );
  }
  if (await popup.locator("#product-ui").isVisible()) {
    throw new Error("데이터 처리 안내 확인 전에 번역 UI가 활성화됐습니다.");
  }
  await popup.locator("#privacy-consent-check").check();
  await popup.getByRole("button", { name: "동의하고 시작" }).click();

  await popup.getByRole("heading", { name: "온글." }).waitFor();
  await popup.getByRole("heading", { name: "페이지 안에서 번역" }).waitFor();
  await popup.locator("#tts-title").waitFor();
  await popup.locator("#youtube-enabled").check({ force: true });
  await popup.locator("#auto-captions").check();
  await popup.waitForFunction(async () => {
    const settings = await chrome.storage.sync.get([
      "privacyConsentVersion",
      "youtubeEnabled",
      "autoEnableCaptions"
    ]);
    return settings.privacyConsentVersion === 3 &&
      settings.youtubeEnabled === true &&
      settings.autoEnableCaptions === true;
  });
  await serviceWorker.evaluate(() => {
    globalThis.__ongeulSubtitleSizeWriteCount = 0;
    if (!globalThis.__ongeulSubtitleSizeWriteCounterInstalled) {
      globalThis.__ongeulSubtitleSizeWriteCounterInstalled = true;
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "sync" && changes.subtitleSize) {
          globalThis.__ongeulSubtitleSizeWriteCount += 1;
        }
      });
    }
  });
  const initialSubtitleSize = Number(
    await popup.locator("#subtitle-size").inputValue()
  );
  const nextSubtitleSize =
    initialSubtitleSize === 42 ? initialSubtitleSize - 1 : initialSubtitleSize + 1;
  await popup.locator("#subtitle-size").evaluate((element, nextValue) => {
    const input = /** @type {HTMLInputElement} */ (element);
    for (const value of [nextValue - 1, nextValue + 1, nextValue]) {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, nextSubtitleSize);
  await popup.waitForTimeout(150);
  const subtitleSizeBeforeCommit = await serviceWorker.evaluate(async () => ({
    stored: (await chrome.storage.sync.get("subtitleSize")).subtitleSize,
    writes: globalThis.__ongeulSubtitleSizeWriteCount
  }));
  if (
    subtitleSizeBeforeCommit.stored !== initialSubtitleSize ||
    subtitleSizeBeforeCommit.writes !== 0
  ) {
    throw new Error(
      `자막 크기 input 이벤트가 설정을 저장했습니다: ${JSON.stringify(subtitleSizeBeforeCommit)}`
    );
  }
  await popup.locator("#subtitle-size-value").filter({
    hasText: `${nextSubtitleSize}px`
  }).waitFor();
  await popup.locator("#subtitle-size").dispatchEvent("change");
  await popup.waitForFunction(async (expectedSize) =>
    (await chrome.storage.sync.get("subtitleSize")).subtitleSize === expectedSize,
  nextSubtitleSize);
  const subtitleSizeWrites = await serviceWorker.evaluate(async () => {
    const deadline = Date.now() + 2_000;
    while (
      globalThis.__ongeulSubtitleSizeWriteCount < 1 &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return globalThis.__ongeulSubtitleSizeWriteCount;
  });
  if (subtitleSizeWrites !== 1) {
    throw new Error(
      `자막 크기 change 저장 횟수가 올바르지 않습니다: ${subtitleSizeWrites}`
    );
  }
  console.log("SUBTITLE_SIZE_COMMIT_GUARD=PASS");
  const selectedModel = await popup.locator("#model-preference").inputValue();
  if (selectedModel !== requestedModel) {
    throw new Error(`요청한 모델이 선택되지 않았습니다: ${selectedModel}`);
  }
  const selectedDevice = await popup.locator("#device-preference").inputValue();
  if (selectedDevice !== requestedDevice) {
    throw new Error(`요청한 실행 장치가 선택되지 않았습니다: ${selectedDevice}`);
  }
  const deviceDisabled = await popup.locator("#device-preference").isDisabled();
  if (requestedModel === "small100" && !deviceDisabled) {
    throw new Error("SMaLL-100의 WASM 전용 장치 설정이 UI에 반영되지 않았습니다.");
  }
  if (requestedModel !== "small100" && deviceDisabled) {
    throw new Error("선택한 번역 모델의 장치 설정이 비활성화됐습니다.");
  }
  if (await popup.getByRole("button", { name: "확장 새로고침" }).isVisible()) {
    throw new Error("정상 서비스 워커에서 확장 새로고침 안내가 표시됐습니다.");
  }
  await popup.getByRole("textbox", { name: "번역할 텍스트" }).fill(
    withModel
      ? "The model translates this sentence inside the browser."
      : withTts
        ? "안녕하세요 반갑습니다."
        : "브라우저 로컬 번역"
  );
  await popup.locator("#source-language").selectOption(
    withModel ? "en" : "auto"
  );

  if (!withModel && !withTts) {
    await serviceWorker.evaluate(() => {
      globalThis.__ongeulTranslateMessageCount = 0;
      if (!globalThis.__ongeulTranslateMessageCounterInstalled) {
        globalThis.__ongeulTranslateMessageCounterInstalled = true;
        chrome.runtime.onMessage.addListener((message) => {
          if (message?.target === "background" && message.type === "TRANSLATE") {
            globalThis.__ongeulTranslateMessageCount += 1;
          }
        });
      }
    });
    await popup.locator("#source-text").evaluate((element) => {
      const event = () => new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true
      });
      element.dispatchEvent(event());
      element.dispatchEvent(event());
    });
    await popup.locator("#result-text").filter({ hasText: "브라우저 로컬 번역" }).waitFor();
    const translateMessageCount = await serviceWorker.evaluate(
      () => globalThis.__ongeulTranslateMessageCount
    );
    if (translateMessageCount !== 1) {
      throw new Error(
        `팝업 중복 번역 요청이 차단되지 않았습니다: ${translateMessageCount}`
      );
    }
    console.log("POPUP_DUPLICATE_TRANSLATION_GUARD=PASS");
  }

  if (withModel) {
    await popup.getByRole("button", { name: "한국어로 번역" }).click();
    const completed = await waitForTranslationResult(
      popup,
      requestedModel === "translategemma" ? 60 * 60_000 : 15 * 60_000
    );
    if (!completed) {
      const timedOutStatus = await popup.evaluate(async () =>
        chrome.runtime.sendMessage({
          target: "background",
          type: "GET_ENGINE_STATUS"
        })
      );
      throw new Error(
        `번역 모델 준비 시간 초과: ${JSON.stringify(timedOutStatus)}`
      );
    }
    const result = (await popup.locator("#result-text").innerText()).trim();
    const resultMeta = (await popup.locator("#result-meta").innerText()).trim();
    const engineStatus = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "GET_ENGINE_STATUS"
      })
    );
    if (engineStatus.state === "error") {
      throw new Error(
        `번역 엔진 오류: ${JSON.stringify(engineStatus)} result=${result}`
      );
    }
    if (!/[가-힣]/.test(result) || /<\/?(?:pad|s)>/i.test(result)) {
      throw new Error(
        `한국어 번역 결과를 확인하지 못했습니다: ${result} (${resultMeta}) ` +
        `engine=${JSON.stringify(engineStatus)}`
      );
    }
    if (requestedModel !== "small100") {
      assertSemanticTranslation({
        id: "browser_local_execution",
        translation: result,
        requiredConcepts: [
          [/모델/u],
          [/번역/u],
          [/브라우저\s*(?:안|내부|내)/u]
        ],
        forbidden: [/\b(?:model|translates?|sentence|inside|browser)\b/iu]
      });
    }
    const requestedModelId = {
      small100: "casawolice/small100-onnx",
      m2m100: "Xenova/m2m100_418M",
      translategemma: "onnx-community/translategemma-text-4b-it-ONNX"
    }[requestedModel];
    const expectedModelId =
      requestedModel === "translategemma" &&
      engineStatus.fallbackFromModelId === requestedModelId
        ? "Xenova/m2m100_418M"
        : requestedModelId;
    if (
      engineStatus.state !== "ready" ||
      engineStatus.modelId !== expectedModelId ||
      !["wasm", "webgpu"].includes(engineStatus.device) ||
      (requestedDevice === "wasm" && engineStatus.device !== "wasm") ||
      (requestedModel === "small100" && engineStatus.fallbackFromModelId) ||
      (requestedModel === "translategemma" &&
        engineStatus.modelId !== requestedModelId &&
        engineStatus.fallbackFromModelId !== requestedModelId)
    ) {
      throw new Error(`요청한 모델 엔진이 준비되지 않았습니다: ${JSON.stringify(engineStatus)}`);
    }
    if (requirePrimaryWebGpu) {
      assertPrimaryWebGpuStatus(engineStatus, requestedModel, requestedModelId);
    }
    console.log(`MODEL_TRANSLATION=${result}`);
    console.log(`MODEL_RUNTIME=${resultMeta}`);
    console.log(`MODEL_ENGINE=${engineStatus.modelId}`);
    console.log(`MODEL_DEVICE=${engineStatus.device}`);
    console.log(
      `MODEL_DEVICE_FALLBACK=${engineStatus.fallbackFromDevice ?? "none"}`
    );
    console.log(
      `MODEL_FALLBACK_REASON=${engineStatus.deviceFallbackReason ?? engineStatus.fallbackReason ?? "none"}`
    );
    const cachedWebGpuWeights = await popup.evaluate(async () => {
      const cache = await caches.open("transformers-cache");
      const requests = await cache.keys();
      return requests
        .map((request) => decodeURIComponent(request.url).toLowerCase())
        .filter((url) =>
          (
            url.includes("/xenova/m2m100_418m/") &&
            /\/onnx\/[^/?#]*_q4f16\.onnx(?:[?#]|$)/u.test(url)
          ) ||
          (
            url.includes("/onnx-community/translategemma-text-4b-it-onnx/") &&
            /\/onnx\/model_q4\.onnx(?:_data(?:_\d+)?)?(?:[?#]|$)/u.test(url)
          )
        );
    });
    console.log(
      `MODEL_WEBGPU_CACHE_PRESERVED_ENTRIES=${cachedWebGpuWeights.length}`
    );

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
    if (requestedModel !== "small100") {
      assertSemanticTranslation({
        id: "navigation_readability",
        translation: warmResult.translation,
        requiredConcepts: [
          [/탐색/u, /내비게이션/u],
          [/독자/u, /읽는 사람/u],
          [/복잡/u],
          [/웹\s*페이지/u, /웹페이지/u]
        ],
        forbidden: [/\bnavigation\b/iu]
      });
    }
    console.log(`WARM_TRANSLATION=${warmResult.translation}`);
    console.log(`WARM_RUNTIME_MS=${warmResult.elapsedMs}`);

    const privacyResult = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "TRANSLATE",
        requestId: crypto.randomUUID(),
        text: "Do not send this text to a server.",
        sourceLanguage: "en",
        origin: "popup"
      })
    );
    if (!privacyResult.ok) {
      throw new Error(`개인정보 부정문 번역에 실패했습니다: ${JSON.stringify(privacyResult)}`);
    }
    if (requestedModel !== "small100") {
      assertSemanticTranslation({
        id: "privacy_negation",
        translation: privacyResult.translation,
        requiredConcepts: [
          [/텍스트/u, /문자/u, /문서/u],
          [/서버/u],
          [
            /(?:보내|전송)지\s*마/u,
            /(?:보내|전송)면\s*안/u,
            /(?:보내|전송)(?:지|되지)\s*않/u
          ]
        ],
        forbidden: [/\b(?:send|text|server)\b/iu]
      });
    }
    console.log(`PRIVACY_TRANSLATION=${privacyResult.translation}`);

    if (requirePrimaryWebGpu) {
      const mixedLanguageResult = await popup.evaluate(async () =>
        chrome.runtime.sendMessage({
          target: "background",
          type: "TRANSLATE",
          requestId: crypto.randomUUID(),
          text: "Tento text zůstává v prohlížeči a překládá se místně.",
          sourceLanguage: "cs",
          origin: "popup"
        })
      );
      if (
        !mixedLanguageResult.ok ||
        !/[가-힣]/.test(mixedLanguageResult.translation)
      ) {
        throw new Error(
          `TranslateGemma 다국어 template 경로에 실패했습니다: ` +
          JSON.stringify(mixedLanguageResult)
        );
      }
      const mixedLanguageStatus = await popup.evaluate(async () =>
        chrome.runtime.sendMessage({
          target: "background",
          type: "GET_ENGINE_STATUS"
        })
      );
      assertPrimaryWebGpuStatus(
        mixedLanguageStatus,
        requestedModel,
        "onnx-community/translategemma-text-4b-it-ONNX"
      );
      console.log("TRANSLATEGEMMA_MIXED_LANGUAGE=PASS");
    }
  }

  if (withTts) {
    await popup.getByRole("button", { name: "한국어로 번역" }).click();
    await popup.waitForFunction(
      () => /[가-힣]/.test(document.querySelector("#result-text")?.textContent ?? ""),
      undefined,
      { timeout: 15_000 }
    );
    await popup.locator("#speak-button").click();
    await popup.locator("#tts-stop-button").waitFor({ state: "visible" });
    await popup.locator("#tts-stop-button").click();
    await popup.locator("#tts-state").filter({ hasText: "대기" }).waitFor();
    await popup.waitForTimeout(2_000);
    const coldCancelStatus = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "GET_TTS_STATUS"
      })
    );
    if (coldCancelStatus?.state !== "idle") {
      throw new Error(
        `한국어 TTS 콜드 로드 정지 상태가 되살아났습니다: ${JSON.stringify(coldCancelStatus)}`
      );
    }
    await popup.locator("#speak-button").click();
    await popup.waitForFunction(
      () => {
        const state = document.querySelector("#tts-state")?.textContent?.trim();
        return state === "재생 중" || state === "오류";
      },
      undefined,
      { timeout: 15 * 60_000, polling: 250 }
    );
    const visibleTtsState = (await popup.locator("#tts-state").innerText()).trim();
    if (visibleTtsState === "오류") {
      throw new Error(
        `한국어 TTS 실행 오류: ${(await popup.locator("#tts-detail").innerText()).trim()}`
      );
    }
    const ttsStatus = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "GET_TTS_STATUS"
      })
    );
    if (
      ttsStatus?.modelId !== "Supertone/supertonic-3" ||
      ttsStatus.state !== "playing"
    ) {
      throw new Error(`한국어 TTS 모델을 확인하지 못했습니다: ${JSON.stringify(ttsStatus)}`);
    }
    console.log(`TTS_ENGINE=${ttsStatus.modelId}`);
    console.log(`TTS_STATE=${ttsStatus.state}`);
    const completedTtsStatus = await waitForTtsState(
      popup,
      "idle",
      2 * 60_000,
      "TTS_COMPLETE"
    );
    if (
      completedTtsStatus?.speechId !== ttsStatus.speechId ||
      completedTtsStatus.progress !== 1
    ) {
      throw new Error(
        `한국어 TTS가 전체 문장을 끝까지 읽지 못했습니다: ${JSON.stringify(completedTtsStatus)}`
      );
    }
    await popup.locator("#tts-state").filter({ hasText: "대기" }).waitFor();
    console.log("TTS_COMPLETED=PASS");
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
          <head>
            <style>.captions-hidden { display: none; }</style>
          </head>
          <body style="margin:0;background:#111;color:white">
            <div class="html5-video-player" style="position:relative;width:900px;height:506px">
              <button class="ytp-subtitles-button" aria-pressed="true">CC</button>
              <div class="ytp-caption-window-container" style="position:absolute;bottom:20px">
                <span class="ytp-caption-segment">${
                  withModel
                    ? "The model keeps this text inside the browser."
                    : "브라우저 로컬 번역"
                }</span>
              </div>
            </div>
          </body>
        </html>`
    });
  });
  await mockYoutube.goto("https://www.youtube.com/watch?v=ongeul-smoke");

  const subtitleHost = mockYoutube.locator('[data-ongeul-overlay="subtitle"]');
  let subtitle = "";
  if (withModel) {
    await subtitleHost.waitFor({ state: "attached", timeout: 120_000 });
    await mockYoutube.waitForFunction(
      () => {
        const host = document.querySelector('[data-ongeul-overlay="subtitle"]');
        return Boolean(host?.shadowRoot?.querySelector(".subtitle")?.textContent?.trim());
      },
      undefined,
      { timeout: 120_000 }
    );
    subtitle = await subtitleHost.evaluate((host) =>
      host.shadowRoot?.querySelector(".subtitle")?.textContent?.trim() ?? ""
    );
    if (!/[가-힣]/.test(subtitle)) {
      throw new Error(`YouTube 한국어 오버레이를 확인하지 못했습니다: ${subtitle}`);
    }
  } else {
    await mockYoutube.waitForTimeout(1_200);
    const koreanCaptionState = await mockYoutube.evaluate(() => {
      const host = document.querySelector(
        '[data-ongeul-overlay="subtitle"]'
      );
      const original = document.querySelector(
        ".ytp-caption-window-container"
      );
      return {
        overlayVisible: Boolean(host && !host.hidden),
        originalOpacity: original?.style.opacity ?? ""
      };
    });
    if (
      koreanCaptionState.overlayVisible ||
      koreanCaptionState.originalOpacity === "0"
    ) {
      throw new Error(
        `한국어 원문 자막이 중복되거나 숨겨졌습니다: ` +
        JSON.stringify(koreanCaptionState)
      );
    }
    subtitle = "KOREAN_SOURCE_SKIPPED";
  }
  if (withModel && requestedModel === "m2m100") {
    assertSemanticTranslation({
      id: "private_local_caption",
      translation: subtitle,
      requiredConcepts: [
        [/모델/u],
        [/텍스트/u, /문자/u],
        [/브라우저\s*(?:안|내부)/u],
        [/보관/u, /유지/u]
      ],
      forbidden: [/\b(?:model|keeps?|text|inside|browser)\b/iu]
    });
  }
  if (withModel) {
    await mockYoutube.evaluate(() => {
      document.querySelector(".ytp-caption-window-container")
        ?.setAttribute("aria-hidden", "true");
    });
    await subtitleHost.waitFor({ state: "hidden", timeout: 5_000 });
    await mockYoutube.evaluate(() => {
      document.querySelector(".ytp-caption-window-container")
        ?.removeAttribute("aria-hidden");
    });
    await subtitleHost.waitFor({ state: "visible", timeout: 5_000 });
    console.log("YOUTUBE_HIDDEN_CAPTION_GUARD=PASS");

    await mockYoutube.evaluate(() => {
      history.pushState({}, "", "/watch?v=ongeul-spa-navigation");
    });
    await mockYoutube.waitForTimeout(1_600);
    if (!await subtitleHost.isVisible()) {
      throw new Error("YouTube SPA 이동 후 첫 자막 번역이 복구되지 않았습니다.");
    }
    console.log("YOUTUBE_SPA_NAVIGATION_RESCAN=PASS");
  } else {
    await serviceWorker.evaluate(() => {
      globalThis.__ongeulHiddenCaptionTranslateCount = 0;
      if (!globalThis.__ongeulHiddenCaptionCounterInstalled) {
        globalThis.__ongeulHiddenCaptionCounterInstalled = true;
        chrome.runtime.onMessage.addListener((message) => {
          if (message?.target === "background" && message.type === "TRANSLATE") {
            globalThis.__ongeulHiddenCaptionTranslateCount += 1;
          }
        });
      }
    });
    await mockYoutube.evaluate(() => {
      const window = document.querySelector(".ytp-caption-window-container");
      window?.classList.add("captions-hidden");
    });
    await mockYoutube.waitForTimeout(500);
    const hiddenSameCueRequests = await serviceWorker.evaluate(
      () => globalThis.__ongeulHiddenCaptionTranslateCount
    );
    if (hiddenSameCueRequests !== 0) {
      throw new Error(
        `숨겨진 동일 YouTube 자막이 번역 요청으로 전달됐습니다: ${hiddenSameCueRequests}`
      );
    }
    await mockYoutube.evaluate(() => {
      document.querySelector(".ytp-caption-window-container")
        ?.classList.remove("captions-hidden");
    });
    await mockYoutube.waitForTimeout(500);
    const reappearedSameCueRequests = await serviceWorker.evaluate(
      () => globalThis.__ongeulHiddenCaptionTranslateCount
    );
    if (reappearedSameCueRequests !== 1) {
      throw new Error(
        `다시 나타난 동일 YouTube 자막이 재처리되지 않았습니다: ${reappearedSameCueRequests}`
      );
    }
    await serviceWorker.evaluate(() => {
      globalThis.__ongeulHiddenCaptionTranslateCount = 0;
    });
    await mockYoutube.evaluate(() => {
      const window = document.querySelector(".ytp-caption-window-container");
      if (window instanceof HTMLElement) window.style.opacity = "0";
      const segment = window?.querySelector(".ytp-caption-segment");
      if (segment) segment.textContent = "An opacity-hidden caption must stay hidden.";
    });
    await mockYoutube.waitForTimeout(500);
    await mockYoutube.evaluate(() => {
      const window = document.querySelector(".ytp-caption-window-container");
      if (window instanceof HTMLElement) window.style.opacity = "";
      document.querySelector(".ytp-subtitles-button")
        ?.setAttribute("aria-pressed", "false");
      const segment = window?.querySelector(".ytp-caption-segment");
      if (segment) segment.textContent = "A caption behind disabled CC must stay hidden.";
    });
    await mockYoutube.waitForTimeout(500);
    const hiddenCaptionState = await serviceWorker.evaluate(
      () => globalThis.__ongeulHiddenCaptionTranslateCount
    );
    if (hiddenCaptionState !== 0) {
      throw new Error(
        `숨겨진 YouTube 자막이 번역 요청으로 전달됐습니다: ${hiddenCaptionState}`
      );
    }
    console.log("YOUTUBE_HIDDEN_CAPTION_GUARD=PASS");

    await mockYoutube.evaluate(() => {
      const segment = document.querySelector(".ytp-caption-segment");
      if (segment) segment.textContent = "브라우저 로컬 번역";
    });
    await mockYoutube.waitForTimeout(500);
    await mockYoutube.evaluate(() => {
      document.querySelector(".ytp-subtitles-button")
        ?.setAttribute("aria-pressed", "true");
    });
    await mockYoutube.waitForTimeout(500);
    await serviceWorker.evaluate(() => {
      globalThis.__ongeulHiddenCaptionTranslateCount = 0;
    });
    await mockYoutube.evaluate(() => {
      history.pushState({}, "", "/watch?v=ongeul-basic-spa-navigation");
    });
    await mockYoutube.waitForTimeout(1_600);
    const navigationRescanRequests = await serviceWorker.evaluate(
      () => globalThis.__ongeulHiddenCaptionTranslateCount
    );
    if (navigationRescanRequests !== 1) {
      throw new Error(
        `YouTube SPA 이동 후 첫 자막을 다시 처리하지 않았습니다: ${navigationRescanRequests}`
      );
    }
    console.log("YOUTUBE_SPA_NAVIGATION_RESCAN=PASS");
  }

  let pageTranslation;
  const webPage = await context.newPage();
  webPage.on("console", (message) => {
    if (message.type() === "error") errors.push(`webpage: ${message.text()}`);
  });
  webPage.on("pageerror", (error) => errors.push(`webpage: ${error.message}`));
  await webPage.route("https://huggingface.co/ongeul-webpage-smoke", async (route) => {
    const pageBody = withModel
      ? `
        ${Array.from({ length: 45 }, (_, index) =>
          `<p class="offscreen-copy">Earlier article paragraph ${index + 1} explains a separate part of the page.</p>`
        ).join("")}
        <pre id="pre-copy">This preformatted article paragraph is natural prose written for people to read, not source code.</pre>
        <article>
          <article-copy id="custom-copy">Visible custom text helps readers.</article-copy>
          <button id="dangerous-action">Delete the current draft permanently</button>
        </article>`
      : `<p id="article-copy">브라우저 로컬 번역</p>`;
    await route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html>
        <html lang="en">
          <body>
            <main style="padding:32px">
              <style>
                .offscreen-copy { min-height: 42px; margin: 0; }
                pre, article-copy { display: block; margin: 20px 0; white-space: pre-wrap; }
              </style>
              ${pageBody}
            </main>
          </body>
        </html>`
    });
  });
  await webPage.goto("https://huggingface.co/ongeul-webpage-smoke");
  if (withModel) {
    await webPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }
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

  const selectionRaceResult = await popup.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url === pageUrl);
    if (!tab?.id) throw new Error("선택 번역 테스트 탭을 찾지 못했습니다.");
    const send = (message) => chrome.tabs.sendMessage(tab.id, message);
    await send({
      type: "TRANSLATION_STARTED",
      requestId: "selection-old",
      sourceText: "Old selection"
    });
    await send({
      type: "TRANSLATION_STARTED",
      requestId: "selection-new",
      sourceText: "New selection"
    });
    await send({
      type: "SHOW_TRANSLATION",
      requestId: "selection-old",
      sourceText: "Old selection",
      response: {
        ok: true,
        requestId: "selection-old",
        translation: "이전 결과",
        sourceLanguage: "en",
        device: "wasm",
        elapsedMs: 1
      }
    });
    await send({
      type: "SHOW_TRANSLATION",
      requestId: "selection-new",
      sourceText: "New selection",
      response: {
        ok: true,
        requestId: "selection-new",
        translation: "최신 결과",
        sourceLanguage: "en",
        device: "wasm",
        elapsedMs: 1
      }
    });
    return true;
  }, webPage.url());
  if (!selectionRaceResult) {
    throw new Error("선택 번역 최신 요청 테스트를 실행하지 못했습니다.");
  }
  const selectionOverlay = await webPage.evaluate(() => {
    const host = document.querySelector('[data-ongeul-overlay="selection"]');
    return {
      source: host?.shadowRoot?.querySelector(".source")?.textContent ?? "",
      translation:
        host?.shadowRoot?.querySelector(".translation")?.textContent ?? ""
    };
  });
  if (
    selectionOverlay.source !== "New selection" ||
    selectionOverlay.translation !== "최신 결과"
  ) {
    throw new Error(
      `이전 선택 번역 결과가 최신 결과를 덮어썼습니다: ` +
      JSON.stringify(selectionOverlay)
    );
  }
  console.log("SELECTION_LATEST_REQUEST_GUARD=PASS");

  if (withModel) {
    const preTranslationHost = webPage.locator(
      "#pre-copy > [data-ongeul-page-translation]"
    );
    const pageTranslationHost = webPage.locator(
      "#custom-copy > [data-ongeul-page-translation]"
    );
    await preTranslationHost.waitFor({ state: "attached", timeout: 120_000 });
    await pageTranslationHost.waitFor({ state: "attached", timeout: 120_000 });
    pageTranslation = await pageTranslationHost.evaluate((host) =>
      host.shadowRoot?.querySelector(".text")?.textContent?.trim()
    );
    const preTranslation = await preTranslationHost.evaluate((host) =>
      host.shadowRoot?.querySelector(".text")?.textContent?.trim()
    );
    if (!pageTranslation || !/[가-힣]/.test(pageTranslation)) {
      throw new Error(`커스텀 본문 번역을 확인하지 못했습니다: ${pageTranslation ?? ""}`);
    }
    if (!preTranslation || !/[가-힣]/.test(preTranslation)) {
      throw new Error(`pre 산문 번역을 확인하지 못했습니다: ${preTranslation ?? ""}`);
    }
    if (
      await webPage.locator(
        "#dangerous-action [data-ongeul-page-translation]"
      ).count()
    ) {
      throw new Error("페이지 번역이 원래 동작 버튼 내부를 변경했습니다.");
    }
    const stoppedForBudget = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "STOP_PAGE_TRANSLATION"
      })
    );
    if (started.total === 40 && stoppedForBudget.state !== "stopped") {
      throw new Error(
        `화면 우선 번역을 중지하지 못했습니다: ${JSON.stringify(stoppedForBudget)}`
      );
    }
    const pageSpeechButton = pageTranslationHost.locator(".speak");
    if ((await pageSpeechButton.innerText()).trim() !== "▶ 듣기") {
      throw new Error("페이지 번역 결과에 TTS 듣기 버튼이 표시되지 않았습니다.");
    }

    if (withPageTts) {
      await pageSpeechButton.click();
      await pageSpeechButton.filter({ hasText: "음성 준비" }).waitFor();
      await pageSpeechButton.click();
      await pageSpeechButton.filter({ hasText: "듣기" }).waitFor();
      await webPage.waitForTimeout(2_000);
      const coldCancelStatus = await popup.evaluate(async () =>
        chrome.runtime.sendMessage({
          target: "background",
          type: "GET_TTS_STATUS"
        })
      );
      if (coldCancelStatus?.state !== "idle") {
        throw new Error(
          `페이지 TTS 콜드 로드 정지 상태가 되살아났습니다: ${JSON.stringify(coldCancelStatus)}`
        );
      }
      let translationProbeTimer;
      const translationAfterColdTtsCancel = await Promise.race([
        popup.evaluate(async () =>
          chrome.runtime.sendMessage({
            target: "background",
            type: "TRANSLATE",
            requestId: crypto.randomUUID(),
            text: "A stopped speech download must not block translation.",
            sourceLanguage: "en",
            origin: "popup"
          })
        ),
        new Promise((resolve) => {
          translationProbeTimer = setTimeout(
            () => resolve({ ok: false, error: "30초 시간 초과" }),
            30_000
          );
        })
      ]).finally(() => clearTimeout(translationProbeTimer));
      if (!translationAfterColdTtsCancel?.ok) {
        throw new Error(
          `TTS 콜드 로드 정지가 번역 큐를 막았습니다: ` +
          JSON.stringify(translationAfterColdTtsCancel)
        );
      }
      console.log("TRANSLATION_AFTER_TTS_CANCEL=PASS");
      await pageSpeechButton.click();
      const pageTtsStatus = await waitForTtsState(
        popup,
        ["playing", "error"],
        15 * 60_000,
        "PAGE_TTS"
      );
      await pageSpeechButton
        .filter({ hasText: pageTtsStatus?.state === "playing" ? "정지" : "다시 듣기" })
        .waitFor();
      const pageSpeechState = (await pageSpeechButton.innerText()).trim();
      if (pageSpeechState === "다시 듣기") {
        throw new Error(
          `페이지 번역 TTS 실행 오류: ${await pageSpeechButton.getAttribute("title")}`
        );
      }
      if (
        pageTtsStatus?.modelId !== "Supertone/supertonic-3" ||
        pageTtsStatus.state !== "playing"
      ) {
        throw new Error(
          `페이지 번역 TTS 재생 상태를 확인하지 못했습니다: ${JSON.stringify(pageTtsStatus)}`
        );
      }
      console.log(`PAGE_TTS_ENGINE=${pageTtsStatus.modelId}`);
      console.log(`PAGE_TTS_STATE=${pageTtsStatus.state}`);
      await pageSpeechButton.click();
      await pageSpeechButton.filter({ hasText: "듣기" }).waitFor();
      const stoppedPageTtsStatus = await waitForTtsState(popup, "idle", 10_000);
      if (stoppedPageTtsStatus.state !== "idle") {
        throw new Error(
          `페이지 번역 TTS가 정지되지 않았습니다: ${JSON.stringify(stoppedPageTtsStatus)}`
        );
      }
    }

    const completed = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "GET_PAGE_TRANSLATION_STATUS"
      })
    );
    if (
      !["complete", "stopped"].includes(completed.state) ||
      completed.completed < 2
    ) {
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
  if (requirePrimaryWebGpu) {
    const finalEngineStatus = await popup.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "GET_ENGINE_STATUS"
      })
    );
    assertPrimaryWebGpuStatus(
      finalEngineStatus,
      requestedModel,
      "onnx-community/translategemma-text-4b-it-ONNX"
    );
    console.log("PRIMARY_WEBGPU_FINAL=PASS");
  }

  const inFlightSubtitleSize =
    nextSubtitleSize <= 40 ? nextSubtitleSize + 1 : nextSubtitleSize - 1;
  const pagehideSubtitleSize =
    inFlightSubtitleSize <= 40
      ? inFlightSubtitleSize + 1
      : inFlightSubtitleSize - 1;
  await popup.locator("#subtitle-size").evaluate((
    element,
    values
  ) => {
    const input = /** @type {HTMLInputElement} */ (element);
    input.value = String(values.inFlight);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.value = String(values.pagehide);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, {
    inFlight: inFlightSubtitleSize,
    pagehide: pagehideSubtitleSize
  });
  await popup.close();
  const storedPagehideSubtitleSize = await serviceWorker.evaluate(async (
    expectedSize
  ) => {
    const deadline = Date.now() + 2_000;
    let stored;
    while (Date.now() < deadline) {
      stored = (await chrome.storage.sync.get("subtitleSize")).subtitleSize;
      if (stored === expectedSize) return stored;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return stored;
  }, pagehideSubtitleSize);
  if (storedPagehideSubtitleSize !== pagehideSubtitleSize) {
    throw new Error(
      `popup 종료 직전 자막 크기를 보존하지 못했습니다: ${storedPagehideSubtitleSize}`
    );
  }
  console.log("SUBTITLE_SIZE_PAGEHIDE_GUARD=PASS");

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

function assertPrimaryWebGpuStatus(status, requestedModel, requestedModelId) {
  if (
    requestedModel !== "translategemma" ||
    status?.state !== "ready" ||
    status.modelId !== requestedModelId ||
    status.device !== "webgpu" ||
    status.fallbackFromModelId ||
    status.fallbackFromDevice
  ) {
    throw new Error(
      `TranslateGemma WebGPU 기본 엔진이 폴백 없이 준비되지 않았습니다: ` +
      JSON.stringify(status)
    );
  }
}

async function launchExtensionWithRetry() {
  let lastError;
  const attempts = existingProfilePath ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await chromium.launchPersistentContext(profilePath, {
        executablePath: chromium.executablePath(),
        headless: true,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          "--disable-component-update",
          "--no-first-run"
        ]
      });
    } catch (error) {
      lastError = error;
      if (existingProfilePath || attempt === attempts - 1) break;
      await rm(profilePath, { recursive: true, force: true });
      profilePath = await mkdtemp(join(tmpdir(), "ongeul-chrome-smoke-"));
    }
  }
  throw lastError;
}

async function waitForTtsState(
  page,
  expectedState,
  timeoutMs,
  progressLabel = ""
) {
  const expectedStates = Array.isArray(expectedState)
    ? expectedState
    : [expectedState];
  const deadline = Date.now() + timeoutMs;
  let status = null;
  let lastProgress = "";
  while (Date.now() < deadline) {
    status = await page.evaluate(async () =>
      chrome.runtime.sendMessage({
        target: "background",
        type: "GET_TTS_STATUS"
      })
    );
    if (progressLabel) {
      const progress = JSON.stringify({
        state: status?.state,
        progress: status?.progress,
        file: status?.file,
        error: status?.error
      });
      if (progress !== lastProgress) {
        console.log(`${progressLabel}_PROGRESS=${progress}`);
        lastProgress = progress;
      }
    }
    if (expectedStates.includes(status?.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return status;
}

async function waitForTranslationResult(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastProgress = "";
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(async () => {
      const result = document.querySelector("#result-text");
      const status = await chrome.runtime.sendMessage({
        target: "background",
        type: "GET_ENGINE_STATUS"
      });
      return {
        complete: Boolean(result && !result.classList.contains("loading-lines")),
        status
      };
    });
    const progress = JSON.stringify({
      state: snapshot.status?.state,
      modelId: snapshot.status?.modelId,
      device: snapshot.status?.device,
      progressBucket: Math.floor((snapshot.status?.progress ?? 0) * 10) * 10,
      file: snapshot.status?.file,
      error: snapshot.status?.error
    });
    if (progress !== lastProgress) {
      console.log(`MODEL_PROGRESS=${progress}`);
      lastProgress = progress;
    }
    if (snapshot.complete) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
