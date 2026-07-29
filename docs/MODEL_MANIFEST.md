# 릴리즈 모델 매니페스트

2026년 7월 29일 확인 기준입니다. 런타임은 `main`이 아니라 아래 전체 commit SHA를 요청합니다.

| 용도 | 모델 | Revision | 선택 파일/예상 다운로드 | 라이선스 |
|---|---|---|---|---|
| 기본 번역 | `Xenova/m2m100_418M` | `9c374f0b7aca709787cea97b047bfbbd1559d177` | WASM q8 약 650MB / WebGPU q4f16 약 750MB | upstream MIT |
| 실험적 WASM 호환 번역 | `casawolice/small100-onnx` | `5c2c73ac70bee9c58f5a7ac5e84a36bee25db8ee` | int8 ONNX, 약 620MB | upstream MIT |
| 한국어 음성 | `Supertone/supertonic-3` | `3cadd1ee6394adea1bd021217a0e650ede09a323` | ONNX 4개, 설정·Unicode indexer와 M1 음성 스타일, 약 400MB | OpenRAIL-M |

모델은 실행 코드가 아니라 고정된 설정·토크나이저·가중치 데이터입니다. ONNX Runtime JavaScript와 WASM 실행 코드는 확장 ZIP에 포함됩니다.

M2M100 자동 모드는 WebGPU q4f16을 먼저 받을 수 있습니다. 첫 추론이 실패하면 해당 q4f16 Cache Storage 항목을 정리하고 새 오프스크린 런타임에서 WASM q8을 내려받으므로, 이 폴백이 발생한 최초 실행의 네트워크 전송량은 최대 약 1.4GB가 될 수 있습니다.

Supertonic 3는 `duration_predictor.onnx`, `text_encoder.onnx`,
`vector_estimator.onnx`, `vocoder.onnx`를 WebGPU로 먼저 실행하고 지원되지
않거나 추론이 실패하면 같은 고정 가중치를 WASM으로 실행합니다. 모델 파일을
다시 변환하거나 원격 코드를 실행하지 않으며 한국어 원문은 모델 호스트로
전송하지 않습니다.
