import {
  AutoModelForSeq2SeqLM,
  AutoTokenizer,
  Tensor,
  env,
  pipeline,
  type TextToAudioPipeline,
  type TranslationPipeline
} from "@huggingface/transformers";
import {
  MODEL_ID,
  TTS_MODEL_ID,
  type DevicePreference,
  type EngineStatus,
  type ModelPreference,
  type OffscreenMessage,
  type RuntimeDevice,
  type SpeakResponse,
  type TtsStatus,
  type TranslateOffscreenRequest,
  type TranslationResponse
} from "../shared/protocol";
import { LruCache } from "../shared/cache";
import {
  M2M100_REVISION,
  M2M100_MODEL_ID,
  SMALL100_MODEL_ID,
  SMALL100_REVISION,
  TTS_MODEL_REVISION,
  createSmall100InputIds,
  isM2m100WebGpuWeightUrl
} from "../shared/models";
import { SerialTaskQueue } from "../shared/serial-queue";
import { chunkText, friendlyError } from "../shared/text";
import {
  canControlSpeech,
  chunkKoreanSpeech,
  prepareKoreanForTts,
  validateTtsAudio
} from "../shared/tts";
import { createTranslationCacheKey } from "../shared/translation-cache";

type Small100Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Small100Model = Awaited<ReturnType<typeof AutoModelForSeq2SeqLM.from_pretrained>>;
type TranslationEngine =
  | {
      kind: "small100";
      model: Small100Model;
      tokenizer: Small100Tokenizer;
    }
  | {
      kind: "m2m100";
      pipeline: TranslationPipeline;
    };

class WebGpuFallbackRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebGpuFallbackRequiredError";
  }
}

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm!.wasmPaths = chrome.runtime.getURL("wasm/");

let engine: TranslationEngine | null = null;
let enginePromise: Promise<TranslationEngine> | null = null;
let loadedDevicePreference: DevicePreference | null = null;
let loadedRuntimeDevice: RuntimeDevice | null = null;
let loadedModelPreference: ModelPreference | null = null;
let status: EngineStatus = { state: "idle", modelId: MODEL_ID };
const engineQueue = new SerialTaskQueue();
const ttsSynthesisQueue = new SerialTaskQueue();
const translationCache = new LruCache<string>(220);
let ttsEngine: TextToAudioPipeline | null = null;
let ttsEnginePromise: Promise<TextToAudioPipeline> | null = null;
let ttsStatus: TtsStatus = { state: "idle", modelId: TTS_MODEL_ID };
let speechRun = 0;
let ttsProgressRun = 0;
let activeSpeechId: string | null = null;
let audioContext: AudioContext | null = null;
let activeAudioSource: AudioBufferSourceNode | null = null;

chrome.runtime.onMessage.addListener(
  (
    message: OffscreenMessage,
    _sender,
    sendResponse: (response: unknown) => void
  ): boolean | undefined => {
    if (!message || message.target !== "offscreen") return undefined;

    if (message.type === "TRANSLATE_OFFSCREEN") {
      const task = engineQueue.run(() => translate(message));
      void task.then(sendResponse, (error) => {
        sendResponse({
          ok: false,
          requestId: message.requestId,
          code: "TRANSLATION_FAILED",
          error: friendlyError(error)
        } satisfies TranslationResponse);
      });
      return true;
    }

    if (message.type === "GET_ENGINE_STATUS_OFFSCREEN") {
      sendResponse(status);
      return false;
    }

    if (message.type === "SPEAK_KOREAN_OFFSCREEN") {
      startSpeech(message.text, message.speechId);
      sendResponse({
        ok: true,
        speechId: message.speechId
      } satisfies SpeakResponse);
      return false;
    }

    if (message.type === "GET_TTS_STATUS_OFFSCREEN") {
      sendResponse(ttsStatus);
      return false;
    }

    if (message.type === "STOP_SPEAKING_OFFSCREEN") {
      const stopped = stopSpeech({
        speechId: message.speechId
      });
      sendResponse({
        ok: true,
        speechId: message.speechId,
        stopped
      } satisfies SpeakResponse);
      return false;
    }

    if (message.type === "RESET_ENGINE_OFFSCREEN") {
      const task = engineQueue.run(async () => {
        await resetEngine();
        return status;
      });
      void task.then(sendResponse, (error) => {
        status = {
          state: "error",
          modelId: status.modelId,
          error: friendlyError(error)
        };
        broadcastStatus();
        sendResponse(status);
      });
      return true;
    }

    return undefined;
  }
);

