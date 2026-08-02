import "./styles.css";
import {
  DEFAULT_SETTINGS,
  MODEL_ID,
  type EngineStatus,
  type ExtensionSettings,
  type TranslationJobState,
  type UiProgressMessage,
  type UiTranslationJobMessage
} from "../shared/protocol";
import { hasPrivacyConsent } from "../shared/privacy";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("앱 루트를 찾을 수 없습니다.");

app.innerHTML = `
  <header>
    <div>
      <div class="eyebrow"><span></span> LOCAL AI TRANSLATOR</div>
      <h1>온글<span>.</span></h1>
    </div>
    <div class="privacy-pill">외부 전송 없음</div>
  </header>
  <section class="status-card">
    <div class="status-icon">AI</div>
    <div>
      <strong id="launcher-title">상태 확인 중</strong>
      <p id="launcher-detail">로컬 번역 작업공간을 준비하고 있습니다.</p>
    </div>
    <span id="launcher-state">대기</span>
  </section>
  <button id="open-workspace" class="primary" type="button">
    <span>번역 작업공간 열기</span><span aria-hidden="true">→</span>
  </button>
  <button id="quick-page" class="secondary" type="button">
    현재 페이지 번역 시작
  </button>
  <footer>
    <span>입력과 결과는 브라우저 세션 안에서만 복구됩니다.</span>
    <a href="/privacy.html" target="_blank" rel="noreferrer">개인정보처리방침</a>
  </footer>
`;

const elements = {
  title: getElement<HTMLElement>("launcher-title"),
  detail: getElement<HTMLElement>("launcher-detail"),
  state: getElement<HTMLElement>("launcher-state"),
  open: getElement<HTMLButtonElement>("open-workspace"),
  quickPage: getElement<HTMLButtonElement>("quick-page")
};

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let engineStatus: EngineStatus = { state: "idle", modelId: MODEL_ID };
let translationJob: TranslationJobState | null = null;

elements.open.addEventListener("click", () => void openWorkspace());
elements.quickPage.addEventListener("click", () => void startPageTranslation());

chrome.runtime.onMessage.addListener((message: UiProgressMessage | UiTranslationJobMessage) => {
  if (message?.target !== "ui") return;
  if (message.type === "ENGINE_PROGRESS") engineStatus = message.status;
  if (message.type === "TRANSLATION_JOB_UPDATED") translationJob = message.job;
  renderStatus();
});

void initialize();

async function initialize(): Promise<void> {
  const [storedSettings, status, job] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>),
    chrome.runtime.sendMessage({ target: "background", type: "GET_ENGINE_STATUS" })
      .catch(() => ({ state: "idle", modelId: MODEL_ID })),
    chrome.runtime.sendMessage({ target: "background", type: "GET_TRANSLATION_JOB" })
      .catch(() => null)
  ]);
  settings = storedSettings as unknown as ExtensionSettings;
  engineStatus = status as EngineStatus;
  translationJob = job as TranslationJobState | null;
  renderStatus();
}

async function openWorkspace(): Promise<void> {
  elements.open.disabled = true;
  try {
    await chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    window.close();
  } catch {
    elements.detail.textContent = "Chrome 사이드 패널을 열지 못했습니다. 확장을 새로고침해 주세요.";
    elements.open.disabled = false;
  }
}

async function startPageTranslation(): Promise<void> {
  if (!hasPrivacyConsent(settings)) {
    await openWorkspace();
    return;
  }
  elements.quickPage.disabled = true;
  const status = await chrome.runtime.sendMessage({
    target: "background",
    type: "START_PAGE_TRANSLATION",
    continuous: settings.pageContinuous,
    displayMode: settings.pageDisplayMode
  }).catch(() => null);
  elements.quickPage.disabled = false;
  if (!status || status.state === "error") {
    elements.detail.textContent = status?.error ?? "현재 페이지 번역을 시작하지 못했습니다.";
    return;
  }
  elements.title.textContent = "현재 페이지 번역을 시작했어요";
  elements.detail.textContent = "페이지 오른쪽 위 진행 패널에서 상태를 확인할 수 있습니다.";
}

function renderStatus(): void {
  const consented = hasPrivacyConsent(settings);
  elements.quickPage.disabled = !consented;
  if (!consented) {
    elements.title.textContent = "첫 설정이 필요해요";
    elements.detail.textContent = "작업공간에서 로컬 처리와 모델 다운로드를 확인해 주세요.";
    elements.state.textContent = "설정";
    return;
  }
  if (translationJob?.state === "running") {
    elements.title.textContent = "브라우저에서 번역 중이에요";
    elements.detail.textContent = "작업공간을 닫아도 계속됩니다. 다시 열어 진행률과 취소를 확인하세요.";
    elements.state.textContent = "진행 중";
    return;
  }
  if (translationJob?.state === "complete") {
    elements.title.textContent = "최근 번역이 준비됐어요";
    elements.detail.textContent = "작업공간을 열면 결과를 다시 보고 복사하거나 들을 수 있습니다.";
    elements.state.textContent = "완료";
    return;
  }
  if (engineStatus.state === "loading") {
    const percent = Math.round((engineStatus.progress ?? 0) * 100);
    elements.title.textContent = percent > 0 ? `로컬 모델 준비 중 ${percent}%` : "로컬 모델 준비 중";
    elements.detail.textContent = "다운로드가 끝나면 다음 번역부터 바로 사용할 수 있습니다.";
    elements.state.textContent = "준비 중";
    return;
  }
  elements.title.textContent = engineStatus.state === "ready"
    ? "로컬 AI 준비 완료"
    : "번역할 준비가 됐어요";
  elements.detail.textContent = engineStatus.state === "ready"
    ? "현재 모델을 브라우저 안에서 바로 사용할 수 있습니다."
    : "작업공간에서 텍스트·페이지·YouTube 번역을 시작하세요.";
  elements.state.textContent = engineStatus.state === "ready" ? "준비됨" : "대기";
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`${id} 요소를 찾을 수 없습니다.`);
  return element as T;
}
