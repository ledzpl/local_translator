import "./styles.css";
import {
  DEFAULT_SETTINGS,
  MODEL_ID,
  TTS_MODEL_ID,
  createRequestId,
  type DevicePreference,
  type EngineStatus,
  type ExtensionSettings,
  type GlossaryEntry,
  type ModelCacheStatus,
  type PageDisplayMode,
  type ModelPreference,
  type PageTranslationStatus,
  type SpeakResponse,
  type TtsStatus,
  type TranslationJobActionResponse,
  type TranslationResponse,
  type TranslationJobState,
  type UiTranslationJobMessage,
  type UiProgressMessage,
  type UiTtsProgressMessage
} from "../shared/protocol";
import { LANGUAGE_OPTIONS } from "../shared/languages";
import {
  M2M100_MODEL_ID,
  MODEL_DEFINITIONS,
  SMALL100_MODEL_ID,
  TRANSLATEGEMMA_MODEL_ID
} from "../shared/models";
import {
  CURRENT_PRIVACY_CONSENT_VERSION,
  hasPrivacyConsent
} from "../shared/privacy";
import {
  shouldApplyInitialSelection,
  shouldApplyRuntimeSnapshot,
  shouldApplyTranslationJobAction,
  shouldApplyTrackedTranslationResponse,
  shouldApplyUntrackedTranslationResponse,
  shouldLockModelControls
} from "../shared/popup-state";
import { RevisionedCommitter } from "../shared/revisioned-committer";
import { isSpeechStatusFor } from "../shared/tts";
import {
  GLOSSARY_STORAGE_KEY,
  MAX_GLOSSARY_ENTRIES,
  normalizeGlossaryEntries
} from "../shared/glossary";

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
      <li>기본 TranslateGemma 4B는 약 3.1GB이며 WebGPU가 필요합니다. 미지원·실패 시 M2M100 WASM 약 650MB를 추가로 받을 수 있습니다.</li>
      <li>TranslateGemma 사용에는 <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer">Gemma 이용약관</a>과 금지 용도 정책이 적용됩니다.</li>
      <li>한국어 음성에는 <a href="/LICENSES/supertonic-model-OpenRAIL-M.txt" target="_blank" rel="noreferrer">Supertonic 3 OpenRAIL-M</a> 사용 제한이 적용됩니다.</li>
      <li>수동 번역 입력과 결과는 작업 복구를 위해 브라우저 세션 동안만 저장되며, 용어집은 사용자가 지울 때까지 이 기기의 확장 저장소에 보관됩니다. 페이지 본문·선택 텍스트·자막은 저장하지 않습니다.</li>
      <li>모델·언어·자막 설정과 이 확인 기록은 Chrome 동기화를 켠 경우 Google의 Chrome 동기화 인프라에서 처리될 수 있습니다.</li>
    </ul>
    <a href="/privacy.html" target="_blank" rel="noreferrer">개인정보처리방침 전체 보기</a>
    <label class="consent-check">
      <input id="privacy-consent-check" type="checkbox" />
      <span>위 데이터 처리 방식과 모델 다운로드를 확인하고, Gemma 및 Supertonic 모델 이용 조건에 동의합니다.</span>
    </label>
    <button id="privacy-consent-button" class="primary-button" type="button" disabled>
      <span>동의하고 시작</span><span aria-hidden="true">→</span>
    </button>
    <p id="privacy-consent-error" class="consent-error" role="alert" hidden></p>
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
    <p id="page-status" role="status" aria-live="polite">본문 원문 아래에 한국어를 순서대로 표시합니다.</p>
    <div class="page-actions">
      <button id="page-translate-button" type="button">페이지 안에 한국어 표시</button>
      <button id="page-restore-button" type="button" hidden>번역 지우기</button>
      <button id="extension-reload-button" type="button" hidden>확장 새로고침</button>
    </div>
    <div class="page-options">
      <label>
        <input id="page-continuous" type="checkbox" />
        <span>스크롤할 때 다음 문단 계속 번역</span>
      </label>
      <label>
        <span>표시</span>
        <select id="page-display-mode">
          <option value="bilingual">원문 + 한국어</option>
          <option value="translation">한국어만</option>
          <option value="hover">한국어 중심 · 올리면 원문</option>
        </select>
      </label>
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
        <button id="copy-button" type="button" disabled>복사</button>
        <button id="translation-cancel-button" type="button" hidden>취소</button>
        <button id="translation-clear-button" type="button" hidden>기록 지우기</button>
      </div>
    </div>
    <div id="result-text" class="result-text" role="status" aria-live="polite"></div>
    <div id="result-meta" class="result-meta"></div>
  </section>

  <section class="model-center">
    <div class="section-title">
      <div>
        <span class="kicker">MODEL CENTER</span>
        <h2>로컬 모델 관리</h2>
      </div>
      <span id="device-readiness" class="model-readiness">확인 중</span>
    </div>
    <p id="storage-status">브라우저 저장 공간과 캐시를 확인하고 있습니다.</p>
    <div class="model-actions">
      <button id="prepare-model-button" type="button">선택 모델 미리 준비</button>
      <button id="clear-model-button" type="button">선택 모델 삭제</button>
      <button id="clear-tts-button" type="button">음성 모델 삭제</button>
    </div>
    <p id="model-center-status" role="status" aria-live="polite"></p>
  </section>

  <section class="engine-card">
    <div class="engine-row">
      <div class="engine-icon">AI</div>
      <div class="engine-copy" role="status" aria-live="polite">
        <strong id="engine-title">로컬 모델 대기 중</strong>
        <span id="engine-detail">TranslateGemma 4B 약 3.1GB · WebGPU 우선</span>
      </div>
      <span id="engine-state" class="engine-state idle">대기</span>
    </div>
    <div
      id="progress-track"
      class="progress-track"
      role="progressbar"
      aria-label="모델 준비 진행률"
      aria-valuemin="0"
      aria-valuemax="100"
      hidden
    >
      <div id="progress-bar" class="progress-bar"></div>
    </div>
    <div class="engine-row speech-row">
      <div class="engine-icon">VO</div>
      <div class="engine-copy" role="status" aria-live="polite">
        <strong id="tts-title">한국어 음성 AI 대기 중</strong>
        <span id="tts-detail">첫 듣기 때 약 400MB 모델을 내려받습니다.</span>
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
        <input id="youtube-enabled" type="checkbox" aria-label="YouTube 자막 번역" />
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
    <label class="setting-row">
      <div><strong>자막 번역 방식</strong><span>이전 자막을 참고하거나 현재 자막을 빠르게 번역</span></div>
      <select id="youtube-translation-mode">
        <option value="speed">속도 우선</option>
        <option value="context">문맥 우선</option>
      </select>
    </label>
  </section>

  <details class="advanced">
    <summary>엔진 설정</summary>
    <label>
      번역 모델
      <select id="model-preference">
        <option value="translategemma">TranslateGemma 4B — 최고 품질</option>
        <option value="m2m100">M2M100 — 경량 호환 모델</option>
        <option value="small100">SMaLL-100 — 실험적 WASM 호환</option>
      </select>
    </label>
    <label>
      실행 장치
      <select id="device-preference">
        <option value="webgpu">WebGPU — 권장 기본, 실패 시 WASM</option>
        <option value="auto">자동 — WebGPU 사용 가능 여부 감지</option>
        <option value="wasm">WASM — 호환성 우선</option>
      </select>
    </label>
    <p id="model-setting-detail">TranslateGemma 4B · 약 3.1GB · WebGPU 전용 · 미지원 시 M2M100 WASM 폴백 · Chrome 캐시에 보관</p>
  </details>

  <details class="glossary">
    <summary>내 기기 용어집</summary>
    <p>제품명과 전문용어를 이 기기 안에서만 고정합니다.</p>
    <div class="glossary-form">
      <input id="glossary-source" type="text" maxlength="120" placeholder="원문 용어" />
      <input id="glossary-target" type="text" maxlength="120" placeholder="한국어 표기" />
      <label><input id="glossary-preserve" type="checkbox" /> 원문 그대로 유지</label>
      <button id="glossary-add" type="button">용어 추가</button>
    </div>
    <div id="glossary-list" class="glossary-list"></div>
    <p id="glossary-status" role="status" aria-live="polite"></p>
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
  translationCancel: getElement<HTMLButtonElement>("translation-cancel-button"),
  translationClear: getElement<HTMLButtonElement>("translation-clear-button"),
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
  youtubeTranslationMode: getElement<HTMLSelectElement>("youtube-translation-mode"),
  pageContinuous: getElement<HTMLInputElement>("page-continuous"),
  pageDisplayMode: getElement<HTMLSelectElement>("page-display-mode"),
  modelPreference: getElement<HTMLSelectElement>("model-preference"),
  devicePreference: getElement<HTMLSelectElement>("device-preference"),
  modelSettingDetail: getElement<HTMLElement>("model-setting-detail"),
  pageStatus: getElement<HTMLElement>("page-status"),
  pageTranslate: getElement<HTMLButtonElement>("page-translate-button"),
  pageRestore: getElement<HTMLButtonElement>("page-restore-button"),
  extensionReload: getElement<HTMLButtonElement>("extension-reload-button"),
  deviceReadiness: getElement<HTMLElement>("device-readiness"),
  storageStatus: getElement<HTMLElement>("storage-status"),
  prepareModel: getElement<HTMLButtonElement>("prepare-model-button"),
  clearModel: getElement<HTMLButtonElement>("clear-model-button"),
  clearTts: getElement<HTMLButtonElement>("clear-tts-button"),
  modelCenterStatus: getElement<HTMLElement>("model-center-status"),
  glossarySource: getElement<HTMLInputElement>("glossary-source"),
  glossaryTarget: getElement<HTMLInputElement>("glossary-target"),
  glossaryPreserve: getElement<HTMLInputElement>("glossary-preserve"),
  glossaryAdd: getElement<HTMLButtonElement>("glossary-add"),
  glossaryList: getElement<HTMLElement>("glossary-list"),
  glossaryStatus: getElement<HTMLElement>("glossary-status")
};
let currentTranslation = "";
let currentTranslationJob: TranslationJobState | null = null;
let glossaryEntries: GlossaryEntry[] = [];
let modelPreparationInFlight = false;
let modelCacheActionInFlight = false;
let modelSettingsUpdateInFlight = false;
let persistedModelPreference: ModelPreference = DEFAULT_SETTINGS.modelPreference;
let persistedDevicePreference: DevicePreference = DEFAULT_SETTINGS.devicePreference;
let currentEngineStatus: EngineStatus = { state: "idle", modelId: MODEL_ID };
let currentTtsStatus: TtsStatus = { state: "idle", modelId: TTS_MODEL_ID };
let currentSpeechId: string | null = null;
let translationInFlight = false;
let sourceEditRevision = 0;
let engineStatusRevision = 0;
let ttsStatusRevision = 0;
let translationJobRevision = 0;
let pageStatusRevision = 0;
let privacyConsentAccepted = false;
let settingsRevision = 0;
const subtitleSizeCommitter = new RevisionedCommitter(saveSubtitleSizeSafely);

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

