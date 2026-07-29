import "./styles.css";
import {
  DEFAULT_SETTINGS,
  MODEL_ID,
  TTS_MODEL_ID,
  createRequestId,
  type DevicePreference,
  type EngineStatus,
  type ExtensionSettings,
  type ModelPreference,
  type PageTranslationStatus,
  type SpeakResponse,
  type TtsStatus,
  type TranslationResponse,
  type UiProgressMessage,
  type UiTtsProgressMessage
} from "../shared/protocol";
import { LANGUAGE_OPTIONS } from "../shared/languages";
import {
  M2M100_MODEL_ID,
  MODEL_DEFINITIONS,
  SMALL100_MODEL_ID
} from "../shared/models";
import {
  CURRENT_PRIVACY_CONSENT_VERSION,
  hasPrivacyConsent
} from "../shared/privacy";
import { isSpeechStatusFor } from "../shared/tts";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("앱 루트를 찾을 수 없습니다.");
const isExtensionRuntime =
  typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const EXTENSION_RELOAD_MESSAGE =
  "확장 프로그램이 업데이트되었습니다. chrome://extensions에서 온글 번역을 새로고침해 주세요.";

app.innerHTML = `
  <section id="privacy-onboarding" class="privacy-onboarding" hidden>
    <div class="eyebrow"><span class="pulse"></span> PRIVATE BY DESIGN</div>
    <h1>온글<span>.</span></h1>
    <h2>번역을 시작하기 전에 확인해 주세요</h2>
    <ul>
      <li>직접 입력하거나 선택한 텍스트, 요청한 페이지 본문과 켠 YouTube 자막은 이 기기 안에서만 번역합니다.</li>
      <li>번역·음성 모델 파일만 Hugging Face에서 내려받으며, 번역할 내용은 개발자나 Hugging Face에 보내지 않습니다.</li>
      <li>첫 번역은 실행 경로별 약 650~750MB를 받으며, WebGPU 자동 전환 시 두 경로를 순차 다운로드해 전송량이 최대 약 1.4GB가 될 수 있습니다.</li>
      <li>모델·언어·자막 설정과 이 확인 기록은 Chrome 동기화 저장소에 보관될 수 있습니다. 페이지 내용은 저장하지 않습니다.</li>
    </ul>
    <a href="/privacy.html" target="_blank" rel="noreferrer">개인정보처리방침 전체 보기</a>
    <label class="consent-check">
      <input id="privacy-consent-check" type="checkbox" />
      <span>위 데이터 처리 방식과 모델 다운로드를 확인했습니다.</span>
    </label>
    <button id="privacy-consent-button" class="primary-button" type="button" disabled>
      <span>동의하고 시작</span><span aria-hidden="true">→</span>
    </button>
    <p id="privacy-consent-error" class="consent-error" hidden></p>
  </section>

  <div id="product-ui" hidden>
  <header class="header">
    <div>
      <div class="eyebrow"><span class="pulse"></span> LOCAL AI TRANSLATOR</div>
      <h1>온글<span>.</span></h1>
    </div>
    <div class="privacy-pill">번역 내용 외부 전송 없음</div>
  </header>

  <section class="page-card">
    <div class="page-card-heading">
      <div class="page-icon">WEB</div>
      <div>
        <span class="kicker">CURRENT PAGE</span>
        <h2>페이지 안에서 번역</h2>
      </div>
    </div>
    <p id="page-status">본문 원문 아래에 한국어를 순서대로 표시합니다.</p>
    <div class="page-actions">
      <button id="page-translate-button" type="button">페이지 안에 한국어 표시</button>
      <button id="page-restore-button" type="button" hidden>번역 지우기</button>
      <button id="extension-reload-button" type="button" hidden>확장 새로고침</button>
    </div>
  </section>

  <section class="translator-card">
    <label class="field-label" for="source-text">번역할 텍스트</label>
    <textarea id="source-text" maxlength="5000" placeholder="텍스트를 붙여넣거나 웹페이지에서 선택하세요."></textarea>
    <div class="input-footer">
      <select id="source-language" aria-label="원문 언어"></select>
      <span id="character-count">0 / 5,000</span>
    </div>
    <button id="translate-button" class="primary-button" type="button">
      <span>한국어로 번역</span>
      <span aria-hidden="true">→</span>
    </button>
  </section>

  <section id="result-card" class="result-card" hidden>
    <div class="result-heading">
      <span>한국어</span>
      <div class="result-actions">
        <button id="speak-button" type="button">▶ 듣기</button>
        <button id="copy-button" type="button">복사</button>
      </div>
    </div>
    <div id="result-text" class="result-text"></div>
    <div id="result-meta" class="result-meta"></div>
  </section>

  <section class="engine-card">
    <div class="engine-row">
      <div class="engine-icon">AI</div>
      <div class="engine-copy">
        <strong id="engine-title">로컬 모델 대기 중</strong>
        <span id="engine-detail">경로별 약 650~750MB · 자동 폴백 시 최대 약 1.4GB</span>
      </div>
      <span id="engine-state" class="engine-state idle">대기</span>
    </div>
    <div id="progress-track" class="progress-track" hidden>
      <div id="progress-bar" class="progress-bar"></div>
    </div>
    <div class="engine-row speech-row">
      <div class="engine-icon">VO</div>
      <div class="engine-copy">
        <strong id="tts-title">한국어 음성 AI 대기 중</strong>
        <span id="tts-detail">첫 듣기 때 약 40MB 모델을 내려받습니다.</span>
      </div>
      <span id="tts-state" class="engine-state idle">대기</span>
      <button id="tts-stop-button" class="tts-stop-button" type="button" hidden>정지</button>
    </div>
  </section>

  <section class="settings">
    <div class="section-title">
      <div>
        <span class="kicker">YOUTUBE</span>
        <h2>자막 번역</h2>
      </div>
      <label class="switch">
        <input id="youtube-enabled" type="checkbox" />
        <span></span>
      </label>
    </div>

    <label class="setting-row">
      <div><strong>자막 자동 켜기</strong><span>YouTube 원문 자막을 자동으로 활성화</span></div>
      <input id="auto-captions" type="checkbox" />
    </label>
    <label class="setting-row">
      <div><strong>원문 함께 보기</strong><span>원문 위에 한국어 자막 표시</span></div>
      <input id="show-original" type="checkbox" />
    </label>
    <label class="setting-row range-row">
      <div><strong>한국어 자막 크기</strong><span id="subtitle-size-value">28px</span></div>
      <input id="subtitle-size" type="range" min="18" max="42" step="1" />
    </label>
  </section>

  <details class="advanced">
    <summary>엔진 설정</summary>
    <label>
      번역 모델
      <select id="model-preference">
        <option value="m2m100">M2M100 — 권장 기본 모델</option>
        <option value="small100">SMaLL-100 — 실험적 WASM 호환</option>
      </select>
    </label>
    <label>
      실행 장치
      <select id="device-preference">
        <option value="auto">자동 — WebGPU 우선</option>
        <option value="wasm">WASM — 호환성 우선</option>
        <option value="webgpu">WebGPU — 실험적 GPU 가속</option>
      </select>
    </label>
    <p id="model-setting-detail">M2M100 · 경로별 약 650~750MB · 자동 폴백 시 최대 약 1.4GB 전송 · Chrome 캐시에 보관</p>
  </details>

  <footer>
    <span>선택한 텍스트는 우클릭 또는 <kbd>⌥</kbd><kbd>⇧</kbd><kbd>K</kbd>로 바로 번역</span>
    <a href="/privacy.html" target="_blank" rel="noreferrer">개인정보처리방침</a>
  </footer>
  </div>
`;

