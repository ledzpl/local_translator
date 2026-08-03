import type {
  DevicePreference,
  ModelPreference,
  RuntimeDevice
} from "./protocol";

export type TranslationEngineKind =
  | "translategemma"
  | "m2m100"
  | "small100";

export function shouldRetryTranslationOnWasm(options: {
  engineKind: TranslationEngineKind;
  runtimeDevice: RuntimeDevice | undefined;
  devicePreference: DevicePreference;
}): boolean {
  return (
    options.engineKind !== "small100" &&
    options.runtimeDevice === "webgpu" &&
    options.devicePreference !== "wasm"
  );
}

export function shouldUseStoredWasmFallback(options: {
  fallbackReason: string | null;
  modelPreference: ModelPreference;
  devicePreference: DevicePreference;
}): boolean {
  return Boolean(
    options.fallbackReason &&
    options.modelPreference !== "small100" &&
    options.devicePreference !== "wasm"
  );
}

export function shouldRetryModelPreparationOnWasm(options: {
  modelPreference: ModelPreference;
  devicePreference: DevicePreference;
  state: "idle" | "loading" | "ready" | "error";
  fallbackFromDevice: RuntimeDevice | undefined;
}): boolean {
  return (
    options.state === "error" &&
    options.modelPreference !== "small100" &&
    options.devicePreference !== "wasm" &&
    options.fallbackFromDevice === "webgpu"
  );
}