function startSpeech(text: string, speechId: string): void {
  stopSpeech({ broadcast: false });
  const run = speechRun;
  ttsProgressRun = run;
  activeSpeechId = speechId;
  const chunks = chunkKoreanSpeech(text);
  ttsStatus = {
    state: "loading",
    modelId: TTS_MODEL_ID,
    speechId,
    progress: ttsEngine ? 1 : 0,
    file: ttsEngine ? "음성 생성 준비 중" : "한국어 음성 모델 준비 중"
  };
  broadcastTtsStatus();
  void runSpeech(chunks, run, speechId);
}

async function runSpeech(
  chunks: string[],
  run: number,
  speechId: string
): Promise<void> {
  try {
    const synthesizer = await getTtsEngine();
    if (!isCurrentSpeech(run, speechId)) return;

    let pendingOutput = synthesizeSpeechChunk(
      synthesizer,
      chunks[0],
      run,
      speechId
    );
    for (let index = 0; index < chunks.length; index += 1) {
      ttsStatus = {
        state: "synthesizing",
        modelId: TTS_MODEL_ID,
        speechId,
        progress: index / chunks.length,
        file: `${index + 1} / ${chunks.length} 구간 음성 생성 중`
      };
      broadcastTtsStatus();

      const output = await pendingOutput;
      if (!output || !isCurrentSpeech(run, speechId)) return;
      validateTtsAudio(output.audio, output.sampling_rate);

      // Start generating the following clause while the current audio plays.
      // This removes the synthesis-sized pause that previously occurred at
      // every chunk boundary.
      pendingOutput = synthesizeSpeechChunk(
        synthesizer,
        chunks[index + 1],
        run,
        speechId
      );
      ttsStatus = {
        state: "playing",
        modelId: TTS_MODEL_ID,
        speechId,
        progress: (index + 1) / chunks.length,
        file: `${index + 1} / ${chunks.length} 구간 재생 중`
      };
      broadcastTtsStatus();
      await playAudio(output.audio, output.sampling_rate, run);
      if (!isCurrentSpeech(run, speechId)) return;
    }

    activeSpeechId = null;
    ttsStatus = {
      state: "idle",
      modelId: TTS_MODEL_ID,
      speechId,
      progress: 1
    };
    broadcastTtsStatus();
  } catch (error) {
    if (!isCurrentSpeech(run, speechId)) return;
    activeSpeechId = null;
    ttsStatus = {
      state: "error",
      modelId: TTS_MODEL_ID,
      speechId,
      error: friendlyError(error)
    };
    broadcastTtsStatus();
  }
}

function synthesizeSpeechChunk(
  synthesizer: TextToAudioPipeline,
  chunk: string | undefined,
  run: number,
  speechId: string
) {
  if (!chunk) return Promise.resolve(null);
  const input = prepareKoreanForTts(chunk);
  if (!input) return Promise.resolve(null);

  const output = ttsSynthesisQueue.run(async () => {
    if (!isCurrentSpeech(run, speechId)) return null;
    return synthesizer(input, {});
  });
  // The next chunk can fail while the current audio is still playing. Attach a
  // handler immediately; awaiting the original promise still forwards the
  // error to runSpeech's catch block.
  void output.catch(() => undefined);
  return output;
}