const elements = {
  privacyOnboarding: getElement<HTMLElement>("privacy-onboarding"),
  privacyConsentCheck: getElement<HTMLInputElement>("privacy-consent-check"),
  privacyConsentButton: getElement<HTMLButtonElement>("privacy-consent-button"),
  privacyConsentError: getElement<HTMLElement>("privacy-consent-error"),
  productUi: getElement<HTMLElement>("product-ui"),
  source: getElement<HTMLTextAreaElement>("source-text"),
  sourceLanguage: getElement<HTMLSelectElement>("source-language"),
  characterCount: getElement<HTMLElement>("character-count"),
  translate: getElement<HTMLButtonElement>("translate-button"),
  resultCard: getElement<HTMLElement>("result-card"),
  resultText: getElement<HTMLElement>("result-text"),
  resultMeta: getElement<HTMLElement>("result-meta"),
  copy: getElement<HTMLButtonElement>("copy-button"),
  speak: getElement<HTMLButtonElement>("speak-button"),
  engineTitle: getElement<HTMLElement>("engine-title"),
  engineDetail: getElement<HTMLElement>("engine-detail"),
  engineState: getElement<HTMLElement>("engine-state"),
  progressTrack: getElement<HTMLElement>("progress-track"),
  progressBar: getElement<HTMLElement>("progress-bar"),
  ttsTitle: getElement<HTMLElement>("tts-title"),
  ttsDetail: getElement<HTMLElement>("tts-detail"),
  ttsState: getElement<HTMLElement>("tts-state"),
  ttsStop: getElement<HTMLButtonElement>("tts-stop-button"),
  youtubeEnabled: getElement<HTMLInputElement>("youtube-enabled"),
  autoCaptions: getElement<HTMLInputElement>("auto-captions"),
  showOriginal: getElement<HTMLInputElement>("show-original"),
  subtitleSize: getElement<HTMLInputElement>("subtitle-size"),
  subtitleSizeValue: getElement<HTMLElement>("subtitle-size-value"),
  modelPreference: getElement<HTMLSelectElement>("model-preference"),
  devicePreference: getElement<HTMLSelectElement>("device-preference"),
  modelSettingDetail: getElement<HTMLElement>("model-setting-detail"),
  pageStatus: getElement<HTMLElement>("page-status"),
  pageTranslate: getElement<HTMLButtonElement>("page-translate-button"),
  pageRestore: getElement<HTMLButtonElement>("page-restore-button"),
  extensionReload: getElement<HTMLButtonElement>("extension-reload-button")
};
let currentTranslation = "";
let currentTtsStatus: TtsStatus = { state: "idle", modelId: TTS_MODEL_ID };
let currentSpeechId: string | null = null;