async function initialize(): Promise<void> {
  if (!isExtensionRuntime) {
    const previewSettings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION
    };
    applySettings(previewSettings);
    updatePrivacyGate(previewSettings);
    updateEngineStatus({ state: "idle", modelId: MODEL_ID });
    updateDeviceAndStorageStatus(null);
    renderGlossary();
    return;
  }

  const settings = await readStableSettings();
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
  const sourceRevisionAtRequest = sourceEditRevision;
  const engineRevisionAtRequest = engineStatusRevision;
  const ttsRevisionAtRequest = ttsStatusRevision;
  const jobRevisionAtRequest = translationJobRevision;
  const pageRevisionAtRequest = pageStatusRevision;
  const [selection, status, pageStatus, ttsStatus, job] = await Promise.all([
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
    }).catch(() => ({ state: "idle", modelId: TTS_MODEL_ID })),
    chrome.runtime.sendMessage({
      target: "background",
      type: "GET_TRANSLATION_JOB"
    }).catch(() => null)
  ]);

  const initialSelectionText = selection?.text ?? "";
  if (shouldApplyInitialSelection({
    requestRevision: sourceRevisionAtRequest,
    currentRevision: sourceEditRevision,
    currentValue: elements.source.value,
    selectionText: initialSelectionText
  })) {
    elements.source.value = initialSelectionText;
    updateCharacterCount();
  }
  if (shouldApplyRuntimeSnapshot(engineRevisionAtRequest, engineStatusRevision)) {
    updateEngineStatus(normalizeEngineStatus(status));
  }
  if (shouldApplyRuntimeSnapshot(ttsRevisionAtRequest, ttsStatusRevision)) {
    const normalizedTtsStatus = normalizeTtsStatus(ttsStatus);
    currentSpeechId = isTtsActive(normalizedTtsStatus)
      ? normalizedTtsStatus.speechId ?? null
      : null;
    updateTtsStatus(
      currentSpeechId
        ? normalizedTtsStatus
        : { state: "idle", modelId: TTS_MODEL_ID }
    );
  }
  if (shouldApplyRuntimeSnapshot(pageRevisionAtRequest, pageStatusRevision)) {
    updatePageStatus(normalizePageStatus(pageStatus, EXTENSION_RELOAD_MESSAGE));
  }
  if (shouldApplyRuntimeSnapshot(jobRevisionAtRequest, translationJobRevision)) {
    applyTranslationJob(job as TranslationJobState | null);
  }
  await Promise.all([loadGlossary(), refreshDeviceAndStorageStatus()]);
}

