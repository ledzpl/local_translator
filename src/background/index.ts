import {
  CONTEXT_MENU_ID,
  DEFAULT_SETTINGS,
  MODEL_ID,
  OFFSCREEN_PATH,
  TTS_MODEL_ID,
  createRequestId,
  type BackgroundMessage,
  type ContentMessage,
  type DevicePreference,
  type EngineStatus,
  type ExtensionSettings,
  type ModelCacheStatus,
  type OffscreenMessage,
  type PageDisplayMode,
  type PageTranslationStatus,
  type SpeakResponse,
  type TtsStatus,
  type TranslationOrigin,
  type TranslationJobActionResponse,
  type TranslationJobState,
  type TranslationResponse,
  type UiTranslationJobMessage,
  type UiTtsProgressMessage
} from "../shared/protocol";
import {
  GLOSSARY_STORAGE_KEY,
  normalizeGlossaryEntries
} from "../shared/glossary";
import {
  containsMostlyKorean,
  normalizeLanguageCode,
  pickDetectedLanguage
} from "../shared/languages";
import { hasPrivacyConsent } from "../shared/privacy";
import { SerialTaskQueue } from "../shared/serial-queue";
import {
  createTextPreview,
  TRANSLATION_REQUEST_MAX_CHARS,
  friendlyError,
  normalizeText
} from "../shared/text";
import { shouldMarkSpeechIdle } from "../shared/tts";
import { TranslationJobCoordinator } from "../shared/translation-job";

let creatingOffscreen: Promise<void> | null = null;
let recoveringOffscreen: Promise<void> | null = null;
let wasmFallbackOffscreenReady = false;
let ttsStatus: TtsStatus = { state: "idle", modelId: TTS_MODEL_ID };
let ttsInterruptedByEngineRecovery = false;
const translationRequests = new SerialTaskQueue();
const speechStarts = new Map<string, Promise<SpeakResponse>>();
let latestSpeechStartId: string | null = null;
const WEBGPU_FALLBACK_REASON_KEY = "runtimeWebGpuFallbackReason";
const TRANSLATION_JOB_KEY = "activeTranslationJob";
const cancelledTranslationRequests = new Set<string>();
const translationJobs = new TranslationJobCoordinator({
  read: getStoredTranslationJob,
  write: setStoredTranslationJob,
  clear: clearStoredTranslationJob
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "“%s” 한국어로 번역",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (info.menuItemId !== CONTEXT_MENU_ID || typeof tabId !== "number") return;
  void (async () => {
    if (!await hasStoredPrivacyConsent() || !info.selectionText) return;
    await translateAndDisplay(tabId, info.selectionText, "selection");
  })();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "translate-selection") return;
  void (async () => {
    if (!await hasStoredPrivacyConsent()) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const text = await getSelectionFromTab(tab.id);
    if (text) await translateAndDisplay(tab.id, text, "selection");
  })();
});

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage | UiTtsProgressMessage,
    _sender,
    sendResponse: (response: unknown) => void
  ): boolean | undefined => {
    if (!message) return undefined;
    if (message.target === "ui" && message.type === "TTS_PROGRESS") {
      if (recoveringOffscreen) return undefined;
      ttsStatus = message.status;
      return undefined;
    }
    if (message.target !== "background") return undefined;

    void handleBackgroundMessage(message)
      .then(sendResponse)
      .catch(async (error) => {
        const response = createBackgroundErrorResponse(message, error);
        if (message.type === "TRANSLATE") {
          cancelledTranslationRequests.delete(message.requestId);
          if (message.origin === "popup") {
            await translationJobs.complete(
              message.requestId,
              response as TranslationResponse
            ).catch(() => undefined);
          }
        }
        sendResponse(response);
      });
    return true;
  }
);

