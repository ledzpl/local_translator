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
  M2M100_MODEL_ID,
  SMALL100_MODEL_ID,
  SMALL100_REVISION,
  createSmall100InputIds
} from "../shared/models";
import { chunkText, friendlyError } from "../shared/text";
import { chunkKoreanSpeech, prepareKoreanForTts } from "../shared/tts";

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

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm!.wasmPaths = chrome.runtime.getURL("wasm/");

let engine: TranslationEngine | null = null;
let enginePromise: Promise<TranslationEngine> | null = null;
let loadedDevicePreference: DevicePreference | null = null;
let loadedModelPreference: ModelPreference | null = null;
let status: EngineStatus = { state: "idle", modelId: MODEL_ID };
let translationQueue: Promise<unknown> = Promise.resolve();
const translationCache = new LruCache<string>(220);
let ttsEngine: TextToAudioPipeline | null = null;
let ttsEnginePromise: Promise<TextToAudioPipeline> | null = null;
let ttsStatus: TtsStatus = { state: "idle", modelId: TTS_MODEL_ID };
let speechRun = 0;
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
      translationQueue = translationQueue
        .catch(() => undefined)
        .then(() => translate(message));
      void translationQueue.then(sendResponse);
      return true;
    }

    if (message.type === "GET_ENGINE_STATUS_OFFSCREEN") {
      sendResponse(status);
      return false;
    }

    if (message.type === "SPEAK_KOREAN_OFFSCREEN") {
      startSpeech(message.text);
      sendResponse({ ok: true } satisfies SpeakResponse);
      return false;
    }

    if (message.type === "GET_TTS_STATUS_OFFSCREEN") {
      sendResponse(ttsStatus);
      return false;
    }

    if (message.type === "STOP_SPEAKING_OFFSCREEN") {
      stopSpeech();
      sendResponse({ ok: true } satisfies SpeakResponse);
      return false;
    }

    if (message.type === "RESET_ENGINE_OFFSCREEN") {
      void resetEngine().then(() => sendResponse(status));
      return true;
    }

    return undefined;
  }
);

function startSpeech(text: string): void {
  stopSpeech(false);
  const run = speechRun;
  const chunks = chunkKoreanSpeech(text);
  ttsStatus = {
    state: "loading",
    modelId: TTS_MODEL_ID,
    progress: ttsEngine ? 1 : 0,
    file: ttsEngine ? "음성 생성 준비 중" : "한국어 음성 모델 준비 중"
  };
  broadcastTtsStatus();
  void runSpeech(chunks, run);
}

async function runSpeech(chunks: string[], run: number): Promise<void> {
  try {
    const synthesizer = await getTtsEngine();
    if (run !== speechRun) return;

    for (let index = 0; index < chunks.length; index += 1) {
      const input = prepareKoreanForTts(chunks[index]!);
      if (!input) continue;
      ttsStatus = {
        state: "synthesizing",
        modelId: TTS_MODEL_ID,
        progress: index / chunks.length,
        file: `${index + 1} / ${chunks.length} 구간 음성 생성 중`
      };
      broadcastTtsStatus();

      const output = await synthesizer(input, {});
      if (run !== speechRun) return;
      ttsStatus = {
        state: "playing",
        modelId: TTS_MODEL_ID,
        progress: (index + 1) / chunks.length,
        file: `${index + 1} / ${chunks.length} 구간 재생 중`
      };
      broadcastTtsStatus();
      await playAudio(output.audio, output.sampling_rate, run);
      if (run !== speechRun) return;
    }

    ttsStatus = { state: "idle", modelId: TTS_MODEL_ID, progress: 1 };
    broadcastTtsStatus();
  } catch (error) {
    if (run !== speechRun) return;
    ttsStatus = {
      state: "error",
      modelId: TTS_MODEL_ID,
      error: friendlyError(error)
    };
    broadcastTtsStatus();
  }
}