async function getTtsEngine(): Promise<TextToAudioPipeline> {
  if (ttsEngine) return ttsEngine;
  if (ttsEnginePromise) return ttsEnginePromise;

  ttsEnginePromise = pipeline("text-to-speech", TTS_MODEL_ID, {
    revision: TTS_MODEL_REVISION,
    device: "wasm",
    dtype: "q8",
    progress_callback: (progress: Record<string, unknown>) => {
      if (
        ttsEngine ||
        progress.status === "ready" ||
        ttsProgressRun !== speechRun ||
        ttsStatus.state !== "loading"
      ) {
        return;
      }
      ttsStatus = {
        state: "loading",
        modelId: TTS_MODEL_ID,
        speechId: activeSpeechId ?? ttsStatus.speechId,
        progress: getTtsProgress(progress),
        file: typeof progress.file === "string"
          ? progress.file
          : ttsStatus.file
      };
      broadcastTtsStatus();
    }
  }).then((loaded) => {
    ttsEngine = loaded;
    return loaded;
  }).catch((error) => {
    ttsEnginePromise = null;
    throw error;
  });
  return ttsEnginePromise;
}

async function playAudio(
  samples: Float32Array,
  sampleRate: number,
  run: number
): Promise<void> {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  if (run !== speechRun) return;

  const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  activeAudioSource = source;
  await new Promise<void>((resolve) => {
    source.onended = () => {
      if (activeAudioSource === source) activeAudioSource = null;
      resolve();
    };
    source.start();
  });
}

function stopSpeech(options: {
  broadcast?: boolean;
  speechId?: string;
} = {}): boolean {
  if (!canControlSpeech(activeSpeechId, options.speechId)) return false;
  const stoppedSpeechId = activeSpeechId ?? options.speechId;
  const stopped = activeSpeechId !== null || activeAudioSource !== null;
  speechRun += 1;
  ttsProgressRun = speechRun;
  activeSpeechId = null;
  if (activeAudioSource) {
    try {
      activeAudioSource.stop();
    } catch {
      // The source may finish between the state check and stop().
    }
    activeAudioSource = null;
  }
  ttsStatus = {
    state: "idle",
    modelId: TTS_MODEL_ID,
    speechId: stoppedSpeechId
  };
  if (options.broadcast !== false) broadcastTtsStatus();
  return stopped;
}

function isCurrentSpeech(run: number, speechId: string): boolean {
  return run === speechRun && activeSpeechId === speechId;
}

function getTtsProgress(progress: Record<string, unknown>): number {
  if (typeof progress.progress === "number") {
    return Math.max(0, Math.min(1, progress.progress / 100));
  }
  if (
    typeof progress.loaded === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
  ) {
    return Math.max(0, Math.min(1, progress.loaded / progress.total));
  }
  return ttsStatus.progress ?? 0;
}

function broadcastTtsStatus(): void {
  void chrome.runtime.sendMessage({
    target: "ui",
    type: "TTS_PROGRESS",
    status: ttsStatus
  }).catch(() => undefined);
}