async function handleBackgroundMessage(message: BackgroundMessage): Promise<unknown> {
  switch (message.type) {
    case "TRANSLATE": {
      const text = normalizeText(message.text);
      if (!text) {
        return {
          ok: false,
          requestId: message.requestId,
          code: "EMPTY_TEXT",
          error: "번역할 텍스트가 없습니다."
        } satisfies TranslationResponse;
      }
      if (text.length > TRANSLATION_REQUEST_MAX_CHARS) {
        return {
          ok: false,
          requestId: message.requestId,
          code: "TEXT_TOO_LONG",
          error:
            `한 번에 번역할 수 있는 텍스트는 ` +
            `${TRANSLATION_REQUEST_MAX_CHARS.toLocaleString("ko-KR")}자까지입니다.`
        } satisfies TranslationResponse;
      }

      const settings = await getSettings();
      if (!hasPrivacyConsent(settings)) {
        return consentRequiredTranslation(message.requestId);
      }
      const sourceLanguage = await resolveSourceLanguage(text, message.sourceLanguage);
      if (message.origin === "popup") {
        cancelledTranslationRequests.delete(message.requestId);
        const startedAt = Date.now();
        const claim = await translationJobs.start({
          requestId: message.requestId,
          state: "running",
          text,
          sourceLanguage,
          startedAt,
          updatedAt: startedAt
        });
        if (!claim.changed) {
          return {
            ok: false,
            requestId: message.requestId,
            code: "TRANSLATION_FAILED",
            error: "이미 진행 중인 번역이 있습니다. 작업공간에서 완료하거나 취소해 주세요."
          } satisfies TranslationResponse;
        }
      }
      const glossaryValue = await chrome.storage.local.get(GLOSSARY_STORAGE_KEY);
      const glossary = normalizeGlossaryEntries(glossaryValue[GLOSSARY_STORAGE_KEY]);
      let response: TranslationResponse;
      if (sourceLanguage === "ko") {
        response = {
          ok: true,
          requestId: message.requestId,
          translation: text,
          sourceLanguage,
          device: "none",
          elapsedMs: 0
        } satisfies TranslationResponse;
      } else {
        response = await translationRequests.run(() =>
          translateWithDeviceRecovery({
          target: "offscreen",
          type: "TRANSLATE_OFFSCREEN",
          requestId: message.requestId,
          text,
          sourceLanguage,
          context: message.context,
          glossary,
          modelPreference: settings.modelPreference,
          devicePreference: settings.devicePreference,
          origin: message.origin
        })
        );
      }
      if (message.origin === "popup") {
        const completed = await translationJobs.complete(message.requestId, response);
        if (!completed.changed) {
          cancelledTranslationRequests.delete(message.requestId);
          return {
            ok: false,
            requestId: message.requestId,
            code: "TRANSLATION_CANCELLED",
            error: "번역을 취소했습니다."
          } satisfies TranslationResponse;
        }
      }
      cancelledTranslationRequests.delete(message.requestId);
      return response;
    }
    case "GET_ACTIVE_SELECTION": {
      if (!hasPrivacyConsent(await getSettings())) return { text: "" };
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { text: "" };
      return { text: await getSelectionFromTab(tab.id) };
    }
    case "SPEAK_KOREAN": {
      latestSpeechStartId = message.speechId;
      const start = startKoreanSpeech(message);
      speechStarts.set(message.speechId, start);
      try {
        return await start;
      } finally {
        if (speechStarts.get(message.speechId) === start) {
          speechStarts.delete(message.speechId);
        }
      }
    }
    case "START_PAGE_TRANSLATION":
      if (!hasPrivacyConsent(await getSettings())) {
        return {
          state: "error",
          total: 0,
          completed: 0,
          failed: 0,
          error: "사이드 패널에서 데이터 처리 안내를 확인한 뒤 사용할 수 있습니다."
        } satisfies PageTranslationStatus;
      }
      return sendPageCommand({
        type: "START_PAGE_TRANSLATION",
        continuous: message.continuous,
        displayMode: message.displayMode
      });
    case "GET_PAGE_TRANSLATION_STATUS":
      return sendPageCommand({ type: "GET_PAGE_TRANSLATION_STATUS" });
    case "STOP_PAGE_TRANSLATION":
      return sendPageCommand({ type: "STOP_PAGE_TRANSLATION" });
    case "RESTORE_PAGE_TRANSLATION":
      return sendPageCommand({ type: "RESTORE_PAGE_TRANSLATION" });
    case "SET_PAGE_DISPLAY_MODE":
      return sendPageCommand({
        type: "SET_PAGE_DISPLAY_MODE",
        displayMode: message.displayMode
      });
    case "GET_TRANSLATION_JOB":
      return translationJobs.get();
    case "CANCEL_TRANSLATION_JOB": {
      const cancelledResponse: TranslationResponse = {
        ok: false,
        requestId: message.requestId,
        code: "TRANSLATION_CANCELLED",
        error: "번역을 취소했습니다."
      };
      // Mark the request before entering the serialized state transition. An
      // offscreen completion can otherwise slip between the cancelled job
      // write and this tombstone, leaving a stale cancellation behind.
      cancelledTranslationRequests.add(message.requestId);
      const cancelled = await translationJobs.cancel(
        message.requestId,
        cancelledResponse
      );
      if (cancelled.changed) {
        await sendToExistingOffscreen({
          target: "offscreen",
          type: "CANCEL_TRANSLATION_OFFSCREEN",
          requestId: message.requestId
        }).catch(() => undefined);
      } else {
        cancelledTranslationRequests.delete(message.requestId);
      }
      return {
        ok: cancelled.changed || cancelled.job?.requestId === message.requestId,
        job: cancelled.job,
        error:
          cancelled.changed || cancelled.job?.requestId === message.requestId
            ? undefined
            : "취소할 번역 작업이 이미 변경됐습니다."
      } satisfies TranslationJobActionResponse;
    }
    case "CLEAR_TRANSLATION_JOB": {
      const cleared = await translationJobs.clear(message.requestId);
      return {
        ok: cleared.changed,
        job: cleared.job,
        error: cleared.changed
          ? undefined
          : "실행 중이거나 더 최근인 번역 작업은 지울 수 없습니다."
      } satisfies TranslationJobActionResponse;
    }
    case "CANCEL_TRANSLATION_REQUEST":
      cancelledTranslationRequests.add(message.requestId);
      await sendToExistingOffscreen({
        target: "offscreen",
        type: "CANCEL_TRANSLATION_OFFSCREEN",
        requestId: message.requestId
      }).catch(() => undefined);
      return { ok: true, requestId: message.requestId };
    case "PREPARE_MODEL": {
      const settings = await getSettings();
      if (!hasPrivacyConsent(settings)) {
        return {
          state: "error",
          modelId: MODEL_ID,
          error: "사이드 패널에서 데이터 처리 안내를 확인한 뒤 모델을 준비할 수 있습니다."
        } satisfies EngineStatus;
      }
      const prepared = await sendToOffscreen({
        target: "offscreen",
        type: "PREPARE_MODEL_OFFSCREEN",
        modelPreference: settings.modelPreference,
        devicePreference: settings.devicePreference
      }) as EngineStatus;
      if (
        settings.modelPreference === "translategemma" &&
        settings.devicePreference !== "wasm" &&
        prepared.state === "error" &&
        prepared.fallbackFromDevice === "webgpu"
      ) {
        const fallbackReason = prepared.error ??
          "TranslateGemma WebGPU를 준비하지 못해 M2M100 WASM으로 전환합니다.";
        await recreateOffscreenDocumentForWasm(fallbackReason);
        return sendToOffscreen({
          target: "offscreen",
          type: "PREPARE_MODEL_OFFSCREEN",
          modelPreference: settings.modelPreference,
          devicePreference: settings.devicePreference,
          runtimeDeviceOverride: "wasm",
          fallbackFromDevice: "webgpu",
          deviceFallbackReason: fallbackReason
        });
      }
      return prepared;
    }
    case "GET_MODEL_CACHE_STATUS":
      return sendToOffscreen({
        target: "offscreen",
        type: "GET_MODEL_CACHE_STATUS_OFFSCREEN"
      });
    case "CLEAR_MODEL_CACHE":
      return sendToOffscreen({
        target: "offscreen",
        type: "CLEAR_MODEL_CACHE_OFFSCREEN",
        modelPreference: message.modelPreference,
        includeTts: message.includeTts,
        includeTranslation: message.includeTranslation
      });
    case "GET_ENGINE_STATUS":
      try {
        return await sendToExistingOffscreen({
          target: "offscreen",
          type: "GET_ENGINE_STATUS_OFFSCREEN"
        }) ?? {
          state: "idle",
          modelId: MODEL_ID
        } satisfies EngineStatus;
      } catch {
        return {
          state: "idle",
          modelId: MODEL_ID
        } satisfies EngineStatus;
      }
    case "GET_TTS_STATUS": {
      const liveStatus = await sendToExistingOffscreen({
        target: "offscreen",
        type: "GET_TTS_STATUS_OFFSCREEN"
      });
      if (
        isTtsStatus(liveStatus) &&
        !(
          ttsInterruptedByEngineRecovery &&
          ttsStatus.state === "error" &&
          liveStatus.state === "idle"
        )
      ) {
        ttsStatus = liveStatus;
      } else if (liveStatus === null && isActiveTtsStatus(ttsStatus)) {
        ttsStatus = {
          state: "idle",
          modelId: TTS_MODEL_ID,
          speechId: ttsStatus.speechId
        };
        broadcastTtsStatus();
      }
      return ttsStatus;
    }
    case "STOP_SPEAKING": {
      try {
        const cancelledPendingStart =
          latestSpeechStartId === message.speechId &&
          speechStarts.has(message.speechId);
        if (latestSpeechStartId === message.speechId) {
          latestSpeechStartId = null;
        }
        await speechStarts.get(message.speechId);
        const liveResponse = await sendToExistingOffscreen({
          target: "offscreen",
          type: "STOP_SPEAKING_OFFSCREEN",
          speechId: message.speechId
        });
        const response: SpeakResponse = liveResponse === null
          ? {
              ok: true,
              speechId: message.speechId,
              stopped: false
            }
          : isSpeakResponse(liveResponse) &&
              liveResponse.speechId === message.speechId
            ? liveResponse
            : {
                ok: false,
                speechId: message.speechId,
                error: "한국어 음성 엔진의 정지 응답이 올바르지 않습니다."
              };

        const stoppedCurrentSpeech = shouldMarkSpeechIdle(
          ttsStatus.speechId,
          message.speechId,
          liveResponse !== null,
          response.ok &&
            (response.stopped === true || cancelledPendingStart)
        );
        if (stoppedCurrentSpeech) {
          ttsStatus = {
            state: "idle",
            modelId: TTS_MODEL_ID,
            speechId: message.speechId
          };
          broadcastTtsStatus();
        }
        return response;
      } catch (error) {
        const errorMessage = friendlyError(error);
        if (ttsStatus.speechId === message.speechId) {
          ttsStatus = {
            state: "error",
            modelId: TTS_MODEL_ID,
            speechId: message.speechId,
            error: errorMessage
          };
          broadcastTtsStatus();
        }
        return {
          ok: false,
          speechId: message.speechId,
          error: errorMessage
        } satisfies SpeakResponse;
      }
    }
    case "RESET_ENGINE":
      await clearWebGpuFallback();
      return sendToOffscreen({
        target: "offscreen",
        type: "RESET_ENGINE_OFFSCREEN"
      });
  }
}