async function acceptPrivacyDisclosure(): Promise<void> {
  if (!isExtensionRuntime || !elements.privacyConsentCheck.checked) return;
  elements.privacyConsentButton.disabled = true;
  elements.privacyConsentError.hidden = true;
  try {
    await chrome.storage.sync.set({
      privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION,
      youtubeEnabled: false,
      autoEnableCaptions: false
    });
    const accepted = await readStableSettings();
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
  privacyConsentAccepted = accepted;
  elements.privacyOnboarding.hidden = accepted;
  elements.productUi.hidden = !accepted;
}

elements.source.addEventListener("input", () => {
  sourceEditRevision += 1;
  updateCharacterCount();
});
elements.translate.addEventListener("click", () => void translate());
elements.source.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void translate();
});
elements.copy.addEventListener("click", () => void copyResult());
elements.translationCancel.addEventListener("click", () => void cancelTranslationJob());
elements.translationClear.addEventListener("click", () => void clearTranslationJob());
elements.speak.addEventListener("click", () => void toggleSpeech());
elements.ttsStop.addEventListener("click", () => void stopSpeech());
elements.pageTranslate.addEventListener("click", () => void handlePageTranslation());
elements.pageRestore.addEventListener("click", () => void restorePageTranslation());
elements.extensionReload.addEventListener("click", () => chrome.runtime.reload());

elements.youtubeEnabled.addEventListener("change", () => void saveSettingSafely(
  "youtubeEnabled",
  elements.youtubeEnabled.checked
));
elements.autoCaptions.addEventListener("change", () => void saveSettingSafely(
  "autoEnableCaptions",
  elements.autoCaptions.checked
));
elements.showOriginal.addEventListener("change", () => void saveSettingSafely(
  "showOriginalCaptions",
  elements.showOriginal.checked
));
elements.youtubeTranslationMode.addEventListener("change", () => void saveSettingSafely(
  "youtubeTranslationMode",
  elements.youtubeTranslationMode.value as ExtensionSettings["youtubeTranslationMode"]
));
elements.pageContinuous.addEventListener("change", () => void saveSettingSafely(
  "pageContinuous",
  elements.pageContinuous.checked
));
elements.pageDisplayMode.addEventListener("change", () => void changePageDisplayMode());
elements.subtitleSize.addEventListener("input", () => {
  elements.subtitleSizeValue.textContent = `${elements.subtitleSize.value}px`;
  subtitleSizeCommitter.markDirty();
});
elements.subtitleSize.addEventListener("change", commitSubtitleSize);
window.addEventListener("pagehide", flushSubtitleSizeOnPageHide);
elements.sourceLanguage.addEventListener("change", () => void saveSettingSafely(
  "sourceLanguage",
  elements.sourceLanguage.value
));
elements.modelPreference.addEventListener("change", () => void resetEngineForSettings(
  "modelPreference",
  elements.modelPreference.value as ModelPreference
));
elements.devicePreference.addEventListener("change", () => void resetEngineForSettings(
  "devicePreference",
  elements.devicePreference.value as DevicePreference
));
elements.prepareModel.addEventListener("click", () => void prepareSelectedModel());
elements.clearModel.addEventListener("click", () => void clearSelectedModel(false));
elements.clearTts.addEventListener("click", () => void clearSelectedModel(true));
elements.glossaryPreserve.addEventListener("change", updateGlossaryTargetState);
elements.glossaryAdd.addEventListener("click", () => {
  void addGlossaryEntry().catch(reportGlossaryError);
});

if (isExtensionRuntime) {
  chrome.runtime.onMessage.addListener((
    message: UiProgressMessage | UiTtsProgressMessage | UiTranslationJobMessage
  ) => {
    if (message?.target === "ui" && message.type === "ENGINE_PROGRESS") {
      engineStatusRevision += 1;
      updateEngineStatus(message.status);
    } else if (message?.target === "ui" && message.type === "TTS_PROGRESS") {
      ttsStatusRevision += 1;
      handleTtsProgress(message.status);
    } else if (message?.target === "ui" && message.type === "TRANSLATION_JOB_UPDATED") {
      translationJobRevision += 1;
      applyTranslationJob(message.job);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    settingsRevision += 1;
    if (changes.privacyConsentVersion) {
      void synchronizeExternalPrivacyConsent();
      return;
    }
    applyExternalSettingChanges(changes);
  });
  window.setInterval(() => {
    if (elements.pageTranslate.dataset.active === "true") {
      void refreshPageStatus();
    }
  }, 900);
}

void initialize();

async function synchronizeExternalPrivacyConsent(): Promise<void> {
  const settings = await readStableSettings();
  const wasAccepted = privacyConsentAccepted;
  applySettings(settings);
  updatePrivacyGate(settings);
  if (!wasAccepted && privacyConsentAccepted) await loadRuntimeState();
}

async function readStableSettings(): Promise<ExtensionSettings> {
  while (true) {
    const revisionAtRequest = settingsRevision;
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS) as ExtensionSettings;
    if (shouldApplyRuntimeSnapshot(revisionAtRequest, settingsRevision)) {
      return settings;
    }
  }
}