async function translate(request: TranslateOffscreenRequest): Promise<TranslationResponse> {
  const started = performance.now();
  const cacheKey = createTranslationCacheKey(
    request.modelPreference,
    request.devicePreference,
    request.sourceLanguage,
    request.text
  );
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return {
      ok: true,
      requestId: request.requestId,
      translation: cached,
      sourceLanguage: request.sourceLanguage,
      device: status.device ?? "wasm",
      elapsedMs: Math.round(performance.now() - started)
    };
  }

  try {
    let activeEngine = await getEngine(
      request.devicePreference,
      request.modelPreference,
      request.runtimeDeviceOverride,
      request.fallbackFromDevice,
      request.deviceFallbackReason
    );
    let translation: string;
    try {
      translation = await translateText(
        activeEngine,
        request.text,
        request.sourceLanguage
      );
    } catch (error) {
      if (
        activeEngine.kind !== "m2m100" ||
        status.device !== "webgpu" ||
        request.devicePreference === "wasm"
      ) {
        throw error;
      }
      await discardFailedM2m100WebGpuWeights();
      throw new WebGpuFallbackRequiredError(friendlyError(error));
    }
    if (!translation) throw new Error("모델이 번역 결과를 만들지 못했습니다.");
    translationCache.set(cacheKey, translation);

    return {
      ok: true,
      requestId: request.requestId,
      translation,
      sourceLanguage: request.sourceLanguage,
      device: status.device ?? "wasm",
      elapsedMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    const message = friendlyError(error);
    if (error instanceof WebGpuFallbackRequiredError) {
      status = {
        ...status,
        state: "error",
        device: "webgpu",
        error: message,
        fallbackFromDevice: "webgpu",
        deviceFallbackReason: message
      };
      broadcastStatus();
      return {
        ok: false,
        requestId: request.requestId,
        code: "DEVICE_FALLBACK_REQUIRED",
        error: message
      };
    }
    status = { ...status, state: "error", error: message };
    broadcastStatus();
    return {
      ok: false,
      requestId: request.requestId,
      code: engine ? "TRANSLATION_FAILED" : "MODEL_LOAD_FAILED",
      error: message
    };
  }
}

async function translateText(
  activeEngine: TranslationEngine,
  text: string,
  sourceLanguage: string
): Promise<string> {
  const translated: string[] = [];
  for (const chunk of chunkText(text)) {
    const result = await translateChunk(activeEngine, chunk, sourceLanguage);
    if (result) translated.push(result);
  }
  return translated.join(" ").trim();
}

async function translateChunk(
  activeEngine: TranslationEngine,
  text: string,
  sourceLanguage: string
): Promise<string> {
  const maxNewTokens = Math.min(512, Math.max(80, Math.ceil(text.length * 1.8)));
  if (activeEngine.kind === "m2m100") {
    const output = await activeEngine.pipeline(text, {
      src_lang: sourceLanguage,
      tgt_lang: "ko",
      max_new_tokens: maxNewTokens
    } as never) as Array<{ translation_text?: string }>;
    return output[0]?.translation_text?.trim() ?? "";
  }

  const encoded = await activeEngine.tokenizer(text);
  const inputData = createSmall100InputIds(
    encoded.input_ids.data as ArrayLike<number | bigint>
  );
  encoded.input_ids.dispose();
  if (encoded.attention_mask instanceof Tensor) {
    encoded.attention_mask.dispose();
  }
  const attentionData = new BigInt64Array(inputData.length);
  attentionData.fill(1n);
  const inputIds = new Tensor("int64", inputData, [1, inputData.length]);
  const attentionMask = new Tensor(
    "int64",
    attentionData,
    [1, attentionData.length]
  );

  try {
    const generated = await activeEngine.model.generate({
      input_ids: inputIds,
      attention_mask: attentionMask,
      max_new_tokens: maxNewTokens,
      num_beams: 3,
      early_stopping: true
    } as never);
    const sequences =
      generated instanceof Tensor
        ? generated
        : (generated as unknown as { sequences?: Tensor }).sequences;
    if (!(sequences instanceof Tensor)) {
      throw new Error("SMaLL-100이 올바른 토큰 결과를 만들지 못했습니다.");
    }
    try {
      const nestedIds = sequences.tolist();
      const firstSequence = Array.isArray(nestedIds[0]) ? nestedIds[0] : nestedIds;
      return activeEngine.tokenizer.decode(firstSequence, {
        skip_special_tokens: true
      }).trim();
    } finally {
      sequences.dispose();
    }
  } finally {
    inputIds.dispose();
    attentionMask.dispose();
  }
}