async function translateWithDeviceRecovery(
  request: Extract<OffscreenMessage, { type: "TRANSLATE_OFFSCREEN" }>
): Promise<TranslationResponse> {
  const shouldSend = () => !cancelledTranslationRequests.has(request.requestId);
  if (!shouldSend()) return backgroundCancelledTranslation(request.requestId);
  const storedFallbackReason = await getStoredWebGpuFallbackReason();
  if (storedFallbackReason && !wasmFallbackOffscreenReady) {
    await prepareStoredWasmFallbackDocument();
  }

  const firstRequest =
    storedFallbackReason && request.devicePreference !== "wasm"
      ? {
          ...request,
          runtimeDeviceOverride: "wasm" as const,
          fallbackFromDevice: "webgpu" as const,
          deviceFallbackReason: storedFallbackReason
        }
      : request;

  try {
    const firstResponse = await sendToOffscreen(firstRequest, shouldSend);
    if (firstResponse === null) {
      return backgroundCancelledTranslation(request.requestId);
    }
    const response = firstResponse as TranslationResponse;
    if (
      !isDeviceFallbackRequired(response) ||
      request.devicePreference === "wasm"
    ) {
      return response;
    }

    await recreateOffscreenDocumentForWasm(response.error);
    const fallbackResponse = await sendToOffscreen({
      ...request,
      runtimeDeviceOverride: "wasm",
      fallbackFromDevice: "webgpu",
      deviceFallbackReason: response.error
    }, shouldSend);
    return fallbackResponse === null
      ? backgroundCancelledTranslation(request.requestId)
      : fallbackResponse as TranslationResponse;
  } catch (error) {
    if (!shouldSend()) return backgroundCancelledTranslation(request.requestId);
    const recoveryReason = await getStoredWebGpuFallbackReason();
    if (!recoveryReason || request.devicePreference === "wasm") throw error;
    if (!wasmFallbackOffscreenReady) {
      await recreateOffscreenDocumentForWasm();
    }
    const recoveryResponse = await sendToOffscreen({
      ...request,
      runtimeDeviceOverride: "wasm",
      fallbackFromDevice: "webgpu",
      deviceFallbackReason: recoveryReason
    }, shouldSend);
    return recoveryResponse === null
      ? backgroundCancelledTranslation(request.requestId)
      : recoveryResponse as TranslationResponse;
  }
}