async function handlePageTranslation(): Promise<void> {
  const actionRevision = ++pageStatusRevision;
  if (!isExtensionRuntime) {
    updatePageStatus({
      ...idlePageStatus(),
      state: "error",
      error: "확장 프로그램으로 설치한 뒤 사용할 수 있습니다."
    });
    return;
  }
  const type =
    elements.pageTranslate.dataset.active === "true"
      ? "STOP_PAGE_TRANSLATION"
      : "START_PAGE_TRANSLATION";
  elements.pageTranslate.disabled = true;
  const status = await chrome.runtime.sendMessage({
    target: "background",
    type,
    ...(type === "START_PAGE_TRANSLATION"
      ? {
          continuous: elements.pageContinuous.checked,
          displayMode: elements.pageDisplayMode.value as PageDisplayMode
        }
      : {})
  })
    .catch(() => null);
  elements.pageTranslate.disabled = false;
  if (shouldApplyRuntimeSnapshot(actionRevision, pageStatusRevision)) {
    updatePageStatus(normalizePageStatus(status, EXTENSION_RELOAD_MESSAGE));
  }
}

async function restorePageTranslation(): Promise<void> {
  if (!isExtensionRuntime) return;
  const actionRevision = ++pageStatusRevision;
  const status = await chrome.runtime.sendMessage({
    target: "background",
    type: "RESTORE_PAGE_TRANSLATION"
  }).catch(() => idlePageStatus());
  if (shouldApplyRuntimeSnapshot(actionRevision, pageStatusRevision)) {
    updatePageStatus(normalizePageStatus(status));
  }
}

async function refreshPageStatus(): Promise<void> {
  const requestRevision = ++pageStatusRevision;
  const status = await chrome.runtime.sendMessage({
    target: "background",
    type: "GET_PAGE_TRANSLATION_STATUS"
  }).catch(() => null);
  if (
    status &&
    shouldApplyRuntimeSnapshot(requestRevision, pageStatusRevision)
  ) {
    updatePageStatus(status as PageTranslationStatus);
  }
}

async function translate(): Promise<void> {
  if (translationInFlight) return;
  const text = elements.source.value.trim();
  if (!text) {
    elements.source.focus();
    elements.source.classList.add("shake");
    window.setTimeout(() => elements.source.classList.remove("shake"), 400);
    return;
  }

  const requestId = createRequestId();
  const jobRequestIdAtStart = currentTranslationJob?.requestId ?? null;
  // Invalidate an initial GET_TRANSLATION_JOB snapshot immediately. The
  // background's running-job broadcast can arrive slightly after this click.
  const jobRevisionAtRequest = ++translationJobRevision;
  translationInFlight = true;
  setBusy(true);
  currentTranslation = "";
  elements.speak.disabled = true;
  elements.copy.disabled = true;
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
      requestId,
      text,
      sourceLanguage: elements.sourceLanguage.value,
      origin: "popup"
    }) as TranslationResponse;

    const trackedJob = currentTranslationJob;
    if (shouldApplyTrackedTranslationResponse(requestId, trackedJob) && trackedJob) {
      applyTranslationJob({
        ...trackedJob,
        state: response.ok
          ? "complete"
          : response.code === "TRANSLATION_CANCELLED"
            ? "cancelled"
            : "error",
        response,
        updatedAt: Date.now()
      });
      return;
    }
    if (currentTranslationJob?.requestId === requestId) return;
    if (!shouldApplyUntrackedTranslationResponse({
      requestRevision: jobRevisionAtRequest,
      currentRevision: translationJobRevision,
      jobRequestIdAtStart,
      currentJobRequestId: currentTranslationJob?.requestId ?? null
    })) return;
    elements.resultText.className = response.ok ? "result-text" : "result-text error";
    if (response.ok) {
      currentTranslation = response.translation;
      elements.speak.disabled = false;
      elements.copy.disabled = false;
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
    if (!shouldApplyUntrackedTranslationResponse({
      requestRevision: jobRevisionAtRequest,
      currentRevision: translationJobRevision,
      jobRequestIdAtStart,
      currentJobRequestId: currentTranslationJob?.requestId ?? null
    })) return;
    elements.resultText.className = "result-text error";
    elements.resultText.textContent = formatUiError(error);
    elements.resultMeta.textContent = "확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.";
  } finally {
    if (currentTranslationJob?.state !== "running") {
      translationInFlight = false;
      setBusy(false);
    }
  }
}

