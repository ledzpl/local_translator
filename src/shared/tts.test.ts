import { describe, expect, it } from "vitest";
import { chunkKoreanSpeech, prepareKoreanForTts } from "./tts";

describe("prepareKoreanForTts", () => {
  it("한국어를 MMS 음성 모델이 받는 로마자 입력으로 바꾼다", () => {
    expect(prepareKoreanForTts("안녕하세요. 번역한 한국어를 읽어줍니다."))
      .toBe("annyeonghaseyo beonyeokhan hangugeoreul ilgeojumnida");
  });

  it("모델이 발음할 수 없는 문자를 제거한다", () => {
    expect(prepareKoreanForTts("온글 AI 2026!")).toBe("ongeul ai");
  });
});

describe("chunkKoreanSpeech", () => {
  it("긴 번역 결과를 문장 경계에 가까운 작은 조각으로 나눈다", () => {
    const chunks = chunkKoreanSpeech(
      `${"첫 번째 문장입니다. ".repeat(10)}${"마지막 문장입니다. ".repeat(10)}`
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 81)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toContain("마지막 문장입니다.");
  });
});
