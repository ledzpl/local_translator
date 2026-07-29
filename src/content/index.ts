import {
  DEFAULT_SETTINGS,
  TTS_MODEL_ID,
  createRequestId,
  type ContentMessage,
  type ExtensionSettings,
  type PageTranslationStatus,
  type SpeakResponse,
  type TtsStatus,
  type TranslationResponse
} from "../shared/protocol";
import { LruCache } from "../shared/cache";
import {
  captionStillMatches,
  captionTranslationKey,
  joinCaptionSegments,
  shouldRequestPendingCaption
} from "../shared/captions";
import {
  getPageTranslationTerminalState,
  getPageTranslationTexts,
  isLikelyProsePreformatted,
  prioritizePageTranslationCandidates
} from "../shared/page-text";
import { hasPrivacyConsent } from "../shared/privacy";
import { normalizeText } from "../shared/text";
import { isSpeechStatusFor } from "../shared/tts";

declare global {
  interface Window {
    __ongeulContentLoaded?: boolean;
  }
}

if (!window.__ongeulContentLoaded) {
  window.__ongeulContentLoaded = true;
  queueMicrotask(initialize);
}

function initialize(): void {
  const view = new OverlayView();
  const pageTranslator = new InPageTranslator();
  const youtube = new YouTubeCaptionTranslator(view);

  chrome.runtime.onMessage.addListener(
    (message: ContentMessage | { type: "PING" }, _sender, sendResponse): boolean | undefined => {
      switch (message.type) {
        case "PING":
          sendResponse({ ok: true });
          return false;
        case "GET_SELECTION":
          sendResponse({ text: getSelectedText() });
          return false;
        case "START_PAGE_TRANSLATION":
          sendResponse(pageTranslator.start());
          return false;
        case "GET_PAGE_TRANSLATION_STATUS":
          sendResponse(pageTranslator.getStatus());
          return false;
        case "STOP_PAGE_TRANSLATION":
          sendResponse(pageTranslator.stop());
          return false;
        case "RESTORE_PAGE_TRANSLATION":
          sendResponse(pageTranslator.restore());
          return false;
        case "TRANSLATION_STARTED":
          view.showSelectionLoading(message.requestId, message.sourceText);
          return false;
        case "SHOW_TRANSLATION":
          view.showSelectionResult(
            message.requestId,
            message.sourceText,
            message.response
          );
          return false;
        default:
          return undefined;
      }
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "sync" &&
      (changes.modelPreference || changes.devicePreference)
    ) {
      pageTranslator.stop();
    }
  });

  if (location.hostname === "www.youtube.com") youtube.start();
}

function getSelectedText(): string {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    const selected = active.value.slice(start, end);
    if (selected) return normalizeText(selected);
  }
  return normalizeText(window.getSelection()?.toString() ?? "");
}

class OverlayView {
  private selectionHost: HTMLElement | null = null;
  private subtitleHost: HTMLElement | null = null;
  private hideTimer: number | null = null;
  private latestSelectionRequestId: string | null = null;

  showSelectionLoading(requestId: string, sourceText: string): void {
    this.latestSelectionRequestId = requestId;
    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    const body = this.ensureSelectionCard();
    body.replaceChildren(
      createElement("div", "badge", "LOCAL AI"),
      createElement("div", "source", sourceText),
      createElement("div", "loading", "브라우저에서 번역 모델을 준비하고 있어요…")
    );
    this.positionSelectionCard();
  }

