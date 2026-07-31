import type {
  DevicePreference,
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