function backgroundCancelledTranslation(requestId: string): TranslationResponse {
  return {
    ok: false,
    requestId,
    code: "TRANSLATION_CANCELLED",
    error: "번역을 취소했습니다."
  };
}

function isDeviceFallbackRequired(
  response: TranslationResponse
): response is Extract<TranslationResponse, { ok: false }> {
  return !response.ok && response.code === "DEVICE_FALLBACK_REQUIRED";
}

async function getStoredWebGpuFallbackReason(): Promise<string | null> {
  const stored = await chrome.storage.session.get(WEBGPU_FALLBACK_REASON_KEY);
  const value = stored[WEBGPU_FALLBACK_REASON_KEY];
  return typeof value === "string" && value ? value : null;
}

async function clearWebGpuFallback(): Promise<void> {
  if (recoveringOffscreen) await recoveringOffscreen;
  wasmFallbackOffscreenReady = false;
  await chrome.storage.session.remove(WEBGPU_FALLBACK_REASON_KEY);
}

async function getSettings(): Promise<ExtensionSettings> {
  return chrome.storage.sync.get(DEFAULT_SETTINGS) as Promise<ExtensionSettings>;
}

async function hasStoredPrivacyConsent(): Promise<boolean> {
  try {
    return hasPrivacyConsent(await getSettings());
  } catch {
    return false;
  }
}