function applyTranslationJob(job: TranslationJobState | null): void {
  currentTranslationJob = job;
  const running = job?.state === "running";
  translationInFlight = running;
  setBusy(running);
  elements.translationCancel.hidden = !running;
  elements.translationClear.hidden = !job || running;
  if (!job) {
    currentTranslation = "";
    elements.resultCard.hidden = true;
    elements.resultText.className = "result-text";
    elements.resultText.textContent = "";
    elements.resultMeta.textContent = "";
    elements.copy.disabled = true;
    elements.speak.disabled = true;
    return;
  }

  if (!elements.source.value || sourceEditRevision === 0) {
    elements.source.value = job.text;
    updateCharacterCount();
  }
  elements.resultCard.hidden = false;
  elements.resultMeta.textContent = "";
  if (running) {
    currentTranslation = "";
    elements.resultText.className = "result-text loading-lines";
    elements.resultText.textContent = "작업공간을 닫아도 브라우저에서 번역을 계속합니다…";
    elements.copy.disabled = true;
    elements.speak.disabled = true;
    return;
  }

  const response = job.response;
  if (response?.ok) {
    currentTranslation = response.translation;
    elements.resultText.className = "result-text";
    elements.resultText.textContent = response.translation;
    elements.copy.disabled = false;
    elements.speak.disabled = false;
    const device = response.device === "webgpu"
      ? "WebGPU"
      : response.device === "wasm"
        ? "WASM"
        : "번역 생략";
    elements.resultMeta.textContent = `${device} · ${(response.elapsedMs / 1000).toFixed(1)}초`;
  } else {
    currentTranslation = "";
    elements.resultText.className = "result-text error";
    elements.resultText.textContent = response?.error ??
      (job.state === "cancelled" ? "번역을 취소했습니다." : "번역을 완료하지 못했습니다.");
    elements.copy.disabled = true;
    elements.speak.disabled = true;
    elements.resultMeta.textContent = job.state === "cancelled"
      ? "입력은 브라우저 세션에 남아 있어 다시 시도할 수 있습니다."
      : "엔진 상태를 확인한 뒤 다시 시도해 주세요.";
  }
}

async function cancelTranslationJob(): Promise<void> {
  if (!isExtensionRuntime || currentTranslationJob?.state !== "running") return;
  const requestId = currentTranslationJob.requestId;
  const jobRevisionAtRequest = translationJobRevision;
  try {
    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "CANCEL_TRANSLATION_JOB",
      requestId
    }) as TranslationJobActionResponse;
    if (!shouldApplyRuntimeSnapshot(jobRevisionAtRequest, translationJobRevision)) {
      return;
    }
    // Runtime broadcasts are the live source of truth. If this panel already
    // moved to another/cleared job, a late action ACK must not rewind it.
    if (!shouldApplyTranslationJobAction(
      requestId,
      currentTranslationJob,
      response.job
    )) return;
    if (response.job) applyTranslationJob(response.job);
    if (!response.ok) {
      elements.resultMeta.textContent = response.error ?? "번역을 취소하지 못했습니다.";
    }
  } catch (error) {
    if (
      shouldApplyRuntimeSnapshot(jobRevisionAtRequest, translationJobRevision) &&
      shouldApplyTranslationJobAction(requestId, currentTranslationJob, null)
    ) {
      elements.resultMeta.textContent = `번역을 취소하지 못했습니다: ${formatUiError(error)}`;
    }
  }
}

async function clearTranslationJob(): Promise<void> {
  const requestId = currentTranslationJob?.requestId;
  const speechId = currentSpeechId ?? currentTtsStatus.speechId ?? null;
  const jobRevisionAtRequest = translationJobRevision;
  if (!requestId) return;
  if (!isExtensionRuntime) {
    applyTranslationJob(null);
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "CLEAR_TRANSLATION_JOB",
      requestId
    }) as TranslationJobActionResponse;
    if (!response.ok) {
      if (!shouldApplyRuntimeSnapshot(jobRevisionAtRequest, translationJobRevision)) {
        return;
      }
      if (!shouldApplyTranslationJobAction(
        requestId,
        currentTranslationJob,
        response.job
      )) return;
      if (response.job) applyTranslationJob(response.job);
      elements.resultMeta.textContent = response.error ?? "번역 기록을 지우지 못했습니다.";
      return;
    }
    await stopSpeech(speechId);
    // Do not erase a newer job that another workspace started while this
    // request was in flight. Its broadcast is authoritative for this panel.
    if (
      shouldApplyRuntimeSnapshot(jobRevisionAtRequest, translationJobRevision) &&
      (!currentTranslationJob || currentTranslationJob.requestId === requestId)
    ) {
      applyTranslationJob(response.job);
    }
  } catch (error) {
    if (
      shouldApplyRuntimeSnapshot(jobRevisionAtRequest, translationJobRevision) &&
      shouldApplyTranslationJobAction(requestId, currentTranslationJob, null)
    ) {
      elements.resultMeta.textContent = `번역 기록을 지우지 못했습니다: ${formatUiError(error)}`;
    }
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

async function stopSpeech(requestedSpeechId?: string | null): Promise<void> {
  const speechId = requestedSpeechId === undefined
    ? currentSpeechId ?? currentTtsStatus.speechId ?? null
    : requestedSpeechId;
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
  updateModelActionAvailability();

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
    elements.ttsDetail.textContent = "첫 듣기 때 약 400MB 모델을 내려받습니다.";
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
  // Copy the actual translation, never an error message shown in #result-text.
  const text = currentTranslation;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    elements.copy.textContent = "복사됨";
  } catch {
    elements.copy.textContent = "복사 실패";
  }
  window.setTimeout(() => {
    elements.copy.textContent = "복사";
  }, 1200);
}

async function changePageDisplayMode(): Promise<void> {
  const actionRevision = ++pageStatusRevision;
  const saved = await saveSettingSafely(
    "pageDisplayMode",
    elements.pageDisplayMode.value as PageDisplayMode
  );
  if (!saved) return;
  if (!isExtensionRuntime) return;
  const status = await chrome.runtime.sendMessage({
    target: "background",
    type: "SET_PAGE_DISPLAY_MODE",
    displayMode: elements.pageDisplayMode.value as PageDisplayMode
  }).catch(() => null);
  if (
    status &&
    shouldApplyRuntimeSnapshot(actionRevision, pageStatusRevision)
  ) {
    updatePageStatus(normalizePageStatus(status));
  }
}