for (const language of LANGUAGE_OPTIONS) {
  const option = document.createElement("option");
  option.value = language.code;
  option.textContent = language.label;
  elements.sourceLanguage.append(option);
}

elements.privacyConsentCheck.addEventListener("change", () => {
  elements.privacyConsentButton.disabled = !elements.privacyConsentCheck.checked;
});
elements.privacyConsentButton.addEventListener("click", () => {
  void acceptPrivacyDisclosure();
});

void initialize();

async function initialize(): Promise<void> {
  if (!isExtensionRuntime) {
    const previewSettings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION
    };
    applySettings(previewSettings);
    updatePrivacyGate(previewSettings);
    updateEngineStatus({ state: "idle", modelId: MODEL_ID });
    return;
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS) as ExtensionSettings;
  applySettings(settings);
  updatePrivacyGate(settings);
  if (!hasPrivacyConsent(settings)) {
    updateEngineStatus({ state: "idle", modelId: MODEL_ID });
    updateTtsStatus({ state: "idle", modelId: TTS_MODEL_ID });
    updatePageStatus(idlePageStatus());
    return;
  }

  await loadRuntimeState();
}

async function loadRuntimeState(): Promise<void> {
  const [selection, status, pageStatus, ttsStatus] = await Promise.all([
    chrome.runtime.sendMessage({
      target: "background",
      type: "GET_ACTIVE_SELECTION"
    }).catch(() => ({ text: "" })),
    chrome.runtime.sendMessage({
      target: "background",
      type: "GET_ENGINE_STATUS"
    }).catch(() => ({ state: "idle", modelId: MODEL_ID })),
    chrome.runtime.sendMessage({
      target: "background",
      type: "GET_PAGE_TRANSLATION_STATUS"
    }).catch(() => null),
    chrome.runtime.sendMessage({
      target: "background",
      type: "GET_TTS_STATUS"
    }).catch(() => ({ state: "idle", modelId: TTS_MODEL_ID }))
  ]);

  if (selection?.text) {
    elements.source.value = selection.text;
    updateCharacterCount();
  }
  updateEngineStatus(normalizeEngineStatus(status));
  const normalizedTtsStatus = normalizeTtsStatus(ttsStatus);
  currentSpeechId = isTtsActive(normalizedTtsStatus)
    ? normalizedTtsStatus.speechId ?? null
    : null;
  updateTtsStatus(
    currentSpeechId
      ? normalizedTtsStatus
      : { state: "idle", modelId: TTS_MODEL_ID }
  );
  updatePageStatus(normalizePageStatus(pageStatus, EXTENSION_RELOAD_MESSAGE));
}