async function getEngine(
  devicePreference: DevicePreference,
  modelPreference: ModelPreference,
  runtimeDeviceOverride?: RuntimeDevice,
  fallbackFromDevice?: RuntimeDevice,
  deviceFallbackReason?: string
): Promise<TranslationEngine> {
  const runtimeDevice =
    modelPreference === "small100"
      ? "wasm"
      : runtimeDeviceOverride ?? chooseDevice(devicePreference);
  const samePreference =
    loadedDevicePreference === devicePreference &&
    loadedRuntimeDevice === runtimeDevice &&
    loadedModelPreference === modelPreference;
  if (engine && samePreference) return engine;
  if (enginePromise && samePreference) return enginePromise;
  if (engine || enginePromise) await resetEngine();

  loadedDevicePreference = devicePreference;
  loadedRuntimeDevice = runtimeDevice;
  loadedModelPreference = modelPreference;
  const modelId =
    modelPreference === "small100" ? SMALL100_MODEL_ID : M2M100_MODEL_ID;
  status = {
    state: "loading",
    modelId,
    device: runtimeDevice,
    progress: 0,
    fallbackFromDevice,
    deviceFallbackReason
  };
  broadcastStatus();

  enginePromise = loadRequestedEngine(
    modelPreference,
    devicePreference,
    runtimeDeviceOverride,
    fallbackFromDevice,
    deviceFallbackReason
  )
    .then((loaded) => {
      engine = loaded;
      return loaded;
    })
    .catch((error) => {
      enginePromise = null;
      throw error;
    });
  return enginePromise;
}

async function loadRequestedEngine(
  modelPreference: ModelPreference,
  devicePreference: DevicePreference,
  runtimeDeviceOverride?: RuntimeDevice,
  fallbackFromDevice?: RuntimeDevice,
  deviceFallbackReason?: string
): Promise<TranslationEngine> {
  if (modelPreference === "m2m100") {
    return loadM2m100(
      runtimeDeviceOverride ?? chooseDevice(devicePreference),
      undefined,
      undefined,
      fallbackFromDevice,
      deviceFallbackReason
    );
  }

  try {
    return await loadSmall100();
  } catch (error) {
    const fallbackReason = friendlyError(error);
    status = {
      state: "loading",
      modelId: M2M100_MODEL_ID,
      device: chooseDevice(devicePreference),
      progress: 0,
      file: "SMaLL-100을 사용할 수 없어 M2M100으로 전환 중",
      fallbackFromModelId: SMALL100_MODEL_ID,
      fallbackReason
    };
    broadcastStatus();
    const fallbackDevice =
      runtimeDeviceOverride ?? chooseDevice(devicePreference);
    loadedRuntimeDevice = fallbackDevice;
    return loadM2m100(
      fallbackDevice,
      SMALL100_MODEL_ID,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    );
  }
}

async function loadSmall100(): Promise<TranslationEngine> {
  const options: Record<string, unknown> = {
    revision: SMALL100_REVISION,
    device: "wasm",
    // The pinned files are internally int8 but intentionally use the base ONNX
    // filenames. "fp32" selects those filenames instead of *_quantized.onnx.
    dtype: "fp32"
  };

  status = {
    state: "loading",
    modelId: SMALL100_MODEL_ID,
    device: "wasm",
    progress: 0,
    file: "토크나이저 준비 중"
  };
  broadcastStatus();
  const tokenizer = await AutoTokenizer.from_pretrained(
    SMALL100_MODEL_ID,
    options as never
  );
  status = {
    state: "loading",
    modelId: SMALL100_MODEL_ID,
    device: "wasm",
    progress: 0,
    file: "약 620MB 모델 다운로드 및 초기화 중"
  };
  broadcastStatus();
  const model = await AutoModelForSeq2SeqLM.from_pretrained(
    SMALL100_MODEL_ID,
    options as never
  );
  status = {
    state: "ready",
    modelId: SMALL100_MODEL_ID,
    device: "wasm",
    progress: 1
  };
  broadcastStatus();
  return { kind: "small100", model, tokenizer };
}

