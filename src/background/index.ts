import {
  CONTEXT_MENU_ID,
  DEFAULT_SETTINGS,
  MODEL_ID,
  OFFSCREEN_PATH,
  type BackgroundMessage,
  type ContentMessage,
  type DevicePreference,
  type EngineStatus,
  type ExtensionSettings,
  type OffscreenMessage,
  type PageTranslationStatus,
  type TranslationOrigin,
  type TranslationResponse
} from "../shared/protocol";
import {
  containsMostlyKorean,
  normalizeLanguageCode,
  pickDetectedLanguage
} from "../shared/languages";
import { friendlyError, normalizeText } from "../shared/text";

let creatingOffscreen: Promise<void> | null = null;

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
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id || !info.selectionText) return;
  void translateAndDisplay(tab.id, info.selectionText, "selection");
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "translate-selection") return;
  void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    if (!tab?.id) return;
    const text = await getSelectionFromTab(tab.id);
    if (text) await translateAndDisplay(tab.id, text, "selection");
  });
});

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage,
    _sender,
    sendResponse: (response: unknown) => void
  ): boolean | undefined => {
    if (!message || message.target !== "background") return undefined;

    void handleBackgroundMessage(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          requestId: "unknown",
          code: "TRANSLATION_FAILED",
          error: friendlyError(error)
        } satisfies TranslationResponse);
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

      const sourceLanguage = await resolveSourceLanguage(text, message.sourceLanguage);
      if (sourceLanguage === "ko") {
        return {
          ok: true,
          requestId: message.requestId,
          translation: text,
          sourceLanguage,
          device: "none",
          elapsedMs: 0
        } satisfies TranslationResponse;
      }

      const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS) as ExtensionSettings;
      return sendToOffscreen({
        target: "offscreen",
        type: "TRANSLATE_OFFSCREEN",
        requestId: message.requestId,
        text,
        sourceLanguage,
        modelPreference: settings.modelPreference,
        devicePreference: settings.devicePreference,
        origin: message.origin
      });
    }
    case "GET_ACTIVE_SELECTION": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { text: "" };
      return { text: await getSelectionFromTab(tab.id) };
    }
    case "START_PAGE_TRANSLATION":
      return sendPageCommand("START_PAGE_TRANSLATION");
    case "GET_PAGE_TRANSLATION_STATUS":
      return sendPageCommand("GET_PAGE_TRANSLATION_STATUS");
    case "STOP_PAGE_TRANSLATION":
      return sendPageCommand("STOP_PAGE_TRANSLATION");
    case "RESTORE_PAGE_TRANSLATION":
      return sendPageCommand("RESTORE_PAGE_TRANSLATION");
    case "GET_ENGINE_STATUS":
      try {
        return await sendToOffscreen({
          target: "offscreen",
          type: "GET_ENGINE_STATUS_OFFSCREEN"
        });
      } catch {
        return {
          state: "idle",
          modelId: MODEL_ID
        } satisfies EngineStatus;
      }
    case "RESET_ENGINE":
      return sendToOffscreen({
        target: "offscreen",
        type: "RESET_ENGINE_OFFSCREEN"
      });
  }
}

async function sendPageCommand(
  type:
    | "START_PAGE_TRANSLATION"
    | "GET_PAGE_TRANSLATION_STATUS"
    | "STOP_PAGE_TRANSLATION"
    | "RESTORE_PAGE_TRANSLATION"
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
      { type } satisfies ContentMessage
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
  if (existing.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
      justification: "브라우저 내부 WASM/WebGPU 번역 모델을 로드하고 실행합니다."
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
}

async function sendToOffscreen(message: OffscreenMessage): Promise<unknown> {
  await ensureOffscreenDocument();
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
  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, {
      type: "TRANSLATION_STARTED",
      sourceText
    } satisfies ContentMessage);

    const response = await handleBackgroundMessage({
      target: "background",
      type: "TRANSLATE",
      requestId: crypto.randomUUID(),
      text: sourceText,
      sourceLanguage: "auto",
      origin
    }) as TranslationResponse;

    await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_TRANSLATION",
      sourceText,
      response
    } satisfies ContentMessage);
  } catch (error) {
    const response: TranslationResponse = {
      ok: false,
      requestId: crypto.randomUUID(),
      code: "UNSUPPORTED_PAGE",
      error: friendlyError(error)
    };
    await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_TRANSLATION",
      sourceText,
      response
    } satisfies ContentMessage).catch(() => undefined);
  }
}