async function acceptPrivacyDisclosure(): Promise<void> {
  if (!isExtensionRuntime || !elements.privacyConsentCheck.checked) return;
  elements.privacyConsentButton.disabled = true;
  elements.privacyConsentError.hidden = true;
  try {
    const current = await chrome.storage.sync.get(DEFAULT_SETTINGS) as ExtensionSettings;
    const accepted: ExtensionSettings = {
      ...current,
      privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION,
      youtubeEnabled: false,
      autoEnableCaptions: false
    };
    await chrome.storage.sync.set({
      privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION,
      youtubeEnabled: false,
      autoEnableCaptions: false
    });
    applySettings(accepted);
    updatePrivacyGate(accepted);
    await loadRuntimeState();
  } catch (error) {
    elements.privacyConsentError.textContent =
      `설정을 저장하지 못했습니다: ${formatUiError(error)}`;
    elements.privacyConsentError.hidden = false;
    elements.privacyConsentButton.disabled = false;
  }
}

function updatePrivacyGate(settings: ExtensionSettings): void {
  const accepted = hasPrivacyConsent(settings);
  elements.privacyOnboarding.hidden = accepted;
  elements.productUi.hidden = !accepted;
}

elements.source.addEventListener("input", updateCharacterCount);
elements.translate.addEventListener("click", () => void translate());
elements.source.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void translate();
});
elements.copy.addEventListener("click", () => void copyResult());
elements.speak.addEventListener("click", () => void toggleSpeech());
elements.ttsStop.addEventListener("click", () => void stopSpeech());
elements.pageTranslate.addEventListener("click", () => void handlePageTranslation());
elements.pageRestore.addEventListener("click", () => void restorePageTranslation());
elements.extensionReload.addEventListener("click", () => chrome.runtime.reload());

elements.youtubeEnabled.addEventListener("change", () => void saveSettingsSafely());
elements.autoCaptions.addEventListener("change", () => void saveSettingsSafely());
elements.showOriginal.addEventListener("change", () => void saveSettingsSafely());
elements.subtitleSize.addEventListener("input", () => {
  elements.subtitleSizeValue.textContent = `${elements.subtitleSize.value}px`;
  void saveSettingsSafely();
});
elements.sourceLanguage.addEventListener("change", () => void saveSettingsSafely());
elements.modelPreference.addEventListener("change", () => void resetEngineForSettings());
elements.devicePreference.addEventListener("change", () => void resetEngineForSettings());

if (isExtensionRuntime) {
  chrome.runtime.onMessage.addListener((
    message: UiProgressMessage | UiTtsProgressMessage
  ) => {
    if (message?.target === "ui" && message.type === "ENGINE_PROGRESS") {
      updateEngineStatus(message.status);
    } else if (message?.target === "ui" && message.type === "TTS_PROGRESS") {
      handleTtsProgress(message.status);
    }
  });
  window.setInterval(() => {
    if (elements.pageTranslate.dataset.state === "translating") {
      void refreshPageStatus();
    }
  }, 900);
}

async function handlePageTranslation(): Promise<void> {
  if (!isExtensionRuntime) {
    updatePageStatus({
      ...idlePageStatus(),
      state: "error",
      error: "확장 프로그램으로 설치한 뒤 사용할 수 있습니다."
    });
    return;
  }
  const type =
    elements.pageTranslate.dataset.state === "translating"
      ? "STOP_PAGE_TRANSLATION"
      : "START_PAGE_TRANSLATION";
  elements.pageTranslate.disabled = true;
  const status = await chrome.runtime.sendMessage({ target: "background", type })
    .catch(() => null);
  elements.pageTranslate.disabled = false;
  updatePageStatus(normalizePageStatus(status, EXTENSION_RELOAD_MESSAGE));
}