async function getTtsEngine(): Promise<TextToAudioPipeline> {
  if (ttsEngine) return ttsEngine;
  if (ttsEnginePromise) return ttsEnginePromise;

  ttsEnginePromise = pipeline("text-to-speech", TTS_MODEL_ID, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (progress: Record<string, unknown>) => {
      if (ttsEngine || progress.status === "ready") return;
      ttsStatus = {
        state: "loading",
        modelId: TTS_MODEL_ID,
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

function stopSpeech(broadcast = true): void {
  speechRun += 1;
  if (activeAudioSource) {
    activeAudioSource.stop();
    activeAudioSource = null;
  }
  ttsStatus = { state: "idle", modelId: TTS_MODEL_ID };
  if (broadcast) broadcastTtsStatus();
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
  const cacheKey =
    `${request.modelPreference}\u0000${request.sourceLanguage}\u0000${request.text}`;
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
    const activeEngine = await getEngine(
      request.devicePreference,
      request.modelPreference
    );
    const chunks = chunkText(request.text);
    const translated: string[] = [];

    for (const chunk of chunks) {
      const result = await translateChunk(activeEngine, chunk, request.sourceLanguage);
      if (result) translated.push(result);
    }

    const translation = translated.join(" ").trim();
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
      num_beams: 1
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
  modelPreference: ModelPreference
): Promise<TranslationEngine> {
  const samePreference =
    loadedDevicePreference === devicePreference &&
    loadedModelPreference === modelPreference;
  if (engine && samePreference) return engine;
  if (enginePromise && samePreference) return enginePromise;
  if (engine || enginePromise) await resetEngine();

  loadedDevicePreference = devicePreference;
  loadedModelPreference = modelPreference;
  const device =
    modelPreference === "small100" ? "wasm" : chooseDevice(devicePreference);
  const modelId =
    modelPreference === "small100" ? SMALL100_MODEL_ID : M2M100_MODEL_ID;
  status = { state: "loading", modelId, device, progress: 0 };
  broadcastStatus();

  enginePromise = loadRequestedEngine(modelPreference, devicePreference)
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
  devicePreference: DevicePreference
): Promise<TranslationEngine> {
  if (modelPreference === "m2m100") {
    return loadM2m100(chooseDevice(devicePreference), devicePreference);
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
    return loadM2m100(
      chooseDevice(devicePreference),
      devicePreference,
      SMALL100_MODEL_ID,
      fallbackReason
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
  preference: DevicePreference,
  fallbackFromModelId?: string,
  fallbackReason?: string
): Promise<TranslationEngine> {
  const options: Record<string, unknown> = {
    device,
    dtype: device === "webgpu" ? "q4f16" : "q8",
    progress_callback: createProgressCallback(
      M2M100_MODEL_ID,
      device,
      fallbackFromModelId,
      fallbackReason
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
      fallbackReason
    };
    broadcastStatus();
    return { kind: "m2m100", pipeline: loaded };
  } catch (error) {
    if (device === "webgpu") {
      status = {
        state: "loading",
        modelId: M2M100_MODEL_ID,
        device: "wasm",
        progress: 0,
        file: "WebGPU를 사용할 수 없어 WASM으로 전환 중",
        fallbackFromModelId,
        fallbackReason
      };
      broadcastStatus();
      return loadM2m100(
        "wasm",
        preference,
        fallbackFromModelId,
        fallbackReason
      );
    }
    enginePromise = null;
    const message = friendlyError(error);
    status = {
      state: "error",
      modelId: M2M100_MODEL_ID,
      device,
      error: message,
      fallbackFromModelId,
      fallbackReason
    };
    broadcastStatus();
    throw error;
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
  fallbackReason?: string
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
      fallbackReason
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
  if (engine?.kind === "small100") {
    await engine.model.dispose();
  } else if (
    engine?.kind === "m2m100" &&
    "dispose" in engine.pipeline &&
    typeof engine.pipeline.dispose === "function"
  ) {
    await engine.pipeline.dispose();
  }
  engine = null;
  enginePromise = null;
  loadedDevicePreference = null;
  loadedModelPreference = null;
  translationCache.clear();
  status = { state: "idle", modelId: MODEL_ID };
  broadcastStatus();
}
