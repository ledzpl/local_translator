import * as ort from "onnxruntime-web";

export type SupertonicDevice = "webgpu" | "wasm";

export interface SupertonicLoadProgress {
  file: string;
  current: number;
  total: number;
}

export interface SupertonicSynthesisProgress {
  step: number;
  total: number;
}

export interface SupertonicAudio {
  audio: Float32Array;
  sampling_rate: number;
}

interface SupertonicConfig {
  ae: {
    sample_rate: number;
    base_chunk_size: number;
  };
  ttl: {
    latent_dim: number;
    chunk_compress_factor: number;
  };
}

interface SerializedTensor {
  data: unknown[];
  dims: number[];
  type: "float32";
}

interface SerializedStyle {
  style_ttl: SerializedTensor;
  style_dp: SerializedTensor;
}

interface SupertonicStyle {
  ttl: ort.Tensor;
  dp: ort.Tensor;
}

const MODEL_FILES = [
  ["duration_predictor.onnx", "길이 예측기"],
  ["text_encoder.onnx", "텍스트 인코더"],
  ["vector_estimator.onnx", "음성 생성기"],
  ["vocoder.onnx", "보코더"]
] as const;

const TOTAL_STEPS = 8;
const SPEECH_SPEED = 1.05;

export function configureSupertonicRuntime(wasmBaseUrl: string): void {
  ort.env.wasm.wasmPaths = wasmBaseUrl;
  // Extension pages are not cross-origin isolated, so threaded WASM cannot be
  // used reliably. Explicit single-threading also avoids a failed worker boot.
  ort.env.wasm.numThreads = 1;
}

export class SupertonicEngine {
  readonly sampleRate: number;

  private constructor(
    readonly device: SupertonicDevice,
    private readonly config: SupertonicConfig,
    private readonly indexer: number[],
    private readonly style: SupertonicStyle,
    private readonly durationPredictor: ort.InferenceSession,
    private readonly textEncoder: ort.InferenceSession,
    private readonly vectorEstimator: ort.InferenceSession,
    private readonly vocoder: ort.InferenceSession
  ) {
    this.sampleRate = config.ae.sample_rate;
  }

  static async load(options: {
    modelBaseUrl: string;
    voiceStyleUrl: string;
    device: SupertonicDevice;
    onProgress?: (progress: SupertonicLoadProgress) => void;
  }): Promise<SupertonicEngine> {
    const { modelBaseUrl, voiceStyleUrl, device, onProgress } = options;
    const [config, indexer, style] = await Promise.all([
      fetchJson<SupertonicConfig>(`${modelBaseUrl}/tts.json`),
      fetchJson<number[]>(`${modelBaseUrl}/unicode_indexer.json`),
      loadStyle(voiceStyleUrl)
    ]);
    validateConfig(config);

    const sessions: ort.InferenceSession[] = [];
    try {
      for (let index = 0; index < MODEL_FILES.length; index += 1) {
        const [filename, label] = MODEL_FILES[index]!;
        onProgress?.({
          file: label,
          current: index,
          total: MODEL_FILES.length
        });
        sessions.push(await ort.InferenceSession.create(
          `${modelBaseUrl}/${filename}`,
          {
            executionProviders: [device],
            graphOptimizationLevel: "all"
          }
        ));
      }
      onProgress?.({
        file: "음성 모델 준비 완료",
        current: MODEL_FILES.length,
        total: MODEL_FILES.length
      });
      return new SupertonicEngine(
        device,
        config,
        indexer,
        style,
        sessions[0]!,
        sessions[1]!,
        sessions[2]!,
        sessions[3]!
      );
    } catch (error) {
      await Promise.allSettled(sessions.map((session) => session.release()));
      throw error;
    }
  }

  async synthesize(
    text: string,
    onProgress?: (progress: SupertonicSynthesisProgress) => void
  ): Promise<SupertonicAudio> {
    const processedText = preprocessSupertonicText(text, "ko");
    const textIds = encodeSupertonicText(processedText, this.indexer);
    const textIdsTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from(textIds, (value) => BigInt(value)),
      [1, textIds.length]
    );
    const textMaskTensor = new ort.Tensor(
      "float32",
      new Float32Array(textIds.length).fill(1),
      [1, 1, textIds.length]
    );