async function restorePageTranslation(): Promise<void> {
  if (!isExtensionRuntime) return;
  const status = await chrome.runtime.sendMessage({
    target: "background",
    type: "RESTORE_PAGE_TRANSLATION"
  }).catch(() => idlePageStatus());
  updatePageStatus(normalizePageStatus(status));
}

async function refreshPageStatus(): Promise<void> {
  const status = await chrome.runtime.sendMessage({
    target: "background",
    type: "GET_PAGE_TRANSLATION_STATUS"
  }).catch(() => null);
  if (status) updatePageStatus(status as PageTranslationStatus);
}

async function translate(): Promise<void> {
  const text = elements.source.value.trim();
  if (!text) {
    elements.source.focus();
    elements.source.classList.add("shake");
    window.setTimeout(() => elements.source.classList.remove("shake"), 400);
    return;
  }

  setBusy(true);
  currentTranslation = "";
  elements.speak.disabled = true;
  elements.resultCard.hidden = false;
  elements.resultText.className = "result-text loading-lines";
  elements.resultText.textContent = "브라우저에서 번역하고 있어요…";
  elements.resultMeta.textContent = "";

  try {
    await stopSpeech();
    if (!isExtensionRuntime) {
      throw new Error("번역은 Chrome에 확장 프로그램을 로드한 뒤 사용할 수 있습니다.");
    }

    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "TRANSLATE",
      requestId: createRequestId(),
      text,
      sourceLanguage: elements.sourceLanguage.value,
      origin: "popup"
    }) as TranslationResponse;

    elements.resultText.className = response.ok ? "result-text" : "result-text error";
    if (response.ok) {
      currentTranslation = response.translation;
      elements.speak.disabled = false;
      elements.resultText.textContent = response.translation;
      const device = response.device === "webgpu"
        ? "WebGPU"
        : response.device === "wasm"
          ? "WASM"
          : "번역 생략";
      elements.resultMeta.textContent =
        `${device} · ${(response.elapsedMs / 1000).toFixed(1)}초`;
    } else {
      elements.resultText.textContent = response.error;
      elements.resultMeta.textContent =
        response.code === "CONSENT_REQUIRED"
          ? "데이터 처리 안내를 확인해 주세요."
          : "엔진 설정이나 인터넷 연결을 확인해 주세요.";
    }
  } catch (error) {
    elements.resultText.className = "result-text error";
    elements.resultText.textContent = formatUiError(error);
    elements.resultMeta.textContent = "확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.";
  } finally {
    setBusy(false);
  }
}

async function toggleSpeech(): Promise<void> {
  if (isTtsActive(currentTtsStatus)) {
    await stopSpeech();
    return;
  }
  if (!currentTranslation || !isExtensionRuntime) return;

  const speechId = createRequestId();
  currentSpeechId = speechId;
  updateTtsStatus({
    state: "loading",
    modelId: TTS_MODEL_ID,
    speechId,
    progress: 0,
    file: "한국어 음성 모델 준비 중"
  });
  const response = await chrome.runtime.sendMessage({
    target: "background",
    type: "SPEAK_KOREAN",
    speechId,
    text: currentTranslation
  }).catch((error) => ({
    ok: false,
    speechId,
    error: error instanceof Error ? error.message : String(error)
  })) as SpeakResponse;
  if (currentSpeechId !== speechId) return;
  if (!response?.ok || response.speechId !== speechId) {
    updateTtsStatus({
      state: "error",
      modelId: TTS_MODEL_ID,
      speechId,
      error: response?.error ?? "한국어 음성을 시작하지 못했습니다."
    });
    currentSpeechId = null;
  }
}

