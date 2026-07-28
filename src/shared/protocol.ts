import {
  MODEL_DEFINITIONS,
  type ModelPreference
} from "./models";

export const CONTEXT_MENU_ID = "ongeul-translate-selection";
export const OFFSCREEN_PATH = "offscreen.html";
export const MODEL_ID = MODEL_DEFINITIONS.small100.id;
export const TTS_MODEL_ID = "Xenova/mms-tts-kor";

export type DevicePreference = "auto" | "webgpu" | "wasm";
export type RuntimeDevice = "webgpu" | "wasm";
export type TranslationOrigin = "popup" | "selection" | "youtube" | "page";
export type { ModelPreference } from "./models";

export interface ExtensionSettings {
  youtubeEnabled: boolean;
  autoEnableCaptions: boolean;
  showOriginalCaptions: boolean;
  subtitleSize: number;
  sourceLanguage: string;
  modelPreference: ModelPreference;
  devicePreference: DevicePreference;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  youtubeEnabled: true,
  autoEnableCaptions: true,
  showOriginalCaptions: true,
  subtitleSize: 28,
  sourceLanguage: "auto",
  modelPreference: "small100",
  devicePreference: "wasm"
};

export interface TranslateRequest {
  target: "background";
  type: "TRANSLATE";
  requestId: string;
  text: string;
  sourceLanguage?: string;
  origin: TranslationOrigin;
}

export interface TranslateOffscreenRequest {
  target: "offscreen";
  type: "TRANSLATE_OFFSCREEN";
  requestId: string;
  text: string;
  sourceLanguage: string;
  modelPreference: ModelPreference;
  devicePreference: DevicePreference;
  origin: TranslationOrigin;
}

export interface TranslationSuccess {
  ok: true;
  requestId: string;
  translation: string;
  sourceLanguage: string;
  device: RuntimeDevice | "none";
  elapsedMs: number;
}

export interface TranslationFailure {
  ok: false;
  requestId: string;
  error: string;
  code: "EMPTY_TEXT" | "MODEL_LOAD_FAILED" | "TRANSLATION_FAILED" | "UNSUPPORTED_PAGE";
}

export type TranslationResponse = TranslationSuccess | TranslationFailure;

export interface EngineStatus {
  state: "idle" | "loading" | "ready" | "error";
  device?: RuntimeDevice;
  modelId: string;
  progress?: number;
  file?: string;
  error?: string;
  fallbackFromModelId?: string;
  fallbackReason?: string;
}

export interface UiProgressMessage {
  target: "ui";
  type: "ENGINE_PROGRESS";
  status: EngineStatus;
}

export interface TtsStatus {
  state: "idle" | "loading" | "synthesizing" | "playing" | "error";
  modelId: string;
  progress?: number;
  file?: string;
  error?: string;
}

export interface UiTtsProgressMessage {
  target: "ui";
  type: "TTS_PROGRESS";
  status: TtsStatus;
}

export interface SpeakRequest {
  target: "background";
  type: "SPEAK_KOREAN";
  text: string;
}

export interface SpeakResponse {
  ok: boolean;
  error?: string;
}

export interface PageTranslationStatus {
  state: "idle" | "translating" | "complete" | "stopped" | "error";
  total: number;
  completed: number;
  failed: number;
  error?: string;
}

export type BackgroundMessage =
  | TranslateRequest
  | SpeakRequest
  | { target: "background"; type: "GET_ACTIVE_SELECTION" }
  | { target: "background"; type: "START_PAGE_TRANSLATION" }
  | { target: "background"; type: "GET_PAGE_TRANSLATION_STATUS" }
  | { target: "background"; type: "STOP_PAGE_TRANSLATION" }
  | { target: "background"; type: "RESTORE_PAGE_TRANSLATION" }
  | { target: "background"; type: "GET_ENGINE_STATUS" }
  | { target: "background"; type: "GET_TTS_STATUS" }
  | { target: "background"; type: "STOP_SPEAKING" }
  | { target: "background"; type: "RESET_ENGINE" };

export type OffscreenMessage =
  | TranslateOffscreenRequest
  | { target: "offscreen"; type: "SPEAK_KOREAN_OFFSCREEN"; text: string }
  | { target: "offscreen"; type: "GET_ENGINE_STATUS_OFFSCREEN" }
  | { target: "offscreen"; type: "GET_TTS_STATUS_OFFSCREEN" }
  | { target: "offscreen"; type: "STOP_SPEAKING_OFFSCREEN" }
  | { target: "offscreen"; type: "RESET_ENGINE_OFFSCREEN" };

export type ContentMessage =
  | { type: "GET_SELECTION" }
  | { type: "START_PAGE_TRANSLATION" }
  | { type: "GET_PAGE_TRANSLATION_STATUS" }
  | { type: "STOP_PAGE_TRANSLATION" }
  | { type: "RESTORE_PAGE_TRANSLATION" }
  | { type: "TRANSLATION_STARTED"; sourceText: string }
  | { type: "SHOW_TRANSLATION"; sourceText: string; response: TranslationResponse };

export function createRequestId(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}