async function startKoreanSpeech(
  message: Extract<BackgroundMessage, { type: "SPEAK_KOREAN" }>
): Promise<SpeakResponse> {
  ttsInterruptedByEngineRecovery = false;
  const settings = await getSettings();
  if (latestSpeechStartId !== message.speechId) {
    return {
      ok: true,
      speechId: message.speechId,
      stopped: false
    };
  }
  if (!hasPrivacyConsent(settings)) {
    return {
      ok: false,
      speechId: message.speechId,
      error: "사이드 패널에서 데이터 처리 안내를 확인한 뒤 사용할 수 있습니다."
    };
  }
  const text = normalizeText(message.text);
  if (!text) {
    return {
      ok: false,
      speechId: message.speechId,
      error: "읽어줄 한국어 번역이 없습니다."
    };
  }
  ttsStatus = {
    state: "loading",
    modelId: TTS_MODEL_ID,
    speechId: message.speechId,
    progress: 0,
    file: "한국어 음성 모델 준비 중"
  };
  try {
    const response = await sendToOffscreen({
      target: "offscreen",
      type: "SPEAK_KOREAN_OFFSCREEN",
      speechId: message.speechId,
      text
    }, () => latestSpeechStartId === message.speechId);
    if (response === null) {
      return {
        ok: true,
        speechId: message.speechId,
        stopped: false
      };
    }
    if (!isSpeakResponse(response) || response.speechId !== message.speechId) {
      throw new Error("한국어 음성 엔진의 시작 응답이 올바르지 않습니다.");
    }
    return response;
  } catch (error) {
    if (latestSpeechStartId !== message.speechId) {
      return {
        ok: true,
        speechId: message.speechId,
        stopped: false
      };
    }
    ttsStatus = {
      state: "error",
      modelId: TTS_MODEL_ID,
      speechId: message.speechId,
      error: friendlyError(error)
    };
    broadcastTtsStatus();
    return {
      ok: false,
      speechId: message.speechId,
      error: ttsStatus.error
    };
  }
}