async function stopSpeech(): Promise<void> {
  const speechId = currentSpeechId ?? currentTtsStatus.speechId ?? null;
  if (
    !isExtensionRuntime ||
    !speechId ||
    !isTtsActive(currentTtsStatus)
  ) {
    return;
  }
  const response = await chrome.runtime.sendMessage({
    target: "background",
    type: "STOP_SPEAKING",
    speechId
  }).catch((error) => ({
    ok: false,
    speechId,
    error: error instanceof Error ? error.message : String(error)
  })) as SpeakResponse;
  if (currentSpeechId !== speechId) return;
  if (response?.ok && response.speechId === speechId) {
    updateTtsStatus({
      state: "idle",
      modelId: TTS_MODEL_ID,
      speechId
    });
  } else {
    updateTtsStatus({
      state: "error",
      modelId: TTS_MODEL_ID,
      speechId,
      error: response?.error ?? "한국어 음성을 정지하지 못했습니다."
    });
  }
  currentSpeechId = null;
}

function handleTtsProgress(status: TtsStatus): void {
  if (!currentSpeechId) return;
  if (!isSpeechStatusFor(status, currentSpeechId)) {
    currentSpeechId = null;
    updateTtsStatus({ state: "idle", modelId: TTS_MODEL_ID });
    return;
  }
  updateTtsStatus(status);
  if (!isTtsActive(status)) currentSpeechId = null;
}

function updateTtsStatus(status: TtsStatus): void {
  currentTtsStatus = status;
  const active = isTtsActive(status);
  const stateLabel = {
    idle: "대기",
    loading: "준비 중",
    synthesizing: "생성 중",
    playing: "재생 중",
    error: "오류"
  }[status.state];
  elements.ttsState.textContent = stateLabel;
  elements.ttsState.className = `engine-state ${status.state}`;
  elements.ttsStop.hidden = !active;
  elements.speak.textContent = active ? "■ 정지" : "▶ 듣기";

  if (status.state === "loading") {
    const percent = status.progress && status.progress > 0
      ? ` ${Math.round(status.progress * 100)}%`
      : "";
    elements.ttsTitle.textContent = `한국어 음성 AI 준비 중${percent}`;
    elements.ttsDetail.textContent = status.file
      ? shortenFile(status.file)
      : "모델을 Chrome 캐시에 저장하고 있습니다.";
  } else if (status.state === "synthesizing") {
    elements.ttsTitle.textContent = "한국어 음성 생성 중";
    elements.ttsDetail.textContent = status.file ?? "번역 결과를 음성으로 바꾸고 있습니다.";
  } else if (status.state === "playing") {
    elements.ttsTitle.textContent = "한국어 번역을 읽고 있어요";
    elements.ttsDetail.textContent = status.file ?? "브라우저 안에서 생성한 음성을 재생 중입니다.";
  } else if (status.state === "error") {
    elements.ttsTitle.textContent = "음성을 만들지 못했어요";
    elements.ttsDetail.textContent = status.error ?? "다시 듣기를 눌러 주세요.";
  } else {
    elements.ttsTitle.textContent = "한국어 음성 AI 대기 중";
    elements.ttsDetail.textContent = "첫 듣기 때 약 40MB 모델을 내려받습니다.";
  }
}

function isTtsActive(status: TtsStatus): boolean {
  return status.state === "loading" ||
    status.state === "synthesizing" ||
    status.state === "playing";
}

function normalizeTtsStatus(value: unknown): TtsStatus {
  if (
    value &&
    typeof value === "object" &&
    "state" in value &&
    typeof value.state === "string"
  ) {
    return value as TtsStatus;
  }
  return { state: "idle", modelId: TTS_MODEL_ID };
}

function normalizeEngineStatus(value: unknown): EngineStatus {
  if (
    value &&
    typeof value === "object" &&
    "state" in value &&
    typeof value.state === "string"
  ) {
    return value as EngineStatus;
  }
  return { state: "idle", modelId: MODEL_ID };
}

async function copyResult(): Promise<void> {
  const text = elements.resultText.textContent ?? "";
  if (!text) return;
  await navigator.clipboard.writeText(text);
  elements.copy.textContent = "복사됨";
  window.setTimeout(() => {
    elements.copy.textContent = "복사";
  }, 1200);
}

function updateCharacterCount(): void {
  elements.characterCount.textContent = `${elements.source.value.length.toLocaleString()} / 5,000`;
}