  showSelectionResult(
    requestId: string,
    sourceText: string,
    response: TranslationResponse
  ): void {
    if (requestId !== this.latestSelectionRequestId) return;
    const body = this.ensureSelectionCard();
    const result = response.ok ? response.translation : response.error;
    body.replaceChildren(
      createElement("div", "badge", response.ok ? "한국어 번역" : "번역 오류"),
      createElement("div", "source", sourceText),
      createElement("div", response.ok ? "translation" : "error", result),
      this.createCloseButton()
    );
    this.positionSelectionCard();

    if (this.hideTimer) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.selectionHost?.remove(), 18_000);
  }

  showSubtitle(text: string, settings: ExtensionSettings): void {
    const host = this.ensureSubtitleHost();
    const bubble = host.shadowRoot?.querySelector<HTMLElement>(".subtitle");
    if (!bubble) return;
    bubble.textContent = text;
    bubble.style.fontSize = `${settings.subtitleSize}px`;
    host.style.bottom = settings.showOriginalCaptions ? "19%" : "11%";
    host.hidden = !settings.youtubeEnabled || !text;
  }

  hideSubtitle(): void {
    if (this.subtitleHost) this.subtitleHost.hidden = true;
  }

  private ensureSelectionCard(): ShadowRoot {
    if (this.selectionHost?.isConnected && this.selectionHost.shadowRoot) {
      return this.selectionHost.shadowRoot;
    }
    const host = document.createElement("div");
    host.dataset.ongeulOverlay = "selection";
    host.style.position = "fixed";
    host.style.zIndex = "2147483647";
    host.style.maxWidth = "min(420px, calc(100vw - 28px))";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(createStyle(SELECTION_STYLES));
    document.documentElement.append(host);
    this.selectionHost = host;
    return shadow;
  }

  private ensureSubtitleHost(): HTMLElement {
    if (this.subtitleHost?.isConnected) return this.subtitleHost;
    const player = document.querySelector<HTMLElement>(".html5-video-player") ?? document.body;
    const host = document.createElement("div");
    host.dataset.ongeulOverlay = "subtitle";
    Object.assign(host.style, {
      position: "absolute",
      left: "5%",
      right: "5%",
      bottom: "19%",
      zIndex: "60",
      display: "flex",
      justifyContent: "center",
      pointerEvents: "none",
      textAlign: "center"
    });
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(createStyle(SUBTITLE_STYLES), createElement("div", "subtitle", ""));
    player.append(host);
    this.subtitleHost = host;
    return host;
  }

  private positionSelectionCard(): void {
    if (!this.selectionHost) return;
    const selection = window.getSelection();
    const rect = selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).getBoundingClientRect()
      : null;
    const width = Math.min(420, window.innerWidth - 28);
    const left = rect
      ? Math.min(window.innerWidth - width - 14, Math.max(14, rect.left))
      : Math.max(14, (window.innerWidth - width) / 2);
    const top = rect && rect.bottom + 12 < window.innerHeight - 170
      ? rect.bottom + 12
      : 18;
    this.selectionHost.style.width = `${width}px`;
    this.selectionHost.style.left = `${left}px`;
    this.selectionHost.style.top = `${Math.max(14, top)}px`;
  }

  private createCloseButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "close";
    button.type = "button";
    button.textContent = "닫기";
    button.addEventListener("click", () => this.selectionHost?.remove(), { once: true });
    return button;
  }
}

interface PageTranslationBlock {
  element: HTMLElement;
  sourceText: string;
}

class InPageTranslator {
  private status: PageTranslationStatus = {
    state: "idle",
    total: 0,
    completed: 0,
    failed: 0
  };
  private toolbarHost: HTMLElement | null = null;
  private generation = 0;
  private speechButton: HTMLButtonElement | null = null;
  private speechPollTimer: number | null = null;
  private speechRequest = 0;
  private speechId: string | null = null;

  start(): PageTranslationStatus {
    if (this.status.state === "translating") return this.getStatus();
    this.stopActiveSpeech();
    this.removeTranslations();
    const blocks = this.collectBlocks();
    this.generation += 1;
    const generation = this.generation;
    this.status = {
      state: blocks.length === 0 ? "complete" : "translating",
      total: blocks.length,
      completed: 0,
      failed: 0
    };
    this.ensureToolbar();
    this.updateToolbar();
    if (blocks.length > 0) void this.translateBlocks(blocks, generation);
    return this.getStatus();
  }

  stop(): PageTranslationStatus {
    if (this.status.state === "translating") {
      this.generation += 1;
      this.status = { ...this.status, state: "stopped" };
      this.updateToolbar();
    }
    return this.getStatus();
  }