    const durationOutput = await this.durationPredictor.run({
      text_ids: textIdsTensor,
      style_dp: this.style.dp,
      text_mask: textMaskTensor
    });
    const rawDuration = Number(durationOutput.duration?.data[0]);
    const duration = rawDuration / SPEECH_SPEED;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Supertonic 3가 올바른 음성 길이를 만들지 못했습니다.");
    }

    const textEncoderOutput = await this.textEncoder.run({
      text_ids: textIdsTensor,
      style_ttl: this.style.ttl,
      text_mask: textMaskTensor
    });
    const textEmbedding = textEncoderOutput.text_emb;
    if (!textEmbedding) {
      throw new Error("Supertonic 3 텍스트 인코더의 출력이 없습니다.");
    }

    const chunkSize =
      this.config.ae.base_chunk_size *
      this.config.ttl.chunk_compress_factor;
    const requestedSamples = Math.floor(duration * this.sampleRate);
    const latentLength = Math.ceil(requestedSamples / chunkSize);
    const latentDimension =
      this.config.ttl.latent_dim *
      this.config.ttl.chunk_compress_factor;
    const latentMaskTensor = new ort.Tensor(
      "float32",
      new Float32Array(latentLength).fill(1),
      [1, 1, latentLength]
    );
    const totalStepTensor = new ort.Tensor(
      "float32",
      Float32Array.of(TOTAL_STEPS),
      [1]
    );
    let latent = createGaussianNoise(latentDimension * latentLength);

    for (let step = 0; step < TOTAL_STEPS; step += 1) {
      onProgress?.({ step: step + 1, total: TOTAL_STEPS });
      const output = await this.vectorEstimator.run({
        noisy_latent: new ort.Tensor(
          "float32",
          latent,
          [1, latentDimension, latentLength]
        ),
        text_emb: textEmbedding,
        style_ttl: this.style.ttl,
        latent_mask: latentMaskTensor,
        text_mask: textMaskTensor,
        current_step: new ort.Tensor(
          "float32",
          Float32Array.of(step),
          [1]
        ),
        total_step: totalStepTensor
      });
      const denoised = output.denoised_latent?.data;
      if (!(denoised instanceof Float32Array)) {
        throw new Error("Supertonic 3 음성 생성기의 출력이 올바르지 않습니다.");
      }
      latent = denoised;
    }

    const vocoderOutput = await this.vocoder.run({
      latent: new ort.Tensor(
        "float32",
        latent,
        [1, latentDimension, latentLength]
      )
    });
    const waveform = vocoderOutput.wav_tts?.data;
    if (!(waveform instanceof Float32Array)) {
      throw new Error("Supertonic 3 보코더의 출력이 올바르지 않습니다.");
    }

    return {
      audio: waveform.slice(0, Math.min(requestedSamples, waveform.length)),
      sampling_rate: this.sampleRate
    };
  }

  async release(): Promise<void> {
    await Promise.all([
      this.durationPredictor.release(),
      this.textEncoder.release(),
      this.vectorEstimator.release(),
      this.vocoder.release()
    ]);
  }
}

export function preprocessSupertonicText(
  text: string,
  language: "ko"
): string {
  let normalized = text.normalize("NFKD")
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu,
      ""
    )
    .replace(/[–‑—]/gu, "-")
    .replace(/[_\[\]|/#→←]/gu, " ")
    .replace(/[“”]/gu, "\"")
    .replace(/[‘’´`]/gu, "'")
    .replace(/[♥☆♡©\\]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    throw new Error("읽을 수 있는 한국어 텍스트가 없습니다.");
  }
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/u.test(normalized)) {
    normalized += ".";
  }
  return `<${language}>${normalized}</${language}>`;
}

export function encodeSupertonicText(
  text: string,
  indexer: number[]
): number[] {
  const ids = Array.from(text, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint < indexer.length ? (indexer[codePoint] ?? -1) : -1;
  });
  if (ids.some((id) => id < 0)) {
    throw new Error("Supertonic 3가 지원하지 않는 문자가 포함되어 있습니다.");
  }
  return ids;
}

function createGaussianNoise(length: number): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 2) {
    const first = Math.max(Number.EPSILON, Math.random());
    const second = Math.random();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    output[index] = magnitude * Math.cos(2 * Math.PI * second);
    if (index + 1 < length) {
      output[index + 1] = magnitude * Math.sin(2 * Math.PI * second);
    }
  }
  return output;
}

async function loadStyle(url: string): Promise<SupertonicStyle> {
  const serialized = await fetchJson<SerializedStyle>(url);
  return {
    ttl: deserializeTensor(serialized.style_ttl, "style_ttl"),
    dp: deserializeTensor(serialized.style_dp, "style_dp")
  };
}

function deserializeTensor(
  serialized: SerializedTensor,
  name: string
): ort.Tensor {
  if (
    serialized?.type !== "float32" ||
    !Array.isArray(serialized.dims) ||
    !Array.isArray(serialized.data)
  ) {
    throw new Error(`Supertonic 3 ${name} 음성 스타일이 올바르지 않습니다.`);
  }
  const data = Float32Array.from(flattenNumbers(serialized.data));
  const expectedLength = serialized.dims.reduce(
    (total, dimension) => total * dimension,
    1
  );
  if (data.length !== expectedLength) {
    throw new Error(`Supertonic 3 ${name} 음성 스타일 크기가 올바르지 않습니다.`);
  }
  return new ort.Tensor("float32", data, serialized.dims);
}

function flattenNumbers(values: unknown[]): number[] {
  const output: number[] = [];
  const stack: unknown[] = [...values].reverse();
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push(value[index]);
      }
    } else if (typeof value === "number") {
      output.push(value);
    } else {
      throw new Error("Supertonic 3 음성 스타일에 숫자가 아닌 값이 있습니다.");
    }
  }
  return output;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Supertonic 3 파일을 받지 못했습니다 (${response.status}): ${url}`
    );
  }
  return response.json() as Promise<T>;
}

function validateConfig(config: SupertonicConfig): void {
  const values = [
    config?.ae?.sample_rate,
    config?.ae?.base_chunk_size,
    config?.ttl?.latent_dim,
    config?.ttl?.chunk_compress_factor
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Supertonic 3 설정이 올바르지 않습니다.");
  }
}
