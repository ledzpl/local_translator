import {
  AutoModelForSeq2SeqLM,
  AutoTokenizer,
  Tensor,
  env,
  pipeline,
  type TextGenerationPipeline,
  type TranslationPipeline
} from "@huggingface/transformers";
import {
  MODEL_ID,
  TTS_MODEL_ID,
  type DevicePreference,
  type EngineStatus,
  type ModelCacheStatus,
  type ModelPreference,
  type OffscreenMessage,
  type RuntimeDevice,
  type SpeakResponse,
  type TtsStatus,
  type TranslateOffscreenRequest,
  type TranslationResponse
} from "../shared/protocol";
import { LruCache } from "../shared/cache";
import { supportsTranslateGemmaLanguage } from "../shared/languages";
import {
  ALL_TRANSLATION_MODEL_IDS,
  liveTranslationModelIds,
  selectedTranslationModelIdsForClear,
  shouldResetEngineForModelCacheClear,
  translationModelIdForPreference
} from "../shared/model-cache";
import {
  M2M100_REVISION,
  M2M100_MODEL_ID,
  SMALL100_MODEL_ID,
  SMALL100_REVISION,
  TRANSLATEGEMMA_MODEL_ID,
  TRANSLATEGEMMA_REVISION,
  TTS_VOICE_STYLE,
  createSmall100InputIds,
  getTtsModelFileUrl
} from "../shared/models";
import { SerialTaskQueue } from "../shared/serial-queue";
import { AsyncTeardownBarrier } from "../shared/async-teardown";
import {
  MODEL_CACHE_NAME as SUPERTONIC_MODEL_CACHE_NAME,
  SupertonicEngine,
  clearSupertonicModelCache,
  configureSupertonicRuntime,
  shouldRefreshSupertonicCache
} from "../shared/supertonic";
import {
  chunkText,
  friendlyError,
  hasUsableTranslationOutput
} from "../shared/text";
import { shouldRetryTranslationOnWasm } from "../shared/translation-recovery";
import {
  type ActiveSpeechEngine,
  canControlSpeech,
  chunkKoreanSpeech,
  prepareKoreanForTts,
  synthesizeWithSpeechEngineFallback,
  validateTtsAudio
} from "../shared/tts";
import { createTranslationCacheKey } from "../shared/translation-cache";
import {
  TaskCancelledError,
  runCancellableTasks
} from "../shared/cancellable-tasks";
import {
  createGlossarySignature,
  protectGlossaryTerms,
  restoreGlossaryTerms
} from "../shared/glossary";
import {
  createContextualTranslationInput,
  extractContextualTranslation
} from "../shared/translation-context";
import { CancellableRequestRegistry } from "../shared/cancellable-requests";

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
    }
  | {
      kind: "translategemma";
      pipeline: TextGenerationPipeline;
    };

class WebGpuFallbackRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebGpuFallbackRequiredError";
  }
}

class TranslationOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationOutputError";
  }
}

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm!.wasmPaths = chrome.runtime.getURL("wasm/");
configureSupertonicRuntime(chrome.runtime.getURL("wasm/"));

