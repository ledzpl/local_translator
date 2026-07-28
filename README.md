# 온글 번역

웹 페이지 본문, 선택한 텍스트와 YouTube 자막을 한국어로 번역하는 Manifest V3 Chrome 확장 프로그램입니다. 기본 번역은 `@huggingface/transformers`와 int8 `SMaLL-100`을 이용해 브라우저의 WASM에서 실행되며, 호환성 폴백으로 `M2M100`을 선택할 수 있습니다. 입력 텍스트는 번역 서버로 전송되지 않습니다.

## 기능

- 팝업에 텍스트를 붙여넣어 한국어로 번역
- 팝업에서 **페이지 안에 한국어 표시**를 누르면 외국어 본문 바로 아래에 번역과 **듣기** 버튼 표시
- 페이지 위 진행 패널에서 번역을 중지하거나 모든 번역을 지우고 원문으로 복원
- 페이지에서 텍스트를 선택한 뒤 우클릭 또는 `Alt+Shift+K`로 바로 번역
- YouTube의 현재 표시 자막을 감지해 한국어 자막 오버레이 표시
- 자동 언어 감지, SMaLL-100 int8 WASM 기본 실행과 M2M100 선택형 WebGPU 가속
- 번역 결과의 **듣기** 버튼으로 브라우저 내 한국어 TTS 모델 음성 재생 및 정지
- 모델과 ONNX Runtime을 Chrome Cache Storage에 저장해 재사용

## 개발 및 설치

```bash
npm install
npm run verify
```

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 이 프로젝트의 `dist` 폴더를 선택합니다.
4. 첫 번역 때 기본 SMaLL-100 int8 모델 파일 약 620MB를 내려받습니다. 첫 듣기 때는 한국어 MMS-TTS int8 모델 약 40MB를 별도로 내려받습니다. 두 모델은 이후 Chrome 캐시에서 재사용됩니다.

코드를 다시 빌드한 뒤에는 `chrome://extensions`에서 **온글 번역** 카드의 새로고침 버튼을 눌러야 새 서비스 워커와 팝업 코드가 함께 적용됩니다.

## 사용 시 알아둘 점

- YouTube 번역은 플레이어에 실제로 표시되는 자막을 읽습니다. 영상에 자막 트랙이 없으면 번역할 수 없습니다.
- 페이지 번역은 화면에 보이는 본문부터 최대 40개·12,000자까지 순서대로 처리합니다. `chrome://` 페이지나 Chrome 웹 스토어처럼 확장 프로그램 스크립트를 넣을 수 없는 페이지에서는 사용할 수 없습니다.
- 기본값은 자막 버튼을 자동으로 켜고 원문 위에 한국어 자막을 표시합니다.
- 기본 SMaLL-100은 검증된 int8 WASM 경로로 실행됩니다. SMaLL-100을 불러오지 못하면 자동으로 M2M100으로 전환합니다.
- 엔진 설정에서 M2M100을 직접 선택하면 WebGPU 또는 WebGPU 우선 자동 모드를 사용할 수 있으며, WebGPU 초기화 실패 시 WASM으로 전환합니다.
- 두 모델 모두 100개 언어를 다룹니다. 자동 감지가 불안정하면 팝업에서 원문 언어를 직접 선택하세요.
- 한국어 음성은 `Xenova/mms-tts-kor` 모델이 브라우저의 WASM에서 직접 생성합니다. 긴 번역은 여러 구간으로 나누어 차례로 읽으며 팝업을 닫아도 재생이 이어집니다.
- MMS-TTS 모델은 **CC BY-NC 4.0** 라이선스이므로 상업적 배포 전에는 모델 사용 조건을 확인해야 합니다.

## 실제 Chrome 런타임 검증

Playwright용 Chromium이 설치된 개발 환경에서는 사용자 Chrome 프로필을 건드리지 않고 임시 프로필로 확장을 검증할 수 있습니다.

```bash
npx playwright install chromium
npm run test:extension
npm run test:extension:model
npm run test:extension:model:m2m100
npm run test:extension:tts
npm run test:extension:page-tts
```

`test:extension`은 MV3 서비스 워커, 팝업, 오프스크린 문서와 YouTube 자막 오버레이를 확인합니다. `test:extension:model`은 기본 SMaLL-100을 임시 프로필에 받아 팝업 텍스트, 서로 다른 YouTube 자막, 일반 웹 페이지 본문을 실제 WASM으로 번역하고 실제 엔진 ID도 확인합니다. `test:extension:model:m2m100`은 수동 M2M100 폴백 경로를 같은 방식으로 검증합니다. `test:extension:tts`는 팝업에서 한국어 MMS-TTS 모델을 실제로 내려받아 음성 생성·재생·정지 상태를 확인하고, `test:extension:page-tts`는 웹 페이지에 삽입된 번역 결과의 듣기 버튼으로 같은 과정을 검증합니다. 각 스모크 테스트는 임시 Chrome 프로필을 사용하고 완료 후 제거합니다.

## 구조

- `src/background`: 권한, 선택 텍스트, 언어 감지, 오프스크린 엔진 중계
- `src/offscreen`: Transformers.js 번역/TTS 모델 생명주기, 번역 큐와 음성 재생
- `src/content`: 페이지 본문 인라인 번역, 선택 텍스트 카드와 YouTube 자막 감지/오버레이
- `src/popup`: 페이지 번역 제어, 텍스트 번역 및 확장 프로그램 설정 UI