async function loadM2m100(
  device: RuntimeDevice,
  fallbackFromModelId?: string,
  fallbackReason?: string,
  fallbackFromDevice?: RuntimeDevice,
  deviceFallbackReason?: string
): Promise<TranslationEngine> {
  const options: Record<string, unknown> = {
    revision: M2M100_REVISION,
    device,
    dtype: device === "webgpu" ? "q4f16" : "q8",
    progress_callback: createProgressCallback(
      M2M100_MODEL_ID,
      device,
      fallbackFromModelId,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    )
  };

  try {
    const loaded = await pipeline("translation", M2M100_MODEL_ID, options);
    status = {
      state: "ready",
      modelId: M2M100_MODEL_ID,
      device,
      progress: 1,
      fallbackFromModelId,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    };
    broadcastStatus();
    return { kind: "m2m100", pipeline: loaded };
  } catch (error) {
    if (device === "webgpu") {
      const webGpuError = friendlyError(error);
      await discardFailedM2m100WebGpuWeights();
      status = {
        state: "error",
        modelId: M2M100_MODEL_ID,
        device: "webgpu",
        error: webGpuError,
        fallbackFromModelId,
        fallbackReason,
        fallbackFromDevice: "webgpu",
        deviceFallbackReason: webGpuError
      };
      broadcastStatus();
      throw new WebGpuFallbackRequiredError(webGpuError);
    }
    enginePromise = null;
    const message = friendlyError(error);
    status = {
      state: "error",
      modelId: M2M100_MODEL_ID,
      device,
      error: message,
      fallbackFromModelId,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    };
    broadcastStatus();
    throw error;
  }
}

async function discardFailedM2m100WebGpuWeights(): Promise<void> {
  try {
    const cache = await caches.open("transformers-cache");
    const requests = await cache.keys();
    await Promise.all(
      requests
        .filter((request) => isM2m100WebGpuWeightUrl(request.url))
        .map((request) => cache.delete(request))
    );
  } catch {
    // Cache cleanup is best-effort and must not block the isolated WASM retry.
  }
}

function chooseDevice(preference: DevicePreference): RuntimeDevice {
  const hasWebGpu = "gpu" in navigator;
  if (preference === "webgpu" && !hasWebGpu) return "wasm";
  if (preference === "wasm") return "wasm";
  return hasWebGpu ? "webgpu" : "wasm";
}

function getProgress(progress: Record<string, unknown>): number {
  if (typeof progress.progress === "number") {
    return Math.max(0, Math.min(1, progress.progress / 100));
  }
  if (typeof progress.loaded === "number" && typeof progress.total === "number" && progress.total > 0) {
    return Math.max(0, Math.min(1, progress.loaded / progress.total));
  }
  return status.progress ?? 0;
}

function createProgressCallback(
  modelId: string,
  device: RuntimeDevice,
  fallbackFromModelId?: string,
  fallbackReason?: string,
  fallbackFromDevice?: RuntimeDevice,
  deviceFallbackReason?: string
): (progress: Record<string, unknown>) => void {
  return (progress) => {
    const fraction = getProgress(progress);
    status = {
      state: "loading",
      modelId,
      device,
      progress: fraction,
      file: typeof progress.file === "string" ? progress.file : status.file,
      fallbackFromModelId,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    };
    broadcastStatus();
  };
}

function broadcastStatus(): void {
  void chrome.runtime.sendMessage({
    target: "ui",
    type: "ENGINE_PROGRESS",
    status
  }).catch(() => undefined);
}

async function resetEngine(): Promise<void> {
  try {
    if (engine?.kind === "small100") {
      await engine.model.dispose();
    } else if (
      engine?.kind === "m2m100" &&
      "dispose" in engine.pipeline &&
      typeof engine.pipeline.dispose === "function"
    ) {
      await engine.pipeline.dispose();
    }
  } finally {
    engine = null;
    enginePromise = null;
    loadedDevicePreference = null;
    loadedRuntimeDevice = null;
    loadedModelPreference = null;
    translationCache.clear();
  }
  status = { state: "idle", modelId: MODEL_ID };
  broadcastStatus();
}