function setBusy(busy: boolean): void {
  elements.translate.disabled = busy;
  elements.translate.querySelector("span")!.textContent = busy ? "번역 중…" : "한국어로 번역";
}

function applySettings(settings: ExtensionSettings): void {
  elements.youtubeEnabled.checked = settings.youtubeEnabled;
  elements.autoCaptions.checked = settings.autoEnableCaptions;
  elements.showOriginal.checked = settings.showOriginalCaptions;
  elements.subtitleSize.value = String(settings.subtitleSize);
  elements.subtitleSizeValue.textContent = `${settings.subtitleSize}px`;
  elements.sourceLanguage.value = settings.sourceLanguage;
  elements.modelPreference.value = settings.modelPreference;
  elements.devicePreference.value = settings.devicePreference;
  updateModelSettingDetail();
}

async function saveSettings(): Promise<void> {
  const settings: ExtensionSettings = {
    privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION,
    youtubeEnabled: elements.youtubeEnabled.checked,
    autoEnableCaptions: elements.autoCaptions.checked,
    showOriginalCaptions: elements.showOriginal.checked,
    subtitleSize: Number(elements.subtitleSize.value),
    sourceLanguage: elements.sourceLanguage.value,
    modelPreference: elements.modelPreference.value as ModelPreference,
    devicePreference: elements.devicePreference.value as DevicePreference
  };
  if (isExtensionRuntime) await chrome.storage.sync.set(settings);
}

async function saveSettingsSafely(): Promise<void> {
  try {
    await saveSettings();
  } catch (error) {
    updateEngineStatus({
      state: "error",
      modelId: MODEL_DEFINITIONS[
        elements.modelPreference.value as ModelPreference
      ].id,
      error: `설정을 저장하지 못했습니다: ${formatUiError(error)}`
    });
  }
}

async function resetEngineForSettings(): Promise<void> {
  updateModelSettingDetail();
  try {
    await saveSettings();
    if (isExtensionRuntime) {
      const status = await chrome.runtime.sendMessage({
        target: "background",
        type: "RESET_ENGINE"
      });
      if (status?.state === "error") {
        throw new Error(status.error ?? "번역 엔진을 초기화하지 못했습니다.");
      }
    }
    updateEngineStatus({
      state: "idle",
      modelId: MODEL_DEFINITIONS[
        elements.modelPreference.value as ModelPreference
      ].id
    });
  } catch (error) {
    updateEngineStatus({
      state: "error",
      modelId: MODEL_DEFINITIONS[
        elements.modelPreference.value as ModelPreference
      ].id,
      error: formatUiError(error)
    });
  }
}

function updateModelSettingDetail(): void {
  const preference = elements.modelPreference.value as ModelPreference;
  const definition = MODEL_DEFINITIONS[preference];
  const usesSmall100 = preference === "small100";
  elements.devicePreference.disabled = usesSmall100;
  const automaticFallbackNote =
    preference === "m2m100"
      ? " · 자동 폴백 시 최대 약 1.4GB 전송"
      : "";
  elements.modelSettingDetail.textContent =
    `${definition.label} · ${definition.downloadSize}${automaticFallbackNote} · ` +
    `${definition.deviceNote} · Chrome 캐시에 보관`;
}

