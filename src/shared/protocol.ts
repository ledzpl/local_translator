import {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_PREFERENCE,
  TTS_MODEL_ID,
  type ModelPreference
} from "./models";

export const CONTEXT_MENU_ID = "ongeul-translate-selection";
export const OFFSCREEN_PATH = "offscreen.html";
export const MODEL_ID = DEFAULT_MODEL_ID;
export { TTS_MODEL_ID } from "./models";

export type DevicePreference = "auto" | "webgpu" | "wasm";
export type RuntimeDevice = "webgpu" | "wasm";
export type TranslationOrigin = "popup" | "selection" | "youtube" | "page";
export type { ModelPreference } from "./models";

export interface ExtensionSettings {
  privacyConsentVersion: number;
  youtubeEnabled: boolean;
  autoEnableCaptions: boolean;
  showOriginalCaptions: boolean;
  subtitleSize: number;
  sourceLanguage: string;
  modelPreference: ModelPreference;
  devicePreference: DevicePreference;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  privacyConsentVersion: 0,
  youtubeEnabled: false,
  autoEnableCaptions: false,
  showOriginalCaptions: true,
  subtitleSize: 28,
  sourceLanguage: "auto",
  modelPreference: DEFAULT_MODEL_PREFERENCE,
  devicePreference: "webgpu"
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
  runtimeDeviceOverride?: RuntimeDevice;
  fallbackFromDevice?: RuntimeDevice;
  deviceFallbackReason?: string;
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
  code:
    | "EMPTY_TEXT"
    | "TEXT_TOO_LONG"
    | "CONSENT_REQUIRED"
    | "MODEL_LOAD_FAILED"
    | "TRANSLATION_FAILED"
    | "DEVICE_FALLBACK_REQUIRED"
    | "UNSUPPORTED_PAGE";
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
  fallbackFromDevice?: RuntimeDevice;
  deviceFallbackReason?: string;
}

export interface UiProgressMessage {
  target: "ui";
  type: "ENGINE_PROGRESS";
  status: EngineStatus;
}

export interface TtsStatus {
  state: "idle" | "loading" | "synthesizing" | "playing" | "error";
  modelId: string;
  speechId?: string;
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
  speechId: string;
  text: string;
}

export interface SpeakResponse {
  ok: boolean;
  speechId: string;
  stopped?: boolean;
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
  | { target: "background"; type: "STOP_SPEAKING"; speechId: string }
  | { target: "background"; type: "RESET_ENGINE" };

export type OffscreenMessage =
  | TranslateOffscreenRequest
  | {
      target: "offscreen";
      type: "SPEAK_KOREAN_OFFSCREEN";
      speechId: string;
      text: string;
    }
  | { target: "offscreen"; type: "GET_ENGINE_STATUS_OFFSCREEN" }
  | { target: "offscreen"; type: "GET_TTS_STATUS_OFFSCREEN" }
  | {
      target: "offscreen";
      type: "STOP_SPEAKING_OFFSCREEN";
      speechId: string;
    }
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