let engine: TranslationEngine | null = null;
let enginePromise: Promise<TranslationEngine> | null = null;
let loadedDevicePreference: DevicePreference | null = null;
let loadedRuntimeDevice: RuntimeDevice | null = null;
let loadedModelPreference: ModelPreference | null = null;
let status: EngineStatus = { state: "idle", modelId: MODEL_ID };
// ONNX Runtime WebGPU sessions share one adapter/device in this offscreen
// realm. Serialize model loading, translation, reset, and TTS synthesis so a
// page translation cannot dispatch GPU work at the same time as speech.
const runtimeQueue = new SerialTaskQueue();
const modelCacheQueue = new SerialTaskQueue();
const translationCache = new LruCache<string>(220);
const translationRequestRegistry = new CancellableRequestRegistry();
let ttsEngine: SupertonicEngine | null = null;
let ttsEnginePromise: Promise<SupertonicEngine> | null = null;
let ttsEngineLoadGeneration = 0;
let ttsEngineAbortController: AbortController | null = null;
const ttsEngineTeardown = new AsyncTeardownBarrier();
let forceTtsWasm = false;
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

    if (message.type === "PING_OFFSCREEN") {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "TRANSLATE_OFFSCREEN") {
      translationRequestRegistry.start(message.requestId);
      const task = runtimeQueue.run(() => translate(message));
      void task.then(
        (response) => {
          translationRequestRegistry.finish(message.requestId);
          sendResponse(response);
        },
        (error) => {
          translationRequestRegistry.finish(message.requestId);
          sendResponse({
            ok: false,
            requestId: message.requestId,
            code: "TRANSLATION_FAILED",
            error: friendlyError(error)
          } satisfies TranslationResponse);
        }
      );
      return true;
    }

    if (message.type === "CANCEL_TRANSLATION_OFFSCREEN") {
      const accepted = translationRequestRegistry.cancel(message.requestId);
      sendResponse({ ok: true, accepted, requestId: message.requestId });
      return false;
    }

    if (message.type === "GET_ENGINE_STATUS_OFFSCREEN") {
      sendResponse(status);
      return false;
    }

    if (message.type === "PREPARE_MODEL_OFFSCREEN") {
      const task = runtimeQueue.run(async () => {
        await getEngine(
          message.devicePreference,
          message.modelPreference,
          message.runtimeDeviceOverride,
          message.fallbackFromDevice,
          message.deviceFallbackReason
        );
        return status;
      });
      void task.then(sendResponse, (error) => {
        status = {
          ...status,
          state: "error",
          error: friendlyError(error)
        };
        broadcastStatus();
        sendResponse(status);
      });
      return true;
    }

    if (message.type === "GET_MODEL_CACHE_STATUS_OFFSCREEN") {
      void getModelCacheStatus().then(sendResponse, (error) => {
        sendResponse({
          cachedModelIds: [],
          ttsCached: false,
          error: friendlyError(error)
        } satisfies ModelCacheStatus);
      });
      return true;
    }

    if (message.type === "CLEAR_MODEL_CACHE_OFFSCREEN") {
      const task = modelCacheQueue.run(async () => {
        await clearSelectedModelCache(
          message.modelPreference,
          message.includeTts === true,
          message.includeTranslation !== false
        );
        return getModelCacheStatus();
      });
      void task.then(sendResponse, (error) => {
        sendResponse({
          cachedModelIds: [],
          ttsCached: false,
          error: friendlyError(error)
        } satisfies ModelCacheStatus);
      });
      return true;
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
      const task = runtimeQueue.run(async () => {
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
    // Keep the cancellable model download/session setup outside the inference
    // queue. A stopped cold TTS request must not block an already-ready
    // translation engine for several minutes while its files finish loading.
    const activeSynthesizer: ActiveSpeechEngine<SupertonicEngine> = {
      current: await getTtsEngine()
    };
    if (!isCurrentSpeech(run, speechId)) return;

    let pendingOutput = synthesizeSpeechChunk(
      activeSynthesizer,
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
        activeSynthesizer,
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
  activeSynthesizer: ActiveSpeechEngine<SupertonicEngine>,
  chunk: string | undefined,
  run: number,
  speechId: string
) {
  if (!chunk) return Promise.resolve(null);
  const input = prepareKoreanForTts(chunk);
  if (!input) return Promise.resolve(null);

  const onProgress = ({ step, total }: { step: number; total: number }) => {
    if (!isCurrentSpeech(run, speechId)) return;
    ttsStatus = {
      state: "synthesizing",
      modelId: TTS_MODEL_ID,
      speechId,
      progress: step / total,
      file: `Supertonic 3 음성 생성 ${step} / ${total}단계`
    };
    broadcastTtsStatus();
  };
  const synthesize = (engine: SupertonicEngine) =>
    runtimeQueue.run(async () => {
      if (!isCurrentSpeech(run, speechId)) return null;
      return engine.synthesize(input, onProgress);
    });

  const output = (async () => {
    return synthesizeWithSpeechEngineFallback(
      activeSynthesizer,
      synthesize,
      async (synthesizer, error) => {
        if (!isCurrentSpeech(run, speechId)) throw error;
        forceTtsWasm = true;
        await runtimeQueue.run(async () => {
          if (
            !isCurrentSpeech(run, speechId) ||
            ttsEngine !== synthesizer
          ) {
            return;
          }
          ttsEngine = null;
          ttsEnginePromise = null;
          await synthesizer.release();
        });
        if (!isCurrentSpeech(run, speechId)) throw error;
        ttsStatus = {
          state: "loading",
          modelId: TTS_MODEL_ID,
          speechId,
          progress: 0,
          file: "WebGPU 추론 실패, WASM으로 다시 준비 중"
        };
        broadcastTtsStatus();
        // Engine loading must happen outside an active runtimeQueue task because
        // session creation is itself serialized through runtimeQueue.
        const wasmSynthesizer = await getTtsEngine();
        if (!isCurrentSpeech(run, speechId)) throw error;
        return wasmSynthesizer;
      }
    );
  })();
  // The next chunk can fail while the current audio is still playing. Attach a
  // handler immediately; awaiting the original promise still forwards the
  // error to runSpeech's catch block.
  void output.catch(() => undefined);
  return output;
}

async function getTtsEngine(): Promise<SupertonicEngine> {
  await ttsEngineTeardown.wait();
  if (ttsEngine) return ttsEngine;
  if (ttsEnginePromise) return ttsEnginePromise;

  const modelBaseUrl = getTtsModelFileUrl("onnx");
  const voiceStyleUrl = getTtsModelFileUrl(
    `voice_styles/${TTS_VOICE_STYLE}.json`
  );
  const loadGeneration = ++ttsEngineLoadGeneration;
  const abortController = new AbortController();
  ttsEngineAbortController = abortController;
  const reportProgress = (
    device: "webgpu" | "wasm",
    progress: { file: string; current: number; total: number }
  ) => {
    if (
      ttsEngine ||
      ttsProgressRun !== speechRun ||
      ttsStatus.state !== "loading"
    ) {
      return;
    }
    ttsStatus = {
      state: "loading",
      modelId: TTS_MODEL_ID,
      speechId: activeSpeechId ?? ttsStatus.speechId,
      progress: progress.current / progress.total,
      file: `${progress.file} (${device === "webgpu" ? "WebGPU" : "WASM"})`
    };
    broadcastTtsStatus();
  };
  const load = (device: "webgpu" | "wasm") => SupertonicEngine.load({
    modelBaseUrl,
    voiceStyleUrl,
    device,
    signal: abortController.signal,
    onProgress: (progress) => reportProgress(device, progress),
    // Network/cache reads stay outside this queue. Only ORT session creation
    // and inference share the GPU serialization boundary with translation.
    runSessionCreate: (task) => runtimeQueue.run(task),
    runSessionRelease: (task) => runtimeQueue.run(task)
  });

  ttsEnginePromise = (async () => {
    if (!forceTtsWasm && "gpu" in navigator) {
      try {
        return await load("webgpu");
      } catch (error) {
        if (abortController.signal.aborted) throw error;
        if (ttsProgressRun === speechRun && ttsStatus.state === "loading") {
          ttsStatus = {
            ...ttsStatus,
            progress: 0,
            file: "WebGPU 실패, WASM 음성 모델로 전환 중"
          };
          broadcastTtsStatus();
        }
      }
    }
    try {
      return await load("wasm");
    } catch (error) {
      if (abortController.signal.aborted) throw error;
      // A malformed Cache Storage response otherwise poisons every retry.
      // Delete the fixed-revision TTS cache only after both the preferred path
      // and WASM fail, then retry WASM exactly once.
      if (!shouldRefreshSupertonicCache(error)) throw error;
      await clearSupertonicModelCache();
      if (ttsProgressRun === speechRun && ttsStatus.state === "loading") {
        ttsStatus = {
          ...ttsStatus,
          progress: 0,
          file: "음성 모델 캐시를 정리하고 다시 받는 중"
        };
        broadcastTtsStatus();
      }
      return load("wasm");
    }
  })().then(async (loaded) => {
    if (
      abortController.signal.aborted ||
      loadGeneration !== ttsEngineLoadGeneration
    ) {
      await runtimeQueue.run(() => loaded.release());
      throw new DOMException("음성 모델 준비를 취소했습니다.", "AbortError");
    }
    ttsEngine = loaded;
    return loaded;
  });
  const activePromise = ttsEnginePromise;
  void activePromise.then(
    () => {
      if (ttsEnginePromise === activePromise) ttsEnginePromise = null;
      if (ttsEngineAbortController === abortController) {
        ttsEngineAbortController = null;
      }
    },
    () => {
      if (ttsEnginePromise === activePromise) ttsEnginePromise = null;
      if (ttsEngineAbortController === abortController) {
        ttsEngineAbortController = null;
      }
    }
  );
  return activePromise;
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

function broadcastTtsStatus(): void {
  void chrome.runtime.sendMessage({
    target: "ui",
    type: "TTS_PROGRESS",
    status: ttsStatus
  }).catch(() => undefined);
}

async function translate(request: TranslateOffscreenRequest): Promise<TranslationResponse> {
  const started = performance.now();
  if (translationRequestRegistry.isCancelled(request.requestId)) {
    return cancelledTranslationResponse(request.requestId);
  }
  const glossarySignature = createGlossarySignature(request.glossary);
  const cacheKey = createTranslationCacheKey(
    request.modelPreference,
    request.devicePreference,
    request.sourceLanguage,
    request.text,
    request.context,
    glossarySignature
  );
  const cached = translationCache.get(cacheKey);
  if (cached) {
    markEngineReadyAfterTranslation();
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
    const fallbackFromModelId =
      request.modelPreference === "translategemma" &&
      !supportsTranslateGemmaLanguage(request.sourceLanguage)
        ? TRANSLATEGEMMA_MODEL_ID
        : undefined;
    const fallbackReason = fallbackFromModelId
      ? `${request.sourceLanguage} 언어는 TranslateGemma 템플릿에서 지원하지 않아 ` +
        "M2M100을 사용합니다."
      : undefined;
    const runtimeModelPreference = fallbackFromModelId
      ? "m2m100"
      : request.modelPreference;
    const runtimeDeviceOverride = fallbackFromModelId
      ? "wasm"
      : request.runtimeDeviceOverride;
    let activeEngine = await getEngine(
      request.devicePreference,
      runtimeModelPreference,
      runtimeDeviceOverride,
      request.fallbackFromDevice,
      request.deviceFallbackReason,
      fallbackFromModelId,
      fallbackReason
    );
    if (translationRequestRegistry.isCancelled(request.requestId)) {
      return cancelledTranslationResponse(request.requestId);
    }
    const protectedValue = protectGlossaryTerms(request.text, request.glossary);
    const contextualInput = createContextualTranslationInput(
      protectedValue.text,
      request.context
    );
    let translation = await translateTextWithDeviceRecovery(
      activeEngine,
      contextualInput.text,
      request
    );
    if (translationRequestRegistry.isCancelled(request.requestId)) {
      return cancelledTranslationResponse(request.requestId);
    }
    const contextualResult = extractContextualTranslation(
      translation,
      contextualInput.marker
    );
    if (contextualResult === null) {
      if (translationRequestRegistry.isCancelled(request.requestId)) {
        return cancelledTranslationResponse(request.requestId);
      }
      // The context marker can be lost by a model. The plain retry must use
      // the same WebGPU recovery policy as the first inference; otherwise a
      // failure here bypasses the M2M100 WASM fallback entirely.
      translation = await translateTextWithDeviceRecovery(
        activeEngine,
        protectedValue.text,
        request
      );
    } else {
      translation = contextualResult;
    }
    translation = restoreGlossaryTerms(translation, protectedValue.replacements);
    if (translationRequestRegistry.isCancelled(request.requestId)) {
      return cancelledTranslationResponse(request.requestId);
    }
    if (!translation) throw new Error("모델이 번역 결과를 만들지 못했습니다.");
    translationCache.set(cacheKey, translation);
    markEngineReadyAfterTranslation();

    return {
      ok: true,
      requestId: request.requestId,
      translation,
      sourceLanguage: request.sourceLanguage,
      device: status.device ?? "wasm",
      elapsedMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    if (translationRequestRegistry.isCancelled(request.requestId)) {
      return cancelledTranslationResponse(request.requestId);
    }
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

async function translateTextWithDeviceRecovery(
  activeEngine: TranslationEngine,
  text: string,
  request: TranslateOffscreenRequest
): Promise<string> {
  try {
    return await translateText(
      activeEngine,
      text,
      request.sourceLanguage,
      () => translationRequestRegistry.isCancelled(request.requestId)
    );
  } catch (error) {
    if (error instanceof TaskCancelledError) throw error;
    if (!shouldRetryTranslationOnWasm({
      engineKind: activeEngine.kind,
      runtimeDevice: status.device,
      devicePreference: request.devicePreference
    })) {
      throw error;
    }
    throw new WebGpuFallbackRequiredError(friendlyError(error));
  }
}

function cancelledTranslationResponse(requestId: string): TranslationResponse {
  return {
    ok: false,
    requestId,
    code: "TRANSLATION_CANCELLED",
    error: "번역을 취소했습니다."
  };
}

async function translateText(
  activeEngine: TranslationEngine,
  text: string,
  sourceLanguage: string,
  isCancelled: () => boolean
): Promise<string> {
  const translated = await runCancellableTasks(
    chunkText(text),
    async (chunk) => {
      const result = await translateChunk(activeEngine, chunk, sourceLanguage);
      if (!hasUsableTranslationOutput(chunk, result)) {
        const modelName =
          activeEngine.kind === "translategemma"
            ? "TranslateGemma"
            : activeEngine.kind === "m2m100"
              ? "M2M100"
              : "SMaLL-100";
        throw new TranslationOutputError(
          `${modelName}이 올바른 번역 결과를 만들지 못했습니다.`
        );
      }
      return result;
    },
    isCancelled
  );
  return translated.join(" ").trim();
}

async function translateChunk(
  activeEngine: TranslationEngine,
  text: string,
  sourceLanguage: string
): Promise<string> {
  const maxNewTokens = Math.min(512, Math.max(80, Math.ceil(text.length * 1.8)));
  if (activeEngine.kind === "translategemma") {
    const messages = [{
      role: "user",
      content: [{
        type: "text",
        source_lang_code: sourceLanguage,
        target_lang_code: "ko",
        text
      }]
    }];
    const output = await activeEngine.pipeline(messages as never, {
      max_new_tokens: maxNewTokens,
      do_sample: false
    } as never) as unknown as Array<{
      generated_text?: string | Array<{ role?: string; content?: string }>;
    }>;
    const generated = output[0]?.generated_text;
    const result =
      typeof generated === "string"
        ? generated.trim()
        : generated
          ?.findLast((message) => message.role === "assistant")
          ?.content?.trim() ?? "";
    if (!result) {
      throw new TranslationOutputError(
        "TranslateGemma가 빈 번역 결과를 만들었습니다."
      );
    }
    return result;
  }

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
  deviceFallbackReason?: string,
  fallbackFromModelId?: string,
  fallbackReason?: string
): Promise<TranslationEngine> {
  const runtimeDevice =
    modelPreference === "small100"
      ? "wasm"
      : runtimeDeviceOverride ?? chooseDevice(devicePreference);
  const samePreference =
    loadedDevicePreference === devicePreference &&
    loadedRuntimeDevice === runtimeDevice &&
    loadedModelPreference === modelPreference;
  if (engine && samePreference) {
    status = {
      ...status,
      fallbackFromModelId,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason,
      error: undefined
    };
    return engine;
  }
  if (enginePromise && samePreference) return enginePromise;
  if (engine || enginePromise) await resetEngine();

  loadedDevicePreference = devicePreference;
  loadedRuntimeDevice = runtimeDevice;
  loadedModelPreference = modelPreference;
  const modelId = translationModelIdForPreference(modelPreference);
  status = {
    state: "loading",
    modelId,
    device: runtimeDevice,
    progress: 0,
    fallbackFromModelId,
    fallbackReason,
    fallbackFromDevice,
    deviceFallbackReason
  };
  broadcastStatus();

  enginePromise = loadRequestedEngine(
    modelPreference,
    devicePreference,
    runtimeDeviceOverride,
    fallbackFromDevice,
    deviceFallbackReason,
    fallbackFromModelId,
    fallbackReason
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
  deviceFallbackReason?: string,
  fallbackFromModelId?: string,
  fallbackReason?: string
): Promise<TranslationEngine> {
  if (modelPreference === "m2m100") {
    return loadM2m100(
      runtimeDeviceOverride ?? chooseDevice(devicePreference),
      fallbackFromModelId,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    );
  }

  if (modelPreference === "translategemma") {
    const requestedDevice =
      runtimeDeviceOverride ?? chooseDevice(devicePreference);
    if (requestedDevice === "webgpu") {
      return loadTranslateGemma(
        fallbackFromDevice,
        deviceFallbackReason
      );
    }

    const fallbackReason =
      deviceFallbackReason ??
      "TranslateGemma 4B는 WebGPU가 필요해 M2M100 WASM을 사용합니다.";
    status = {
      state: "loading",
      modelId: M2M100_MODEL_ID,
      device: "wasm",
      progress: 0,
      file: "M2M100 WASM 호환 모델로 전환 중",
      fallbackFromModelId: TRANSLATEGEMMA_MODEL_ID,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    };
    broadcastStatus();
    return loadM2m100(
      "wasm",
      TRANSLATEGEMMA_MODEL_ID,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    );
  }

  try {
    return await loadSmall100();
  } catch (error) {
    const fallbackReason = friendlyError(error);
    // SMaLL-100 is a WASM-only preference, so getEngine always keys its cached
    // engine on "wasm". Loading the fallback on WebGPU instead left that key
    // permanently mismatched, which tore down and re-downloaded M2M100 on every
    // later request.
    const fallbackDevice: RuntimeDevice = "wasm";
    status = {
      state: "loading",
      modelId: M2M100_MODEL_ID,
      device: fallbackDevice,
      progress: 0,
      file: "SMaLL-100을 사용할 수 없어 M2M100으로 전환 중",
      fallbackFromModelId: SMALL100_MODEL_ID,
      fallbackReason
    };
    broadcastStatus();
    return loadM2m100(
      fallbackDevice,
      SMALL100_MODEL_ID,
      fallbackReason,
      fallbackFromDevice,
      deviceFallbackReason
    );
  }
}

async function loadTranslateGemma(
  fallbackFromDevice?: RuntimeDevice,
  deviceFallbackReason?: string
): Promise<TranslationEngine> {
  const options: Record<string, unknown> = {
    revision: TRANSLATEGEMMA_REVISION,
    device: "webgpu",
    dtype: "q4",
    progress_callback: createProgressCallback(
      TRANSLATEGEMMA_MODEL_ID,
      "webgpu",
      undefined,
      undefined,
      fallbackFromDevice,
      deviceFallbackReason
    )
  };

  try {
    const loaded = await pipeline(
      "text-generation",
      TRANSLATEGEMMA_MODEL_ID,
      options
    );
    status = {
      state: "ready",
      modelId: TRANSLATEGEMMA_MODEL_ID,
      device: "webgpu",
      progress: 1,
      fallbackFromDevice,
      deviceFallbackReason
    };
    broadcastStatus();
    return { kind: "translategemma", pipeline: loaded };
  } catch (error) {
    const webGpuError = friendlyError(error);
    status = {
      state: "error",
      modelId: TRANSLATEGEMMA_MODEL_ID,
      device: "webgpu",
      error: webGpuError,
      fallbackFromDevice: "webgpu",
      deviceFallbackReason: webGpuError
    };
    broadcastStatus();
    throw new WebGpuFallbackRequiredError(webGpuError);
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
    // ORT 1.26's extended QDQ optimizer rejects this older, reviewed M2M100
    // conversion even though the graph itself remains executable.
    session_options: { graphOptimizationLevel: "basic" },
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

function markEngineReadyAfterTranslation(): void {
  if (!engine || status.state === "ready") return;
  status = {
    ...status,
    state: "ready",
    progress: 1,
    file: undefined,
    error: undefined
  };
  broadcastStatus();
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
      engine &&
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

async function getModelCacheStatus(): Promise<ModelCacheStatus> {
  const cachedModelIds = new Set<string>();
  const cacheNames = await caches.keys();
  for (const cacheName of cacheNames) {
    if (cacheName === SUPERTONIC_MODEL_CACHE_NAME) continue;
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    for (const request of requests) {
      for (const modelId of ALL_TRANSLATION_MODEL_IDS) {
        if (request.url.includes(`/${modelId}/resolve/`)) cachedModelIds.add(modelId);
      }
    }
  }
  return {
    cachedModelIds: [...cachedModelIds],
    ttsCached: cacheNames.includes(SUPERTONIC_MODEL_CACHE_NAME)
  };
}

async function clearSelectedModelCache(
  preference: ModelPreference | undefined,
  includeTts: boolean,
  includeTranslation: boolean
): Promise<void> {
  if (includeTts) {
    await ttsEngineTeardown.run(() => clearSelectedModelCacheWithTts(
      preference,
      includeTranslation
    ));
    return;
  }

  await runtimeQueue.run(() => clearSelectedModelCacheAfterTtsSettled(
    preference,
    false,
    includeTranslation
  ));
}

async function clearSelectedModelCacheWithTts(
  preference: ModelPreference | undefined,
  includeTranslation: boolean
): Promise<void> {
  stopSpeech({ broadcast: false });
  const pendingLoad = ttsEnginePromise;
  ttsEngineLoadGeneration += 1;
  ttsEngineAbortController?.abort();
  ttsEngineAbortController = null;

  // A load can still be waiting for a serialized ORT session create/release.
  // Wait outside runtimeQueue so teardown can use that queue without a cycle.
  await pendingLoad?.catch(() => undefined);
  ttsEnginePromise = null;

  await runtimeQueue.run(() => clearSelectedModelCacheAfterTtsSettled(
    preference,
    true,
    includeTranslation
  ));
}

async function clearSelectedModelCacheAfterTtsSettled(
  preference: ModelPreference | undefined,
  includeTts: boolean,
  includeTranslation: boolean
): Promise<void> {
  const selectedIds = selectedTranslationModelIdsForClear({
    preference,
    includeTranslation
  });
  if (shouldResetEngineForModelCacheClear({
    preference,
    includeTranslation,
    liveModelIds: currentLiveTranslationModelIds()
  })) {
    await resetEngine();
  }
  for (const cacheName of await caches.keys()) {
    if (cacheName === SUPERTONIC_MODEL_CACHE_NAME) continue;
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    await Promise.all(requests
      .filter((request) => selectedIds.some((modelId) =>
        request.url.includes(`/${modelId}/resolve/`)
      ))
      .map((request) => cache.delete(request)));
  }
  if (includeTts) {
    const engineToRelease = ttsEngine;
    ttsEngine = null;
    let releaseError: unknown;
    try {
      await engineToRelease?.release();
    } catch (error) {
      releaseError = error;
    }
    forceTtsWasm = false;
    ttsStatus = { state: "idle", modelId: TTS_MODEL_ID };
    await clearSupertonicModelCache();
    broadcastTtsStatus();
    if (releaseError) throw releaseError;
  }
  translationCache.clear();
}

function currentLiveTranslationModelIds(): string[] {
  return liveTranslationModelIds({
    loadedModelPreference,
    engineKind: engine?.kind ?? null,
    loadInFlight: Boolean(engine || enginePromise),
    statusModelId: status.modelId ?? null
  });
}