function consentRequiredTranslation(requestId: string): TranslationResponse {
  return {
    ok: false,
    requestId,
    code: "CONSENT_REQUIRED",
    error: "사이드 패널에서 데이터 처리 안내를 확인한 뒤 번역할 수 있습니다."
  };
}

function isTtsStatus(value: unknown): value is TtsStatus {
  return Boolean(
    value &&
    typeof value === "object" &&
    "state" in value &&
    "modelId" in value
  );
}

function isActiveTtsStatus(value: TtsStatus): boolean {
  return (
    value.state === "loading" ||
    value.state === "synthesizing" ||
    value.state === "playing"
  );
}

function isSpeakResponse(value: unknown): value is SpeakResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "speechId" in value &&
    typeof value.speechId === "string"
  );
}

function broadcastTtsStatus(): void {
  void chrome.runtime.sendMessage({
    target: "ui",
    type: "TTS_PROGRESS",
    status: ttsStatus
  }).catch(() => undefined);
}

function createBackgroundErrorResponse(
  message: BackgroundMessage,
  error: unknown
): unknown {
  const errorMessage = friendlyError(error);
  switch (message.type) {
    case "TRANSLATE":
      return {
        ok: false,
        requestId: message.requestId,
        code: "TRANSLATION_FAILED",
        error: errorMessage
      } satisfies TranslationResponse;
    case "SPEAK_KOREAN":
    case "STOP_SPEAKING":
      return {
        ok: false,
        speechId: message.speechId,
        error: errorMessage
      } satisfies SpeakResponse;
    case "START_PAGE_TRANSLATION":
    case "GET_PAGE_TRANSLATION_STATUS":
    case "STOP_PAGE_TRANSLATION":
    case "RESTORE_PAGE_TRANSLATION":
    case "SET_PAGE_DISPLAY_MODE":
      return {
        state: "error",
        total: 0,
        completed: 0,
        failed: 0,
        error: errorMessage
      } satisfies PageTranslationStatus;
    case "GET_ENGINE_STATUS":
    case "RESET_ENGINE":
    case "PREPARE_MODEL":
      return {
        state: "error",
        modelId: MODEL_ID,
        error: errorMessage
      } satisfies EngineStatus;
    case "GET_TTS_STATUS":
      return {
        state: "error",
        modelId: TTS_MODEL_ID,
        error: errorMessage
      } satisfies TtsStatus;
    case "GET_ACTIVE_SELECTION":
      return { text: "" };
    case "GET_TRANSLATION_JOB":
      return null;
    case "CANCEL_TRANSLATION_JOB":
    case "CLEAR_TRANSLATION_JOB":
      return {
        ok: false,
        job: null,
        error: errorMessage
      } satisfies TranslationJobActionResponse;
    case "CANCEL_TRANSLATION_REQUEST":
      return { ok: false, requestId: message.requestId, error: errorMessage };
    case "GET_MODEL_CACHE_STATUS":
    case "CLEAR_MODEL_CACHE":
      return {
        cachedModelIds: [],
        ttsCached: false,
        error: errorMessage
      } satisfies ModelCacheStatus;
  }
}

async function sendPageCommand(
  command:
    | Extract<ContentMessage, { type: "START_PAGE_TRANSLATION" }>
    | Extract<ContentMessage, { type: "GET_PAGE_TRANSLATION_STATUS" }>
    | Extract<ContentMessage, { type: "STOP_PAGE_TRANSLATION" }>
    | Extract<ContentMessage, { type: "RESTORE_PAGE_TRANSLATION" }>
    | Extract<ContentMessage, { type: "SET_PAGE_DISPLAY_MODE" }>
): Promise<PageTranslationStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return {
      state: "error",
      total: 0,
      completed: 0,
      failed: 0,
      error: "현재 웹 페이지를 찾지 못했습니다."
    };
  }

  try {
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(
      tab.id,
      command
    ) as PageTranslationStatus | undefined;
    if (!response?.state) throw new Error("페이지 번역 상태 응답이 없습니다.");
    return response;
  } catch {
    return {
      state: "error",
      total: 0,
      completed: 0,
      failed: 0,
      error: "이 페이지에서는 번역 결과를 표시할 수 없습니다."
    };
  }
}

