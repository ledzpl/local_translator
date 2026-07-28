import {
  DEFAULT_SETTINGS,
  createRequestId,
  type ContentMessage,
  type ExtensionSettings,
  type PageTranslationStatus,
  type TranslationResponse
} from "../shared/protocol";
import { LruCache } from "../shared/cache";
import { captionStillMatches, joinCaptionSegments } from "../shared/captions";
import {
  PAGE_TRANSLATION_MAX_BLOCKS,
  PAGE_TRANSLATION_MAX_CHARS,
  getPageTranslationText
} from "../shared/page-text";
import { normalizeText } from "../shared/text";

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
          view.showSelectionLoading(message.sourceText);
          return false;
        case "SHOW_TRANSLATION":
          view.showSelectionResult(message.sourceText, message.response);
          return false;
        default:
          return undefined;
      }
    }
  );

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

  showSelectionLoading(sourceText: string): void {
    const body = this.ensureSelectionCard();
    body.replaceChildren(
      createElement("div", "badge", "LOCAL AI"),
      createElement("div", "source", sourceText),
      createElement("div", "loading", "브라우저에서 번역 모델을 준비하고 있어요…")
    );
    this.positionSelectionCard();
  }

  showSelectionResult(sourceText: string, response: TranslationResponse): void {
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

  start(): PageTranslationStatus {
    if (this.status.state === "translating") return this.getStatus();
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
    const selector = "h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption, dd";
    const blocked =
      "nav, header, footer, aside, form, pre, code, script, style, noscript, svg, canvas, [contenteditable='true'], .html5-video-player, [data-ongeul-overlay], [data-ongeul-page-translation]";
    const visible: PageTranslationBlock[] = [];
    const remaining: PageTranslationBlock[] = [];
    let totalChars = 0;

    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest(blocked)) continue;
      if (element.querySelector(selector)) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const sourceText = getPageTranslationText(element.textContent ?? "");
      if (!sourceText) continue;
      if (
        visible.length + remaining.length >= PAGE_TRANSLATION_MAX_BLOCKS ||
        totalChars + sourceText.length > PAGE_TRANSLATION_MAX_CHARS
      ) {
        break;
      }

      const block = { element, sourceText };
      totalChars += sourceText.length;
      if (rect.bottom >= 0 && rect.top <= window.innerHeight) visible.push(block);
      else remaining.push(block);
    }

    return [...visible, ...remaining];
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
        state: this.status.failed === this.status.total ? "error" : "complete",
        error:
          this.status.failed === this.status.total
            ? "페이지 문장을 번역하지 못했습니다."
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
    shadow.append(
      createStyle(PAGE_TRANSLATION_STYLES),
      createElement("span", "label", "KO"),
      createElement("span", "text", translation)
    );
    element.append(host);
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
  private lastRequested = "";
  private currentCaption = "";
  private pendingCaption = "";
  private translationInFlight = false;
  private navigationUrl = location.href;
  private readonly cache = new LruCache<string>(180);

  constructor(private readonly view: OverlayView) {}

  start(): void {
    void this.loadSettings().then(() => {
      this.observe();
      this.maybeEnableCaptions();
      this.scan();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ExtensionSettings>) {
        if (changes[key]?.newValue !== undefined) {
          Object.assign(this.settings, { [key]: changes[key]?.newValue });
        }
      }
      this.applyOriginalCaptionVisibility();
      if (!this.settings.youtubeEnabled) this.view.hideSubtitle();
      else this.scan();
    });

    window.setInterval(() => {
      if (this.navigationUrl === location.href) return;
      this.navigationUrl = location.href;
      this.lastRequested = "";
      this.currentCaption = "";
      this.pendingCaption = "";
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
    if (!this.settings.youtubeEnabled) return;
    this.applyOriginalCaptionVisibility(false);
    const text = readVisibleYoutubeCaption();
    this.currentCaption = text;
    if (!text) {
      this.view.hideSubtitle();
      return;
    }

    const cached = this.cache.get(text);
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
    if (text === this.lastRequested) return;
    this.lastRequested = text;
    void this.requestTranslation(text);
  }

  private async requestTranslation(sourceText: string): Promise<void> {
    this.translationInFlight = true;
    try {
      const response = await chrome.runtime.sendMessage({
        target: "background",
        type: "TRANSLATE",
        requestId: createRequestId(),
        text: sourceText,
        sourceLanguage: "auto",
        origin: "youtube"
      });
      if (!response?.ok) return;
      this.cache.set(sourceText, response.translation);
      if (captionStillMatches(this.currentCaption, sourceText)) {
        this.view.showSubtitle(response.translation, this.settings);
        this.applyOriginalCaptionVisibility(true);
      }
    } finally {
      this.translationInFlight = false;
      const pending = this.pendingCaption;
      this.pendingCaption = "";
      if (pending && pending !== sourceText && pending === this.currentCaption) {
        this.lastRequested = pending;
        void this.requestTranslation(pending);
      }
    }
  }

  private maybeEnableCaptions(): void {
    if (!this.settings.youtubeEnabled || !this.settings.autoEnableCaptions) return;
    window.setTimeout(() => {
      const button = document.querySelector<HTMLButtonElement>(".ytp-subtitles-button");
      if (button && button.getAttribute("aria-pressed") === "false") button.click();
    }, 1200);
  }

  private applyOriginalCaptionVisibility(hasTranslation = false): void {
    const opacity =
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