  restore(): PageTranslationStatus {
    this.generation += 1;
    this.stopActiveSpeech();
    this.removeTranslations();
    this.toolbarHost?.remove();
    this.toolbarHost = null;
    this.status = {
      state: "idle",
      total: 0,
      completed: 0,
      failed: 0
    };
    return this.getStatus();
  }

  getStatus(): PageTranslationStatus {
    return { ...this.status };
  }

  private collectBlocks(): PageTranslationBlock[] {
    const selector =
      "h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dd, pre, xmp, article > *, main > *, [role='main'] > *, [role='article'] > *";
    const blocked =
      "nav, header, footer, aside, form, a, button, label, input, select, textarea, option, summary, audio, video, code, script, style, noscript, svg, canvas, [contenteditable='true'], [onclick], [tabindex]:not([tabindex='-1']), [role='button'], [role='link'], [role='menuitem'], [role='tab'], [role='checkbox'], [role='radio'], [role='switch'], .html5-video-player, [data-ongeul-overlay], [data-ongeul-page-translation]";
    const candidates: Array<{
      value: PageTranslationBlock;
      sourceText: string;
      visible: boolean;
    }> = [];

    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest(blocked)) continue;
      if (element.querySelector(selector)) continue;
      if (
        element.matches("pre, xmp") &&
        (element.querySelector("code") ||
          !isLikelyProsePreformatted(element.textContent ?? ""))
      ) {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const sourceTexts = getPageTranslationTexts(element.textContent ?? "");
      const visible = rect.bottom >= 0 && rect.top <= window.innerHeight;
      for (const sourceText of sourceTexts) {
        candidates.push({
          value: { element, sourceText },
          sourceText,
          visible
        });
      }
    }