async function prepareSelectedModel(): Promise<void> {
  if (
    !isExtensionRuntime ||
    modelPreparationInFlight ||
    modelCacheActionInFlight ||
    modelSettingsUpdateInFlight
  ) return;
  modelPreparationInFlight = true;
  engineStatusRevision += 1;
  updateModelActionAvailability();
  elements.prepareModel.textContent = "모델 준비 중…";
  elements.modelCenterStatus.textContent = "선택한 모델을 브라우저 캐시에 준비하고 있습니다.";
  try {
    const status = await chrome.runtime.sendMessage({
      target: "background",
      type: "PREPARE_MODEL"
    }) as EngineStatus;
    updateEngineStatus(status);
    elements.modelCenterStatus.textContent = status.state === "ready"
      ? "모델 준비를 마쳤습니다. 이제 바로 번역할 수 있습니다."
      : status.error ?? "모델 준비 상태를 확인해 주세요.";
  } catch (error) {
    elements.modelCenterStatus.textContent = formatUiError(error);
  } finally {
    modelPreparationInFlight = false;
    updateModelActionAvailability();
    elements.prepareModel.textContent = "선택 모델 미리 준비";
    await refreshDeviceAndStorageStatus();
  }
}

async function clearSelectedModel(ttsOnly: boolean): Promise<void> {
  if (
    !isExtensionRuntime ||
    modelPreparationInFlight ||
    modelCacheActionInFlight ||
    modelSettingsUpdateInFlight ||
    (!ttsOnly && currentEngineStatus.state === "loading") ||
    (ttsOnly && isTtsActive(currentTtsStatus))
  ) return;
  const confirmed = window.confirm(
    ttsOnly
      ? "음성 모델 캐시를 삭제할까요? 다음 듣기 때 약 400MB를 다시 내려받습니다."
      : "선택한 번역 모델 캐시를 삭제할까요? 다음 번역 때 모델을 다시 내려받습니다."
  );
  if (!confirmed) return;
  modelCacheActionInFlight = true;
  updateModelActionAvailability();
  elements.modelCenterStatus.textContent = ttsOnly
    ? "음성 모델 캐시를 삭제하고 있습니다."
    : "선택한 번역 모델 캐시를 삭제하고 있습니다.";
  try {
    const cacheStatus = await chrome.runtime.sendMessage({
      target: "background",
      type: "CLEAR_MODEL_CACHE",
      modelPreference: ttsOnly
        ? undefined
        : elements.modelPreference.value as ModelPreference,
      includeTts: ttsOnly,
      includeTranslation: !ttsOnly
    }) as ModelCacheStatus | null;
    if (!cacheStatus || cacheStatus.error) {
      throw new Error(cacheStatus?.error ?? "모델 캐시 삭제 응답이 올바르지 않습니다.");
    }
    elements.modelCenterStatus.textContent = ttsOnly
      ? "음성 모델을 삭제했습니다. 다음 듣기 때 다시 받습니다."
      : "선택한 번역 모델을 삭제했습니다. 다음 사용 때 다시 받습니다.";
    await refreshDeviceAndStorageStatus();
  } catch (error) {
    elements.modelCenterStatus.textContent = formatUiError(error);
  } finally {
    modelCacheActionInFlight = false;
    updateModelActionAvailability();
  }
}

function updateModelActionAvailability(): void {
  const modelControlsLocked = shouldLockModelControls({
    preparing: modelPreparationInFlight,
    clearingCache: modelCacheActionInFlight,
    updatingSettings: modelSettingsUpdateInFlight
  });
  elements.modelPreference.disabled = modelControlsLocked;
  elements.devicePreference.disabled =
    modelControlsLocked || elements.modelPreference.value === "small100";
  elements.prepareModel.disabled = modelControlsLocked;
  elements.clearModel.disabled =
    modelControlsLocked || currentEngineStatus.state === "loading";
  elements.clearTts.disabled =
    modelControlsLocked || isTtsActive(currentTtsStatus);
}

async function refreshDeviceAndStorageStatus(): Promise<void> {
  if (!isExtensionRuntime) {
    updateDeviceAndStorageStatus(null);
    return;
  }
  const cacheStatus = await chrome.runtime.sendMessage({
    target: "background",
    type: "GET_MODEL_CACHE_STATUS"
  }).catch(() => null) as ModelCacheStatus | null;
  updateDeviceAndStorageStatus(cacheStatus);
}

async function updateDeviceAndStorageStatus(
  cacheStatus: ModelCacheStatus | null
): Promise<void> {
  const hasWebGpu = Boolean(navigator.gpu);
  elements.deviceReadiness.textContent = hasWebGpu ? "WebGPU 사용 가능" : "WASM 호환 모드";
  elements.deviceReadiness.classList.toggle("ready", hasWebGpu);
  let storageText = "저장 공간 정보 없음";
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.usage === "number" && typeof estimate.quota === "number") {
      storageText = `${formatBytes(estimate.usage)} 사용 · ${formatBytes(estimate.quota)} 할당`;
    }
  } catch {
    // Some extension test contexts do not expose storage estimates.
  }
  if (cacheStatus?.error) {
    elements.storageStatus.textContent =
      `${storageText} · 캐시 상태 확인 실패: ${cacheStatus.error}`;
    return;
  }
  const cachedCount = cacheStatus?.cachedModelIds.length ?? 0;
  const ttsText = cacheStatus?.ttsCached ? "음성 캐시 있음" : "음성 캐시 없음";
  elements.storageStatus.textContent =
    `${storageText} · 번역 모델 ${cachedCount}종 캐시 · ${ttsText}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)}${units[index]}`;
}

async function loadGlossary(): Promise<void> {
  if (!isExtensionRuntime) {
    renderGlossary();
    return;
  }
  const stored = await chrome.storage.local.get(GLOSSARY_STORAGE_KEY);
  glossaryEntries = normalizeGlossaryEntries(stored[GLOSSARY_STORAGE_KEY]);
  renderGlossary();
}

function updateGlossaryTargetState(): void {
  elements.glossaryTarget.disabled = elements.glossaryPreserve.checked;
  elements.glossaryTarget.placeholder = elements.glossaryPreserve.checked
    ? "원문을 그대로 유지합니다"
    : "한국어 표기";
}

