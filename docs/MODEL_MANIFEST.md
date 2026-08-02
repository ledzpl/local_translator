# 릴리즈 모델 매니페스트

2026년 7월 29일 확인 기준입니다. 런타임은 `main`이 아니라 아래 전체 commit SHA를 요청합니다.

| 용도 | 모델 | Revision | 선택 파일/예상 다운로드 | 라이선스 |
|---|---|---|---|---|
| 기본 품질 우선 번역 | `onnx-community/translategemma-text-4b-it-ONNX` | `f7874a1ac60758872a4f78aac0df95b17b776994` | WebGPU q4 약 3.1GB | Gemma Terms |
| TranslateGemma 폴백·경량 번역 | `Xenova/m2m100_418M` | `9c374f0b7aca709787cea97b047bfbbd1559d177` | WASM q8 약 650MB / WebGPU q4f16 약 750MB | upstream MIT |
| 실험적 WASM 호환 번역 | `casawolice/small100-onnx` | `5c2c73ac70bee9c58f5a7ac5e84a36bee25db8ee` | int8 ONNX, 약 620MB | upstream MIT |
| 한국어 음성 | `Supertone/supertonic-3` | `3cadd1ee6394adea1bd021217a0e650ede09a323` | ONNX 4개, 설정·Unicode indexer와 M1 음성 스타일, 약 400MB | OpenRAIL-M |

모델은 실행 코드가 아니라 고정된 설정·토크나이저·가중치 데이터입니다. ONNX Runtime JavaScript와 WASM 실행 코드는 확장 ZIP에 포함됩니다.

기본 엔진 설정은 TranslateGemma와 WebGPU입니다. WebGPU q4를 먼저 사용하고, WebGPU를 사용할 수 없거나 초기화·첫 추론이 실패하면 새 오프스크린 런타임에서 M2M100 WASM q8을 내려받습니다. 하드웨어·메모리 제한과 파일 손상을 구분할 수 없는 일반 실행 실패에서는 3.1GB q4 캐시를 보존해 반복 다운로드를 막습니다. Google 모델 카드는 TranslateGemma를 55개 언어용으로 설명합니다. 고정 ONNX revision의 chat template은 더 많은 언어 코드를 허용하지만, UI 품질 검증 범위는 사이드 패널에 표시한 18개 원문 언어입니다. template에 없는 `ast`, `ceb`, `ilo`, `ns` 자동 감지 결과만 M2M100 WASM으로 보냅니다.

사용자가 M2M100 WebGPU를 선택한 경우 q4f16 결과를 청크별로 검사합니다. 빈 값, 모델 특수 토큰만 있는 값, 원문에 문자·숫자가 있는데 결과에는 둘 다 없는 값은 성공으로 캐시하지 않습니다. 이 오류가 WebGPU에서 발생하면 새 오프스크린 런타임에서 M2M100 WASM q8로 한 번 재시도하고, 이유를 `chrome.storage.session`에 기록해 같은 Chrome 세션에서는 WASM을 재사용합니다. 엔진 초기화나 설정 변경은 이 기록을 지웁니다. 런타임 교체가 진행 중인 음성을 중단하면 UI에 다시 듣기를 요청하는 오류를 표시합니다.

TranslateGemma 사용·재배포에는 [Gemma 이용약관](https://ai.google.dev/gemma/terms)과 금지 용도 정책이 적용됩니다. 패키지는 현재 약관 사본과 공식 NOTICE를 포함합니다. 다만 고정한 ONNX 변환 저장소의 해당 revision에는 README·license·base-model provenance 메타데이터가 없으므로, 제출 전 변환본의 배포 권한과 Google 원본 모델로부터의 provenance를 권리자 또는 법률 검토로 확정해야 합니다.

Supertonic 3는 `duration_predictor.onnx`, `text_encoder.onnx`,
`vector_estimator.onnx`, `vocoder.onnx`를 WebGPU로 먼저 실행하고 지원되지
않거나 추론이 실패하면 같은 고정 가중치를 WASM으로 실행합니다. 모델 파일을
다시 변환하거나 원격 코드를 실행하지 않으며 한국어 원문은 모델 호스트로
전송하지 않습니다.