    return prioritizePageTranslationCandidates(candidates)
      .map((candidate) => candidate.value);
  }

  private async translateBlocks(
    blocks: readonly PageTranslationBlock[],
    generation: number
  ): Promise<void> {
    for (const block of blocks) {
      if (generation !== this.generation) return;
      try {
        const response = await chrome.runtime.sendMessage({
          target: "background",
          type: "TRANSLATE",
          requestId: createRequestId(),
          text: block.sourceText,
          sourceLanguage: "auto",
          origin: "page"
        }) as TranslationResponse;
        if (generation !== this.generation) return;
        if (response.ok) {
          this.renderTranslation(block.element, response.translation);
          this.status.completed += 1;
        } else {
          this.status.failed += 1;
        }
      } catch {
        this.status.failed += 1;
      }
      this.updateToolbar();
    }

    if (generation === this.generation) {
      this.status = {
        ...this.status,
        state: getPageTranslationTerminalState(
          this.status.total,
          this.status.failed
        ),
        error:
          this.status.failed === this.status.total
            ? "페이지 문장을 번역하지 못했습니다."
            : this.status.failed > 0
              ? `${this.status.failed}개 문장을 번역하지 못했습니다.`
            : undefined
      };
      this.updateToolbar();
    }
  }

  private renderTranslation(element: HTMLElement, translation: string): void {
    const host = document.createElement("span");
    host.dataset.ongeulPageTranslation = "true";
    host.lang = "ko";
    host.setAttribute("translate", "no");
    const shadow = host.attachShadow({ mode: "open" });
    const speak = createElement("button", "speak", "▶ 듣기");
    speak.type = "button";
    speak.dataset.state = "idle";
    speak.setAttribute("aria-label", "한국어 번역 듣기");
    speak.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleSpeech(speak, translation);
    });
    shadow.append(
      createStyle(PAGE_TRANSLATION_STYLES),
      createElement("span", "label", "KO"),
      speak,
      createElement("span", "text", translation)
    );
    element.append(host);
  }

  private toggleSpeech(button: HTMLButtonElement, translation: string): void {
    if (this.speechButton === button && isActiveTtsButton(button)) {
      this.stopActiveSpeech();
      return;
    }

    this.resetSpeechButton();
    this.speechRequest += 1;
    const request = this.speechRequest;
    const speechId = createRequestId();
    this.speechId = speechId;
    this.speechButton = button;
    updatePageSpeechButton(button, {
      state: "loading",
      modelId: TTS_MODEL_ID,
      speechId,
      file: "한국어 음성 모델 준비 중"
    });
    void chrome.runtime.sendMessage({
      target: "background",
      type: "SPEAK_KOREAN",
      speechId,
      text: translation
    }).then((response: SpeakResponse | null) => {
      if (request !== this.speechRequest) return;
      if (response?.ok && response.speechId === speechId) {
        this.pollSpeechStatus(request);
        return;
      }
      updatePageSpeechButton(button, {
        state: "error",
        modelId: TTS_MODEL_ID,
        speechId,
        error: response?.error ?? "음성을 시작하지 못했습니다."
      });
      this.finishSpeechRequest(request, speechId);
    }).catch((error) => {
      if (request !== this.speechRequest) return;
      updatePageSpeechButton(button, {
        state: "error",
        modelId: TTS_MODEL_ID,
        speechId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.finishSpeechRequest(request, speechId);
    });
  }

  private pollSpeechStatus(request: number): void {
    if (this.speechPollTimer) window.clearTimeout(this.speechPollTimer);
    const poll = async (): Promise<void> => {
      if (request !== this.speechRequest || !this.speechButton?.isConnected) return;
      try {
        const status = await chrome.runtime.sendMessage({
          target: "background",
          type: "GET_TTS_STATUS"
        }) as TtsStatus | null;
        if (request !== this.speechRequest || !this.speechButton) return;
        if (!status || !isSpeechStatusFor(status, this.speechId)) {
          this.resetSpeechButton();
          return;
        }
        updatePageSpeechButton(this.speechButton, status);
        if (!status || status.state === "idle") {
          this.resetSpeechButton();
          return;
        }
        if (status.state === "error") {
          this.speechPollTimer = null;
          this.speechButton = null;
          this.speechId = null;
          return;
        }
      } catch {
        if (request !== this.speechRequest || !this.speechButton) return;
      }
      this.speechPollTimer = window.setTimeout(() => void poll(), 300);
    };
    this.speechPollTimer = window.setTimeout(() => void poll(), 120);
  }

  private stopActiveSpeech(): void {
    const button = this.speechButton;
    const speechId = this.speechId;
    const wasActive = Boolean(
      button &&
      speechId &&
      isActiveTtsButton(button)
    );
    this.speechRequest += 1;
    if (this.speechPollTimer) window.clearTimeout(this.speechPollTimer);
    this.speechPollTimer = null;
    this.resetSpeechButton();
    if (wasActive && speechId) {
      void chrome.runtime.sendMessage({
        target: "background",
        type: "STOP_SPEAKING",
        speechId
      }).then((response: SpeakResponse | null) => {
        if (!response?.ok && button?.isConnected) {
          updatePageSpeechButton(button, {
            state: "error",
            modelId: TTS_MODEL_ID,
            speechId,
            error: response?.error ?? "음성을 정지하지 못했습니다."
          });
        }
      }).catch((error) => {
        if (!button?.isConnected) return;
        updatePageSpeechButton(button, {
          state: "error",
          modelId: TTS_MODEL_ID,
          speechId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }

  private resetSpeechButton(): void {
    if (this.speechButton?.isConnected) {
      updatePageSpeechButton(this.speechButton, {
        state: "idle",
        modelId: TTS_MODEL_ID
      });
    }
    this.speechButton = null;
    this.speechId = null;
  }

  private finishSpeechRequest(request: number, speechId: string): void {
    if (request !== this.speechRequest || this.speechId !== speechId) return;
    if (this.speechPollTimer) window.clearTimeout(this.speechPollTimer);
    this.speechPollTimer = null;
    this.speechButton = null;
    this.speechId = null;
  }

  private ensureToolbar(): void {
    if (this.toolbarHost?.isConnected) return;
    const host = document.createElement("div");
    host.dataset.ongeulOverlay = "page-toolbar";
    Object.assign(host.style, {
      position: "fixed",
      top: "18px",
      right: "18px",
      zIndex: "2147483647"
    });
    const shadow = host.attachShadow({ mode: "open" });
    const status = createElement("div", "status", "");
    const progress = document.createElement("progress");
    progress.className = "progress";
    progress.max = 1;
    const stop = createElement("button", "stop", "중지");
    stop.type = "button";
    stop.addEventListener("click", () => this.stop());
    const restore = createElement("button", "restore", "번역 지우기");
    restore.type = "button";
    restore.addEventListener("click", () => this.restore());
    shadow.append(
      createStyle(PAGE_TOOLBAR_STYLES),
      createElement("div", "brand", "온글 · 페이지 번역"),
      status,
      progress,
      createElement("div", "actions", "")
    );
    shadow.querySelector(".actions")?.append(stop, restore);
    document.documentElement.append(host);
    this.toolbarHost = host;
  }

  private updateToolbar(): void {
    const shadow = this.toolbarHost?.shadowRoot;
    if (!shadow) return;
    const status = shadow.querySelector<HTMLElement>(".status");
    const progress = shadow.querySelector<HTMLProgressElement>(".progress");
    const stop = shadow.querySelector<HTMLButtonElement>(".stop");
    if (!status || !progress || !stop) return;

    progress.value =
      this.status.total === 0
        ? 1
        : (this.status.completed + this.status.failed) / this.status.total;
    stop.hidden = this.status.state !== "translating";

    if (this.status.state === "translating") {
      status.textContent = `${this.status.completed + this.status.failed} / ${this.status.total} 문장 번역 중`;
    } else if (this.status.state === "complete" && this.status.total === 0) {
      status.textContent = "번역할 외국어 문장을 찾지 못했어요.";
    } else if (this.status.state === "complete") {
      status.textContent = `${this.status.completed}개 문장을 페이지에 표시했어요.`;
    } else if (this.status.state === "partial") {
      status.textContent =
        `${this.status.completed}개 표시 · ${this.status.failed}개 실패`;
    } else if (this.status.state === "stopped") {
      status.textContent = `${this.status.completed}개 문장 번역 후 중지했어요.`;
    } else if (this.status.state === "error") {
      status.textContent = this.status.error ?? "페이지 번역에 실패했어요.";
    }
  }

  private removeTranslations(): void {
    document
      .querySelectorAll<HTMLElement>("[data-ongeul-page-translation]")
      .forEach((element) => element.remove());
  }
}

class YouTubeCaptionTranslator {
  private settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private retryTimer: number | null = null;
  private lastRequestedKey = "";
  private currentCaption = "";
  private pendingCaption = "";
  private translationInFlight = false;
  private settingsGeneration = 0;
  private navigationUrl = location.href;
  private readonly cache = new LruCache<string>(180);
  private readonly retryAttempts = new Map<string, number>();

  constructor(private readonly view: OverlayView) {}

  start(): void {
    void this.loadSettings().then(() => {
      if (!hasPrivacyConsent(this.settings)) {
        this.view.hideSubtitle();
        this.applyOriginalCaptionVisibility(false);
        return;
      }
      this.observe();
      this.maybeEnableCaptions();
      this.scan();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const previousTranslationSettings =
        `${this.settings.modelPreference}\u0000${this.settings.devicePreference}`;
      const wasEnabled = this.settings.youtubeEnabled;
      for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ExtensionSettings>) {
        if (changes[key]?.newValue !== undefined) {
          Object.assign(this.settings, { [key]: changes[key]?.newValue });
        }
      }
      const nextTranslationSettings =
        `${this.settings.modelPreference}\u0000${this.settings.devicePreference}`;
      if (previousTranslationSettings !== nextTranslationSettings) {
        this.invalidateTranslations();
      } else if (wasEnabled !== this.settings.youtubeEnabled) {
        this.lastRequestedKey = "";
      }
      this.applyOriginalCaptionVisibility();
      if (!hasPrivacyConsent(this.settings) || !this.settings.youtubeEnabled) {
        this.settingsGeneration += 1;
        this.view.hideSubtitle();
        return;
      }
      this.observe();
      this.maybeEnableCaptions();
      this.scan();
    });

    window.setInterval(() => {
      if (this.navigationUrl === location.href) return;
      this.navigationUrl = location.href;
      this.lastRequestedKey = "";
      this.currentCaption = "";
      this.pendingCaption = "";
      this.clearRetry();
      this.view.hideSubtitle();
      this.applyOriginalCaptionVisibility(false);
      this.maybeEnableCaptions();
    }, 900);
  }

  private async loadSettings(): Promise<void> {
    this.settings = await chrome.storage.sync.get(DEFAULT_SETTINGS) as ExtensionSettings;
    this.applyOriginalCaptionVisibility();
  }

  private observe(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      const captionChanged = mutations.some((mutation) => {
        const node = mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;
        return Boolean(node?.closest(".ytp-caption-window-container, .ytp-caption-segment"));
      });
      if (captionChanged) this.scheduleScan();
    });
    this.observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  private scheduleScan(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => this.scan(), 360);
  }

  private scan(): void {
    if (!hasPrivacyConsent(this.settings) || !this.settings.youtubeEnabled) return;
    this.applyOriginalCaptionVisibility(false);
    const text = readVisibleYoutubeCaption();
    this.currentCaption = text;
    if (!text) {
      this.view.hideSubtitle();
      return;
    }

    const requestKey = captionTranslationKey(text, this.settings);
    const cached = this.cache.get(requestKey);
    if (cached) {
      this.view.showSubtitle(cached, this.settings);
      this.applyOriginalCaptionVisibility(true);
      return;
    }
    this.view.hideSubtitle();
    if (this.translationInFlight) {
      this.pendingCaption = text;
      return;
    }
    if (requestKey === this.lastRequestedKey) return;
    this.lastRequestedKey = requestKey;
    void this.requestTranslation(text, requestKey);
  }

  private async requestTranslation(
    sourceText: string,
    requestKey: string
  ): Promise<void> {
    this.translationInFlight = true;
    const generation = this.settingsGeneration;
    try {
      const response = await chrome.runtime.sendMessage({
        target: "background",
        type: "TRANSLATE",
        requestId: createRequestId(),
        text: sourceText,
        sourceLanguage: "auto",
        origin: "youtube"
      }) as TranslationResponse;
      if (
        generation !== this.settingsGeneration ||
        requestKey !== captionTranslationKey(sourceText, this.settings)
      ) {
        return;
      }
      if (!response?.ok) {
        this.scheduleRetry(sourceText, requestKey, generation);
        return;
      }
      this.retryAttempts.delete(requestKey);
      if (response.sourceLanguage === "ko" || response.device === "none") {
        this.view.hideSubtitle();
        this.applyOriginalCaptionVisibility(false);
        return;
      }
      this.cache.set(requestKey, response.translation);
      if (captionStillMatches(this.currentCaption, sourceText)) {
        this.view.showSubtitle(response.translation, this.settings);
        this.applyOriginalCaptionVisibility(true);
      }
    } catch {
      this.scheduleRetry(sourceText, requestKey, generation);
    } finally {
      this.translationInFlight = false;
      const pending = this.pendingCaption;
      this.pendingCaption = "";
      const currentRequestKey = pending
        ? captionTranslationKey(pending, this.settings)
        : "";
      if (shouldRequestPendingCaption({
        pendingCaption: pending,
        currentCaption: this.currentCaption,
        sourceText,
        requestKey,
        currentRequestKey,
        generationChanged: generation !== this.settingsGeneration
      })) {
        this.lastRequestedKey = "";
        this.scan();
      }
    }
  }

  private scheduleRetry(
    sourceText: string,
    requestKey: string,
    generation: number
  ): void {
    if (
      generation !== this.settingsGeneration ||
      !captionStillMatches(this.currentCaption, sourceText)
    ) {
      return;
    }
    const attempts = (this.retryAttempts.get(requestKey) ?? 0) + 1;
    this.retryAttempts.set(requestKey, attempts);
    if (attempts > 2) return;

    this.lastRequestedKey = "";
    this.clearRetry();
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (
        generation === this.settingsGeneration &&
        captionStillMatches(this.currentCaption, sourceText)
      ) {
        this.scan();
      }
    }, attempts * 800);
  }

  private invalidateTranslations(): void {
    this.settingsGeneration += 1;
    this.cache.clear();
    this.retryAttempts.clear();
    this.lastRequestedKey = "";
    this.pendingCaption = "";
    this.clearRetry();
    this.view.hideSubtitle();
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private maybeEnableCaptions(): void {
    if (
      !hasPrivacyConsent(this.settings) ||
      !this.settings.youtubeEnabled ||
      !this.settings.autoEnableCaptions
    ) {
      return;
    }
    window.setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>(".ytp-subtitles-button");
      if (button && button.getAttribute("aria-pressed") === "false") button.click();
    }, 1200);
  }

  private applyOriginalCaptionVisibility(hasTranslation = false): void {
    const opacity =
      hasPrivacyConsent(this.settings) &&
      this.settings.youtubeEnabled &&
      !this.settings.showOriginalCaptions &&
      hasTranslation
        ? "0"
        : "";
    document.querySelectorAll<HTMLElement>(".ytp-caption-window-container")
      .forEach((element) => {
        element.style.opacity = opacity;
      });
  }
}