async function addGlossaryEntry(): Promise<void> {
  const source = elements.glossarySource.value.trim();
  const preserve = elements.glossaryPreserve.checked;
  const target = preserve ? source : elements.glossaryTarget.value.trim();
  if (!source || !target) {
    elements.glossaryStatus.textContent = "원문 용어와 사용할 표기를 입력해 주세요.";
    return;
  }
  const existing = glossaryEntries.find((entry) =>
    entry.source.toLocaleLowerCase() === source.toLocaleLowerCase()
  );
  if (!existing && glossaryEntries.length >= MAX_GLOSSARY_ENTRIES) {
    elements.glossaryStatus.textContent =
      `용어는 최대 ${MAX_GLOSSARY_ENTRIES}개까지 저장할 수 있습니다. 기존 항목을 지워 주세요.`;
    return;
  }
  const nextEntries = normalizeGlossaryEntries([
    ...glossaryEntries.filter((entry) => entry.source.toLocaleLowerCase() !== source.toLocaleLowerCase()),
    {
      id: crypto.randomUUID(),
      source,
      target,
      mode: preserve ? "preserve" : "translate"
    }
  ]);
  await persistGlossary(nextEntries);
  glossaryEntries = nextEntries;
  elements.glossarySource.value = "";
  elements.glossaryTarget.value = "";
  elements.glossaryStatus.textContent = "용어를 이 기기에 저장했습니다.";
  renderGlossary();
}

async function removeGlossaryEntry(id: string): Promise<void> {
  const nextEntries = glossaryEntries.filter((entry) => entry.id !== id);
  await persistGlossary(nextEntries);
  glossaryEntries = nextEntries;
  elements.glossaryStatus.textContent = "용어를 삭제했습니다.";
  renderGlossary();
}

async function persistGlossary(entries: readonly GlossaryEntry[]): Promise<void> {
  if (isExtensionRuntime) {
    await chrome.storage.local.set({ [GLOSSARY_STORAGE_KEY]: entries });
  }
}

