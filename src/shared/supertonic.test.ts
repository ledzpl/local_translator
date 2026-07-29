import { describe, expect, it } from "vitest";
import {
  encodeSupertonicText,
  preprocessSupertonicText
} from "./supertonic";

describe("preprocessSupertonicText", () => {
  it("한국어를 NFKD로 정규화하고 언어 태그를 붙인다", () => {
    const result = preprocessSupertonicText(" 안녕하세요 😊 ", "ko");

    expect(result).toBe(`<ko>${"안녕하세요".normalize("NFKD")}.</ko>`);
  });

  it("문장 부호가 이미 있으면 마침표를 중복하지 않는다", () => {
    expect(preprocessSupertonicText("온글 AI 2026!", "ko"))
      .toBe(`<ko>${"온글".normalize("NFKD")} AI 2026!</ko>`);
  });
});

describe("encodeSupertonicText", () => {
  it("Unicode indexer를 사용해 모델 입력 ID를 만든다", () => {
    const indexer = new Array<number>(128).fill(-1);
    indexer["<".codePointAt(0)!] = 7;
    indexer["k".codePointAt(0)!] = 8;
    indexer["o".codePointAt(0)!] = 9;

    expect(encodeSupertonicText("<ko", indexer)).toEqual([7, 8, 9]);
  });

  it("indexer가 지원하지 않는 문자를 거부한다", () => {
    expect(() => encodeSupertonicText("가", []))
      .toThrow("지원하지 않는 문자");
  });
});
