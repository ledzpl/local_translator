# Third-party notices

온글 번역은 다음 오픈소스 소프트웨어와 모델을 사용합니다. npm 버전은
`package-lock.json`에 고정된 브라우저 런타임 의존성을 기준으로 합니다.

- [Transformers.js 3.8.1](https://github.com/huggingface/transformers.js) —
  Apache License 2.0
- Transformers.js 웹 번들에 포함된
  [Hugging Face Jinja 0.5.9](https://github.com/huggingface/huggingface.js/tree/main/packages/jinja) —
  MIT License
- [ONNX Runtime Common 1.21.0과 ONNX Runtime Web/Common
  1.22.0-dev.20250409-89f8206ba4](https://github.com/microsoft/onnxruntime) —
  MIT License
- ONNX Runtime Web 패키지가 선언해 함께 설치되는 브라우저 런타임 의존성:
  [FlatBuffers 25.9.23](https://github.com/google/flatbuffers) 및
  [long 5.3.2](https://github.com/dcodeIO/long.js) — Apache License 2.0;
  [guid-typescript 1.0.9](https://github.com/snico-dev/guid-typescript) — ISC License;
  [platform 1.3.6](https://github.com/bestiejs/platform.js) — MIT License;
  [protobuf.js 7.6.5](https://github.com/protobufjs/protobuf.js)와
  `@protobufjs/*` 런타임 헬퍼 — BSD 3-Clause License
- [SMaLL-100](https://huggingface.co/alirezamsh/small100) 및
  [Transformers.js용 int8 ONNX 변환본](https://huggingface.co/casawolice/small100-onnx) — upstream MIT License
- [M2M100 418M](https://huggingface.co/facebook/m2m100_418M) 및
  [Transformers.js용 ONNX 변환본](https://huggingface.co/Xenova/m2m100_418M) — upstream MIT License
- Supertone의 [Supertonic 브라우저 추론 코드](https://github.com/supertone-inc/supertonic/tree/main/web) —
  MIT License; [Supertonic 3 모델](https://huggingface.co/Supertone/supertonic-3) —
  [OpenRAIL-M](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE).
  온글 번역은 공식 브라우저 구현을 TypeScript 실행 구조에 맞게 적용하고, 공식
  ONNX 가중치와 M1 음성 스타일을 고정 revision에서 그대로 내려받아 WebGPU 또는
  WASM으로 실행하며 모델을 추가 수정하지 않습니다.

확장 패키지의 `LICENSES/`에는 위 브라우저 런타임과 Supertonic 추론 코드의
Apache 2.0, MIT, ISC 및 BSD 3-Clause 라이선스 전문과 저작권 고지가 포함됩니다.
ONNX Runtime Web 번들 안에 보존된 Google 기여 코드의 Apache 2.0 고지도 그대로
유지됩니다.
Node 전용 선택 의존성인 `onnxruntime-node`와 `sharp`는 확장 실행 번들에 포함하지
않습니다.

모델 가중치는 확장 패키지에 포함하지 않고 사용 시 고정된 revision에서
내려받습니다. 각 구성요소의 저작권과 추가 조건은 링크된 원본 저장소 및 모델
카드의 고지를 따릅니다.