export function readVisibleYoutubeCaption(root: ParentNode = document): string {
  const windows = Array.from(
    root.querySelectorAll<HTMLElement>(".ytp-caption-window-container")
  );
  const visible = windows.filter((element) => element.getClientRects().length > 0);
  const candidate = visible.at(-1) ?? windows.at(-1);
  if (!candidate) return "";
  const segments = Array.from(candidate.querySelectorAll<HTMLElement>(".ytp-caption-segment"));
  return joinCaptionSegments(segments.map((segment) => segment.textContent));
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function createStyle(css: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = css;
  return style;
}

function isActiveTtsButton(button: HTMLButtonElement): boolean {
  return button.dataset.state === "loading" ||
    button.dataset.state === "synthesizing" ||
    button.dataset.state === "playing";
}

function updatePageSpeechButton(
  button: HTMLButtonElement,
  status: TtsStatus
): void {
  button.dataset.state = status.state;
  button.classList.toggle("active", isActiveTtsButton(button));
  button.classList.toggle("error", status.state === "error");
  if (status.state === "loading") {
    const percent = status.progress && status.progress > 0
      ? ` ${Math.round(status.progress * 100)}%`
      : "";
    button.textContent = `음성 준비${percent}`;
    button.title = status.file ?? "한국어 음성 모델 준비 중";
  } else if (status.state === "synthesizing") {
    button.textContent = "음성 생성 중";
    button.title = status.file ?? "한국어 음성 생성 중";
  } else if (status.state === "playing") {
    button.textContent = "■ 정지";
    button.title = "한국어 번역 읽기 정지";
  } else if (status.state === "error") {
    button.textContent = "다시 듣기";
    button.title = status.error ?? "한국어 음성을 만들지 못했습니다.";
  } else {
    button.textContent = "▶ 듣기";
    button.title = "한국어 번역 듣기";
  }
}

const SELECTION_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  :host {
    display: block;
    color: #f8f7f2;
    background: rgba(16, 18, 18, 0.97);
    border: 1px solid rgba(221, 255, 68, 0.35);
    border-radius: 18px;
    box-shadow: 0 18px 64px rgba(0, 0, 0, 0.38);
    padding: 16px;
    font-family: Pretendard, Inter, system-ui, -apple-system, sans-serif;
    backdrop-filter: blur(18px);
  }
  .badge {
    display: inline-flex;
    padding: 4px 8px;
    border-radius: 999px;
    background: #ddff44;
    color: #111;
    font: 800 10px/1 system-ui;
    letter-spacing: .08em;
    text-transform: uppercase;
  }
  .source {
    margin-top: 11px;
    color: #a6aaa5;
    font: 500 12px/1.45 system-ui;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .translation, .error, .loading {
    margin-top: 8px;
    color: #fff;
    font: 700 16px/1.55 system-ui;
    white-space: pre-wrap;
  }
  .error { color: #ff958c; }
  .loading { color: #ddff44; }
  .close {
    margin-top: 12px;
    border: 0;
    border-radius: 999px;
    background: #2d302f;
    color: #d6d8d4;
    padding: 7px 12px;
    font: 700 11px/1 system-ui;
    cursor: pointer;
  }
`;

const SUBTITLE_STYLES = `
  :host { all: initial; }
  .subtitle {
    display: inline;
    padding: .2em .48em .28em;
    border-radius: .35em;
    background: rgba(8, 10, 10, .88);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    color: #f7ffcc;
    font-family: Pretendard, Inter, system-ui, -apple-system, sans-serif;
    font-weight: 800;
    line-height: 1.45;
    letter-spacing: -.025em;
    text-shadow: 0 2px 3px rgba(0, 0, 0, .9);
    box-shadow: 0 4px 22px rgba(0, 0, 0, .28);
  }
`;

const PAGE_TRANSLATION_STYLES = `
  :host {
    display: block !important;
    margin: .42em 0 .18em !important;
    padding: .48em .68em !important;
    border-left: 3px solid #cfee36 !important;
    border-radius: 0 .45em .45em 0 !important;
    background: rgba(220, 255, 68, .09) !important;
    color: inherit !important;
    font-family: Pretendard, Inter, system-ui, -apple-system, sans-serif !important;
    font-size: .92em !important;
    font-style: normal !important;
    font-weight: 650 !important;
    line-height: 1.55 !important;
    letter-spacing: -.015em !important;
    text-align: left !important;
    text-transform: none !important;
  }
  .label {
    display: inline-block;
    margin-right: .55em;
    color: #91a919;
    font: 900 .65em/1 system-ui;
    letter-spacing: .08em;
    vertical-align: .12em;
  }
  .text { white-space: pre-wrap; }
  .speak {
    display: inline-block;
    margin: .08em .65em .08em 0;
    border: 1px solid rgba(145, 169, 25, .35);
    border-radius: 999px;
    padding: .38em .7em;
    background: rgba(145, 169, 25, .12);
    color: #71870d;
    font: 800 .68em/1 system-ui;
    white-space: nowrap;
    cursor: pointer;
  }
  .speak:hover { background: rgba(145, 169, 25, .2); }
  .speak.active {
    border-color: rgba(221, 255, 68, .45);
    background: rgba(221, 255, 68, .18);
    color: #789000;
  }
  .speak.error {
    border-color: rgba(220, 80, 72, .3);
    background: rgba(220, 80, 72, .08);
    color: #b5413b;
  }
`;

const PAGE_TOOLBAR_STYLES = `
  :host {
    display: block;
    width: 250px;
    padding: 14px;
    border: 1px solid rgba(221, 255, 68, .32);
    border-radius: 16px;
    background: rgba(16, 19, 18, .96);
    color: #f5f7f2;
    box-shadow: 0 18px 55px rgba(0, 0, 0, .32);
    font-family: Pretendard, Inter, system-ui, -apple-system, sans-serif;
    backdrop-filter: blur(16px);
  }
  * { box-sizing: border-box; }
  .brand {
    color: #ddff44;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: .04em;
  }
  .status {
    margin-top: 7px;
    color: #e8ebe5;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.4;
  }
  .progress {
    width: 100%;
    height: 4px;
    margin-top: 10px;
    border: 0;
    accent-color: #ddff44;
  }
  .actions {
    display: flex;
    gap: 7px;
    margin-top: 10px;
  }
  button {
    border: 0;
    border-radius: 999px;
    padding: 7px 11px;
    background: #303532;
    color: #e5e8e3;
    font: 800 10px/1 system-ui;
    cursor: pointer;
  }
  button.restore { background: #ddff44; color: #111; }
  button[hidden] { display: none; }
`;