function updateEngineStatus(status: EngineStatus): void {
  const stateLabel = {
    idle: "대기",
    loading: "준비 중",
    ready: "준비됨",
    error: "오류"
  }[status.state];
  elements.engineState.textContent = stateLabel;
  elements.engineState.className = `engine-state ${status.state}`;
  elements.progressTrack.hidden = status.state !== "loading";
  const progress = status.progress ?? 0;
  const isIndeterminate = status.state === "loading" && progress <= 0;
  elements.progressBar.classList.toggle("indeterminate", isIndeterminate);
  elements.progressBar.style.width =
    isIndeterminate ? "35%" : `${Math.round(progress * 100)}%`;
  const modelLabel = modelLabelFromId(status.modelId);

  if (status.state === "loading") {
    elements.engineTitle.textContent =
      progress > 0
        ? `${modelLabel} 준비 중 ${Math.round(progress * 100)}%`
        : `${modelLabel} 준비 중`;
    elements.engineDetail.textContent = status.file
      ? shortenFile(status.file)
      : "첫 실행에만 모델 파일을 내려받습니다.";
  } else if (status.state === "ready") {
    elements.engineTitle.textContent = `${modelLabel} 준비 완료`;
    const runtime =
      `${status.device === "webgpu" ? "WebGPU" : "WASM"}로 브라우저 안에서 실행 중`;
    elements.engineDetail.textContent = status.fallbackFromDevice === "webgpu"
      ? `WebGPU 오류로 WASM 폴백 · ${runtime}`
      : status.fallbackFromModelId
        ? `SMaLL-100 로드 실패로 M2M100 폴백 · ${runtime}`
        : runtime;
  } else if (status.state === "error") {
    elements.engineTitle.textContent = "모델을 준비하지 못했어요";
    elements.engineDetail.textContent = status.error ?? "다시 번역을 시도해 주세요.";
  } else {
    elements.engineTitle.textContent = "로컬 모델 대기 중";
    const selected =
      MODEL_DEFINITIONS[elements.modelPreference.value as ModelPreference];
    elements.engineDetail.textContent =
      elements.modelPreference.value === "m2m100"
        ? `${selected.downloadSize} · 자동 폴백 시 최대 약 1.4GB`
        : `첫 번역 때 ${selected.downloadSize} 모델을 한 번 내려받습니다.`;
  }
}

function modelLabelFromId(modelId: string): string {
  if (modelId === SMALL100_MODEL_ID) return MODEL_DEFINITIONS.small100.label;
  if (modelId === M2M100_MODEL_ID) return MODEL_DEFINITIONS.m2m100.label;
  return "로컬 모델";
}

function updatePageStatus(status: PageTranslationStatus): void {
  elements.pageTranslate.dataset.state = status.state;
  elements.pageRestore.hidden = status.state === "idle";
  elements.extensionReload.hidden = status.error !== EXTENSION_RELOAD_MESSAGE;
  elements.pageTranslate.textContent =
    status.state === "translating"
      ? "번역 중지"
      : status.state === "idle"
        ? "페이지 안에 한국어 표시"
        : "다시 번역";

  if (status.state === "translating") {
    elements.pageStatus.textContent =
      `${status.completed + status.failed} / ${status.total}개 문장을 번역하고 있어요.`;
  } else if (status.state === "complete" && status.total === 0) {
    elements.pageStatus.textContent = "번역할 외국어 본문을 찾지 못했습니다.";
  } else if (status.state === "complete") {
    elements.pageStatus.textContent =
      `${status.completed}개 문장을 원문 아래에 표시했습니다.`;
  } else if (status.state === "stopped") {
    elements.pageStatus.textContent =
      `${status.completed}개 문장까지 표시하고 중지했습니다.`;
  } else if (status.state === "error") {
    elements.pageStatus.textContent = status.error ?? "페이지 번역에 실패했습니다.";
  } else {
    elements.pageStatus.textContent = "본문 원문 아래에 한국어를 순서대로 표시합니다.";
  }
}

function idlePageStatus(): PageTranslationStatus {
  return {
    state: "idle",
    total: 0,
    completed: 0,
    failed: 0
  };
}

function normalizePageStatus(
  value: unknown,
  error?: string
): PageTranslationStatus {
  if (
    value &&
    typeof value === "object" &&
    "state" in value &&
    typeof value.state === "string"
  ) {
    return value as PageTranslationStatus;
  }
  return error
    ? { ...idlePageStatus(), state: "error", error }
    : idlePageStatus();
}

function shortenFile(file: string): string {
  const name = file.split("/").at(-1) ?? file;
  return name.length > 38 ? `${name.slice(0, 35)}…` : name;
}

function formatUiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/receiving end does not exist|message port closed|extension context invalidated/i.test(message)) {
    return EXTENSION_RELOAD_MESSAGE;
  }
  return message || "알 수 없는 오류가 발생했습니다.";
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`${id} 요소를 찾을 수 없습니다.`);
  return element as T;
}
