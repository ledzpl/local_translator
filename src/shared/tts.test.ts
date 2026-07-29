import { describe, expect, it } from "vitest";
import {
  canControlSpeech,
  chunkKoreanSpeech,
  isSpeechStatusFor,
  prepareKoreanForTts,
  shouldMarkSpeechIdle,
  validateTtsAudio
} from "./tts";

describe("prepareKoreanForTts", () => {
  it("한국어를 MMS 음성 모델이 받는 로마자 입력으로 바꾼다", () => {
    expect(prepareKoreanForTts("안녕하세요. 번역한 한국어를 읽어줍니다."))
      .toBe("annyeonghaseyo beonyeokhan hangugeoreul ilgeojumnida");
  });

  it("영문과 숫자를 버리지 않고 읽을 수 있는 입력으로 만든다", () => {
    expect(prepareKoreanForTts("온글 AI 2026!")).toBe("ongeul ai iyeongiyuk");
  });
});

describe("chunkKoreanSpeech", () => {
  it("서로 이어지는 짧은 문장은 한 음성 구간으로 유지한다", () => {
    expect(chunkKoreanSpeech(
      "첫 문장입니다. 이어지는 문장도 자연스럽게 읽습니다."
    )).toEqual([
      "첫 문장입니다. 이어지는 문장도 자연스럽게 읽습니다."
    ]);
  });

  it("긴 번역 결과를 문장과 구 경계에 맞춘 구간으로 나눈다", () => {
    const chunks = chunkKoreanSpeech(
      `${"첫 번째 문장입니다. ".repeat(10)}${"마지막 문장입니다. ".repeat(10)}`
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 36)).toBe(true);
    expect(chunks[0]).toMatch(/[.!?。！？]$/u);
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toContain("마지막 문장입니다.");
  });

  it("경계가 없는 긴 텍스트도 모델 입력 상한에 맞게 자른다", () => {
    const chunks = chunkKoreanSpeech("가".repeat(80));
    expect(chunks).toEqual([
      "가".repeat(24),
      "가".repeat(24),
      "가".repeat(32)
    ]);
  });
});

describe("speech ownership", () => {
  it("does not let an old UI session stop a replacement speech", () => {
    expect(canControlSpeech("speech-b", "speech-a")).toBe(false);
    expect(canControlSpeech("speech-b", "speech-b")).toBe(true);
    expect(canControlSpeech("speech-b")).toBe(true);
  });

  it("matches progress only to the UI session that started it", () => {
    const status = {
      state: "playing" as const,
      modelId: "tts-model",
      speechId: "speech-b"
    };
    expect(isSpeechStatusFor(status, "speech-a")).toBe(false);
    expect(isSpeechStatusFor(status, "speech-b")).toBe(true);
    expect(isSpeechStatusFor(status, null)).toBe(false);
  });

  it("does not let a stale stop acknowledgement erase replacement status", () => {
    expect(shouldMarkSpeechIdle(
      "speech-a",
      "speech-a",
      true,
      true
    )).toBe(true);
    expect(shouldMarkSpeechIdle(
      "speech-a",
      "speech-a",
      true,
      false
    )).toBe(false);
    expect(shouldMarkSpeechIdle(
      "speech-b",
      "speech-a",
      true,
      true
    )).toBe(false);
  });
});

describe("validateTtsAudio", () => {
  it("accepts finite audible samples and reports their duration", () => {
    const samples = Float32Array.from(
      { length: 1_600 },
      (_, index) => Math.sin(index / 10) * 0.1
    );
    expect(validateTtsAudio(samples, 16_000)).toEqual({
      durationSeconds: 0.1,
      rms: expect.any(Number)
    });
  });

  it("rejects empty, silent, and non-finite output", () => {
    expect(() => validateTtsAudio(new Float32Array(), 16_000)).toThrow();
    expect(() => validateTtsAudio(new Float32Array(1_600), 16_000)).toThrow(
      "무음"
    );
    const invalid = new Float32Array(1_600);
    invalid[10] = Number.NaN;
    expect(() => validateTtsAudio(invalid, 16_000)).toThrow("손상된");
  });
});