function renderGlossary(): void {
  elements.glossaryList.replaceChildren();
  if (glossaryEntries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "glossary-empty";
    empty.textContent = "아직 저장한 용어가 없습니다.";
    elements.glossaryList.append(empty);
    return;
  }
  for (const entry of glossaryEntries) {
    const row = document.createElement("div");
    row.className = "glossary-entry";
    const copy = document.createElement("span");
    copy.textContent = entry.mode === "preserve"
      ? `${entry.source} · 원문 유지`
      : `${entry.source} → ${entry.target}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => {
      void removeGlossaryEntry(entry.id).catch(reportGlossaryError);
    });
    row.append(copy, remove);
    elements.glossaryList.append(row);
  }
}

function updateCharacterCount(): void {
  elements.characterCount.textContent = `${elements.source.value.length.toLocaleString()} / 5,000`;
}

function reportGlossaryError(error: unknown): void {
  elements.glossaryStatus.textContent =
    `용어집을 저장하지 못했습니다: ${formatUiError(error)}`;
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
  elements.youtubeTranslationMode.value = settings.youtubeTranslationMode;
  elements.pageContinuous.checked = settings.pageContinuous;
  elements.pageDisplayMode.value = settings.pageDisplayMode;
  elements.sourceLanguage.value = settings.sourceLanguage;
  elements.modelPreference.value = settings.modelPreference;
  elements.devicePreference.value = settings.devicePreference;
  persistedModelPreference = settings.modelPreference;
  persistedDevicePreference = settings.devicePreference;
  updateModelSettingDetail();
}

function applyExternalSettingChanges(
  changes: Record<string, chrome.storage.StorageChange>
): void {
  if (changes.youtubeEnabled) {
    elements.youtubeEnabled.checked = Boolean(
      changes.youtubeEnabled.newValue ?? DEFAULT_SETTINGS.youtubeEnabled
    );
  }
  if (changes.autoEnableCaptions) {
    elements.autoCaptions.checked = Boolean(
      changes.autoEnableCaptions.newValue ?? DEFAULT_SETTINGS.autoEnableCaptions
    );
  }
  if (changes.showOriginalCaptions) {
    elements.showOriginal.checked = Boolean(
      changes.showOriginalCaptions.newValue ?? DEFAULT_SETTINGS.showOriginalCaptions
    );
  }
  // A sync notification from an earlier range commit can arrive after the
  // user has already dragged to a newer value. Keep the local in-progress
  // edit authoritative until its own commit/flush finishes.
  if (changes.subtitleSize && !subtitleSizeCommitter.isDirty()) {
    const value = Number(changes.subtitleSize.newValue ?? DEFAULT_SETTINGS.subtitleSize);
    elements.subtitleSize.value = String(value);
    elements.subtitleSizeValue.textContent = `${value}px`;
  }
  if (changes.youtubeTranslationMode) {
    elements.youtubeTranslationMode.value = String(
      changes.youtubeTranslationMode.newValue ?? DEFAULT_SETTINGS.youtubeTranslationMode
    );
  }
  if (changes.pageContinuous) {
    elements.pageContinuous.checked = Boolean(
      changes.pageContinuous.newValue ?? DEFAULT_SETTINGS.pageContinuous
    );
  }
  if (changes.pageDisplayMode) {
    elements.pageDisplayMode.value = String(
      changes.pageDisplayMode.newValue ?? DEFAULT_SETTINGS.pageDisplayMode
    );
  }
  if (changes.sourceLanguage) {
    elements.sourceLanguage.value = String(
      changes.sourceLanguage.newValue ?? DEFAULT_SETTINGS.sourceLanguage
    );
  }
  if (changes.modelPreference) {
    persistedModelPreference = String(
      changes.modelPreference.newValue ?? DEFAULT_SETTINGS.modelPreference
    ) as ModelPreference;
    elements.modelPreference.value = persistedModelPreference;
  }
  if (changes.devicePreference) {
    persistedDevicePreference = String(
      changes.devicePreference.newValue ?? DEFAULT_SETTINGS.devicePreference
    ) as DevicePreference;
    elements.devicePreference.value = persistedDevicePreference;
  }
  if (changes.modelPreference || changes.devicePreference) {
    updateModelSettingDetail();
  }
}

async function saveSetting<Key extends keyof ExtensionSettings>(
  key: Key,
  value: ExtensionSettings[Key]
): Promise<void> {
  if (isExtensionRuntime) await chrome.storage.sync.set({ [key]: value });
}

async function saveSettingSafely<Key extends keyof ExtensionSettings>(
  key: Key,
  value: ExtensionSettings[Key]
): Promise<boolean> {
  try {
    await saveSetting(key, value);
    return true;
  } catch (error) {
    updateEngineStatus({
      state: "error",
      modelId: MODEL_DEFINITIONS[
        elements.modelPreference.value as ModelPreference
      ].id,
      error: `설정을 저장하지 못했습니다: ${formatUiError(error)}`
    });
    return false;
  }
}

function saveSubtitleSizeSafely(): Promise<boolean> {
  return saveSettingSafely("subtitleSize", Number(elements.subtitleSize.value));
}

function commitSubtitleSize(): void {
  if (!subtitleSizeCommitter.isDirty()) return;
  void subtitleSizeCommitter.commit();
}

function flushSubtitleSizeOnPageHide(): void {
  if (!isExtensionRuntime || !subtitleSizeCommitter.isDirty()) return;
  // A popup can be destroyed before an in-flight committer continuation runs.
  // Dispatch the latest value directly so Chrome owns the final write before
  // this document goes away. Limit the write to this key to avoid overwriting
  // unrelated settings with a stale popup snapshot.
  void chrome.storage.sync.set({
    subtitleSize: Number(elements.subtitleSize.value)
  }).catch(() => undefined);
}

async function resetEngineForSettings<
  Key extends "modelPreference" | "devicePreference"
>(key: Key, value: ExtensionSettings[Key]): Promise<void> {
  if (modelSettingsUpdateInFlight) return;
  modelSettingsUpdateInFlight = true;
  engineStatusRevision += 1;
  updateModelSettingDetail();
  let settingSaved = false;
  try {
    await saveSetting(key, value);
    settingSaved = true;
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
    if (!settingSaved) {
      elements.modelPreference.value = persistedModelPreference;
      elements.devicePreference.value = persistedDevicePreference;
      updateModelSettingDetail();
    }
    updateEngineStatus({
      state: "error",
      modelId: MODEL_DEFINITIONS[
        elements.modelPreference.value as ModelPreference
      ].id,
      error: formatUiError(error)
    });
  } finally {
    modelSettingsUpdateInFlight = false;
    updateModelActionAvailability();
  }
}

function updateModelSettingDetail(): void {
  const preference = elements.modelPreference.value as ModelPreference;
  const definition = MODEL_DEFINITIONS[preference];
  updateModelActionAvailability();
  const automaticFallbackNote =
    preference === "m2m100"
      ? " · 자동 폴백 시 최대 약 1.4GB 전송"
      : preference === "translategemma"
        ? " · 폴백 시 M2M100 약 650MB 추가"
      : "";
  elements.modelSettingDetail.textContent =
    `${definition.label} · ${definition.downloadSize}${automaticFallbackNote} · ` +
    `${definition.deviceNote} · Chrome 캐시에 보관`;
}

function updateEngineStatus(status: EngineStatus): void {
  currentEngineStatus = status;
  const stateLabel = {
    idle: "대기",
    loading: "준비 중",
    ready: "준비됨",
    error: "오류"
  }[status.state];
  elements.engineState.textContent = stateLabel;
  elements.engineState.className = `engine-state ${status.state}`;
  updateModelActionAvailability();
  elements.progressTrack.hidden = status.state !== "loading";
  const progress = status.progress ?? 0;
  const isIndeterminate = status.state === "loading" && progress <= 0;
  elements.progressBar.classList.toggle("indeterminate", isIndeterminate);
  const percent = Math.round(progress * 100);
  elements.progressBar.style.width = isIndeterminate ? "35%" : `${percent}%`;
  if (isIndeterminate) {
    elements.progressTrack.removeAttribute("aria-valuenow");
  } else {
    elements.progressTrack.setAttribute("aria-valuenow", String(percent));
  }
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
        ? `${modelLabelFromId(status.fallbackFromModelId)} 대신 M2M100 폴백 · ${runtime}`
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
        : elements.modelPreference.value === "translategemma"
          ? `${selected.downloadSize} · WebGPU 미지원 시 M2M100 WASM 폴백`
        : `첫 번역 때 ${selected.downloadSize} 모델을 한 번 내려받습니다.`;
  }
}

function modelLabelFromId(modelId: string): string {
  if (modelId === TRANSLATEGEMMA_MODEL_ID) {
    return MODEL_DEFINITIONS.translategemma.label;
  }
  if (modelId === SMALL100_MODEL_ID) return MODEL_DEFINITIONS.small100.label;
  if (modelId === M2M100_MODEL_ID) return MODEL_DEFINITIONS.m2m100.label;
  return "로컬 모델";
}

function updatePageStatus(status: PageTranslationStatus): void {
  const continuousActive = Boolean(
    status.continuous &&
    status.hasMore &&
    !["idle", "stopped", "error"].includes(status.state)
  );
  elements.pageTranslate.dataset.state = status.state;
  elements.pageTranslate.dataset.active =
    status.state === "translating" || continuousActive ? "true" : "false";
  elements.pageRestore.hidden = status.state === "idle";
  elements.extensionReload.hidden = status.error !== EXTENSION_RELOAD_MESSAGE;
  elements.pageTranslate.textContent =
    status.state === "translating"
      ? "번역 중지"
      : continuousActive
        ? "연속 번역 중지"
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
      status.continuous
        ? `${status.completed}개 문장을 표시했습니다. 스크롤하면 다음 문단을 계속 번역합니다.`
        : `${status.completed}개 문장을 원문 아래에 표시했습니다.`;
  } else if (status.state === "partial") {
    elements.pageStatus.textContent =
      `${status.completed}개 문장을 표시했고 ${status.failed}개 문장은 실패했습니다.`;
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