async function getStoredTranslationJob(): Promise<TranslationJobState | null> {
  const stored = await chrome.storage.session.get(TRANSLATION_JOB_KEY);
  const value = stored[TRANSLATION_JOB_KEY];
  return value && typeof value === "object" ? value as TranslationJobState : null;
}

async function setStoredTranslationJob(job: TranslationJobState): Promise<void> {
  await chrome.storage.session.set({ [TRANSLATION_JOB_KEY]: job });
  broadcastTranslationJob(job);
}

async function clearStoredTranslationJob(): Promise<void> {
  await chrome.storage.session.remove(TRANSLATION_JOB_KEY);
  broadcastTranslationJob(null);
}

function broadcastTranslationJob(job: TranslationJobState | null): void {
  void chrome.runtime.sendMessage({
    target: "ui",
    type: "TRANSLATION_JOB_UPDATED",
    job
  } satisfies UiTranslationJobMessage).catch(() => undefined);
}

async function resolveSourceLanguage(text: string, requested?: string): Promise<string> {
  if (requested && requested !== "auto") return normalizeLanguageCode(requested);
  if (containsMostlyKorean(text)) return "ko";
  try {
    const result = await chrome.i18n.detectLanguage(text);
    return pickDetectedLanguage(result.languages);
  } catch {
    return "en";
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url]
  });
  if (existing.length > 0) {
    await waitForOffscreenReady();
    return;
  }

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [
        chrome.offscreen.Reason.WORKERS,
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.AUDIO_PLAYBACK
      ],
      justification: "브라우저 내부 AI 번역·한국어 음성 모델을 로드하고 음성을 재생합니다."
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
  await waitForOffscreenReady();
}

async function waitForOffscreenReady(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "PING_OFFSCREEN"
      } satisfies OffscreenMessage);
      if (response?.ok === true) return;
    } catch {
      // The document exists before its module listener is ready on some starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
  }
  throw new Error("로컬 번역 엔진 문서가 준비되지 않았습니다.");
}

async function prepareStoredWasmFallbackDocument(): Promise<void> {
  try {
    const liveStatus = await sendToExistingOffscreen({
      target: "offscreen",
      type: "GET_ENGINE_STATUS_OFFSCREEN"
    });
    if (
      liveStatus === null ||
      isReusableForStoredWasmFallback(liveStatus)
    ) {
      wasmFallbackOffscreenReady = true;
      return;
    }
  } catch {
    // An unreachable or failed WebGPU realm must be recreated below.
  }
  await recreateOffscreenDocumentForWasm();
}

function isReusableForStoredWasmFallback(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("state" in value)) return false;
  const candidate = value as Partial<EngineStatus>;
  if (candidate.state === "idle") return true;
  return candidate.device === "wasm" && candidate.state !== "error";
}

async function recreateOffscreenDocumentForWasm(
  fallbackReason?: string
): Promise<void> {
  if (!recoveringOffscreen) {
    wasmFallbackOffscreenReady = false;
    recoveringOffscreen = (async () => {
      if (fallbackReason) {
        await chrome.storage.session.set({
          [WEBGPU_FALLBACK_REASON_KEY]: fallbackReason
        });
      }
      if (creatingOffscreen) {
        await creatingOffscreen.catch(() => undefined);
      }

      const liveTtsStatus = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "GET_TTS_STATUS_OFFSCREEN"
      } satisfies OffscreenMessage).catch(() => null);
      if (isTtsStatus(liveTtsStatus)) {
        // The service worker can restart while its offscreen audio task keeps
        // running, so refresh the in-memory snapshot before closing the realm.
        ttsStatus = liveTtsStatus;
      }
      const interruptedSpeechId = isActiveTtsStatus(ttsStatus)
        ? ttsStatus.speechId
        : undefined;
      latestSpeechStartId = null;
      speechStarts.clear();
      ttsInterruptedByEngineRecovery = Boolean(interruptedSpeechId);
      ttsStatus = interruptedSpeechId
        ? {
            state: "error",
            modelId: TTS_MODEL_ID,
            speechId: interruptedSpeechId,
            error:
              "번역 엔진을 WASM으로 전환하면서 음성 재생이 중단됐습니다. " +
              "다시 듣기를 눌러 주세요."
          }
        : {
            state: "idle",
            modelId: TTS_MODEL_ID,
            speechId: ttsStatus.speechId
          };
      broadcastTtsStatus();

      const url = chrome.runtime.getURL(OFFSCREEN_PATH);
      const existing = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [url]
      });
      if (existing.length > 0) {
        await chrome.offscreen.closeDocument();
      }

      creatingOffscreen = null;
      await ensureOffscreenDocument();
      wasmFallbackOffscreenReady = true;
    })().finally(() => {
      recoveringOffscreen = null;
    });
  }
  await recoveringOffscreen;
}

async function sendToOffscreen(message: OffscreenMessage): Promise<unknown>;
async function sendToOffscreen(
  message: OffscreenMessage,
  shouldSend: () => boolean
): Promise<unknown | null>;
async function sendToOffscreen(
  message: OffscreenMessage,
  shouldSend?: () => boolean
): Promise<unknown | null> {
  while (true) {
    if (recoveringOffscreen) await recoveringOffscreen;
    await ensureOffscreenDocument();
    if (recoveringOffscreen) continue;
    if (shouldSend && !shouldSend()) return null;
    return chrome.runtime.sendMessage(message);
  }
}

async function sendToExistingOffscreen(
  message: OffscreenMessage
): Promise<unknown | null> {
  if (recoveringOffscreen) await recoveringOffscreen;
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url]
  });
  if (existing.length === 0) return null;
  return chrome.runtime.sendMessage(message);
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await contentScriptIsReady(tabId)) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await contentScriptIsReady(tabId)) return;
    await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
  }

  throw new Error("페이지 번역 스크립트가 준비되지 않았습니다.");
}

async function contentScriptIsReady(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function getSelectionFromTab(tabId: number): Promise<string> {
  try {
    await ensureContentScript(tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "GET_SELECTION"
    } satisfies ContentMessage);
    return normalizeText(response?.text ?? "");
  } catch {
    return "";
  }
}

async function translateAndDisplay(
  tabId: number,
  sourceText: string,
  origin: TranslationOrigin
): Promise<void> {
  if (!await hasStoredPrivacyConsent()) return;
  const text = normalizeText(sourceText);
  if (!text) return;
  const sourcePreview = createTextPreview(text);
  const displayRequestId = createRequestId();
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: "TRANSLATION_STARTED",
      requestId: displayRequestId,
      sourceText: sourcePreview
    } satisfies ContentMessage);

    if (text.length > TRANSLATION_REQUEST_MAX_CHARS) {
      await chrome.tabs.sendMessage(tabId, {
        type: "SHOW_TRANSLATION",
        requestId: displayRequestId,
        sourceText: sourcePreview,
        response: {
          ok: false,
          requestId: displayRequestId,
          code: "TEXT_TOO_LONG",
          error:
            `한 번에 번역할 수 있는 텍스트는 ` +
            `${TRANSLATION_REQUEST_MAX_CHARS.toLocaleString("ko-KR")}자까지입니다.`
        }
      } satisfies ContentMessage);
      return;
    }

    const response = await handleBackgroundMessage({
      target: "background",
      type: "TRANSLATE",
      requestId: displayRequestId,
      text,
      sourceLanguage: "auto",
      origin
    }) as TranslationResponse;

    await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_TRANSLATION",
      requestId: displayRequestId,
      sourceText: sourcePreview,
      response
    } satisfies ContentMessage);
  } catch (error) {
    const response: TranslationResponse = {
      ok: false,
      requestId: displayRequestId,
      code: "UNSUPPORTED_PAGE",
      error: friendlyError(error)
    };
    await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_TRANSLATION",
      requestId: displayRequestId,
      sourceText: sourcePreview,
      response
    } satisfies ContentMessage).catch(() => undefined);
  }
}
