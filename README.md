# 온글 번역

웹 페이지 본문, 선택한 텍스트와 YouTube 자막을 한국어로 번역하고 읽어주는 Manifest V3 Chrome 확장 프로그램입니다. 기본 번역은 `@huggingface/transformers`와 `M2M100`을 이용해 브라우저의 WASM 또는 WebGPU에서 실행되며, 실험적 WASM 호환 모델로 int8 `SMaLL-100`을 선택할 수 있습니다. 번역할 텍스트·페이지 내용·자막과 번역 결과는 개발자나 모델 호스팅 서버로 전송되지 않습니다.

## 기능

- 팝업에 텍스트를 붙여넣어 한국어로 번역
- 팝업에서 **페이지 안에 한국어 표시**를 누르면 외국어 본문 바로 아래에 번역과 **듣기** 버튼 표시
- 페이지 위 진행 패널에서 번역을 중지하거나 모든 번역을 지우고 원문으로 복원
- 페이지에서 텍스트를 선택한 뒤 우클릭 또는 `Alt+Shift+K`로 바로 번역
- YouTube의 현재 표시 자막을 감지해 한국어 자막 오버레이 표시
- 자동 언어 감지, M2M100 WASM/WebGPU 기본 실행과 SMaLL-100 int8 WASM 선택
- 번역 결과의 **듣기** 버튼으로 브라우저 내 한국어 TTS 모델 음성 재생 및 정지
- 모델 파일은 Chrome Cache Storage에 저장해 재사용하고, ONNX Runtime 실행 코드는 확장 패키지에서 로컬로 로드
- 최초 사용 전 로컬 처리 범위, 모델 다운로드와 Chrome 설정 동기화를 명확히 안내하고 확인

## 개발 및 설치

```bash
npm install
npm run verify
```

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 이 프로젝트의 `dist` 폴더를 선택합니다.
4. 팝업에서 데이터 처리 안내를 확인하고 동의합니다.
5. 첫 번역 때 기본 M2M100 모델 파일을 WASM에서는 약 650MB, WebGPU에서는 약 750MB 내려받습니다. WebGPU 실패 후 자동 폴백하면 두 경로를 순차 다운로드해 최초 전송량이 최대 약 1.4GB가 될 수 있으며, 실패한 WebGPU 가중치는 확장 Cache Storage에서 정리합니다. 첫 듣기 때는 한국어 MMS-TTS int8 모델 약 40MB를 별도로 내려받습니다. 성공한 경로의 모델은 이후 Chrome 캐시에서 재사용됩니다.

코드를 다시 빌드한 뒤에는 `chrome://extensions`에서 **온글 번역** 카드의 새로고침 버튼을 눌러야 새 서비스 워커와 팝업 코드가 함께 적용됩니다.

## 사용 시 알아둘 점

- YouTube 번역과 자막 자동 켜기는 기본적으로 꺼져 있습니다. 사용자가 직접 켠 동안 플레이어에 실제로 표시되는 자막만 읽으며, 영상에 자막 트랙이 없으면 번역할 수 없습니다.
- 페이지 번역은 화면에 보이는 본문부터 최대 40개·12,000자까지 순서대로 처리합니다. `chrome://` 페이지나 Chrome 웹 스토어처럼 확장 프로그램 스크립트를 넣을 수 없는 페이지에서는 사용할 수 없습니다.
- YouTube 번역을 직접 켜면 한국어를 원문 자막과 함께 표시하는 설정이 기본이며, 원문 자막 자동 켜기는 별도로 활성화해야 합니다.
- 기본 M2M100은 자동 모드에서 WebGPU를 우선 사용하고, 초기화·첫 추론이 실패하거나 WebGPU를 사용할 수 없으면 깨끗한 오프스크린 런타임을 다시 만든 뒤 WASM으로 전환합니다.
- 엔진 설정에서 실험적 SMaLL-100을 선택하면 int8 WASM 경로로 실행되며, 이 모델을 불러오지 못하면 M2M100으로 전환합니다. 일부 전문 용어는 원문 영문으로 남을 수 있습니다.
- 두 모델 모두 100개 언어를 다룹니다. 자동 감지가 불안정하면 팝업에서 원문 언어를 직접 선택하세요.
- 한국어 음성은 `Xenova/mms-tts-kor` 모델이 브라우저의 WASM에서 직접 생성합니다. 긴 번역은 여러 구간으로 나누어 차례로 읽으며 팝업을 닫아도 재생이 이어집니다.
- MMS-TTS 모델은 **CC BY-NC 4.0** 라이선스이므로 상업적 배포 전에는 모델 사용 조건을 확인해야 합니다.

## 데이터와 네트워크 경계

- 팝업 입력, 선택 텍스트, 사용자가 요청한 페이지 본문과 켠 동안 보이는 YouTube 자막만 기능 제공에 필요한 순간 처리합니다.
- 번역과 TTS 추론은 브라우저 안에서 실행됩니다. 원격 JavaScript 또는 WASM을 내려받아 실행하지 않습니다.
- Hugging Face에는 전체 commit SHA로 고정한 모델 설정·토크나이저·가중치 파일만 HTTPS로 요청합니다. 요청 URL에 사용자 텍스트를 넣지 않습니다.
- 안내 확인 버전과 모델·언어·자막 설정은 `chrome.storage.sync`에 보관될 수 있지만 페이지 내용과 번역 결과는 저장하지 않습니다.
- 자세한 내용은 [개인정보처리방침](PRIVACY_POLICY.md), 모델 버전은 [모델 매니페스트](docs/MODEL_MANIFEST.md)를 확인하세요.

## 실제 Chrome 런타임 검증

Playwright용 Chromium이 설치된 개발 환경에서는 사용자 Chrome 프로필을 건드리지 않고 임시 프로필로 확장을 검증할 수 있습니다.

```bash
npx playwright install chromium
npm run test:extension
npm run test:extension:model
npm run test:extension:model:m2m100:wasm
npm run test:extension:model:small100
npm run test:extension:tts
npm run test:extension:page-tts
```

`test:extension`은 MV3 서비스 워커, 팝업, 오프스크린 문서와 YouTube 자막 오버레이를 확인합니다. `test:extension:model`은 기본 `auto` 설정의 M2M100을 임시 프로필에 받아 핵심 의미와 실제 엔진·장치를 확인합니다. `test:extension:model:m2m100:wasm`은 M2M100의 명시적 WASM 경로를, `test:extension:model:small100`은 실험적 WASM 호환 모델을 검증합니다. `test:extension:tts`는 두 구간 한국어를 실제로 끝까지 생성·재생하고, `test:extension:page-tts`는 웹 페이지 번역 결과의 콜드 로드 취소·재생·정지를 검증합니다. 각 스모크 테스트는 임시 Chrome 프로필을 사용하고 완료 후 제거합니다.

각 `test:extension:*` 명령은 최신 소스를 먼저 빌드하므로 이전 `dist`를 잘못 검사하지 않습니다. 페이지 스모크는 산문형 `pre`, 커스텀 본문 태그와 현재 화면 우선순위도 검증합니다.

## 릴리즈

```bash
npm run store:assets
npm run release:package
```

`store:assets`는 실제 확장 UI의 1280×800 스크린샷과 440×280 프로모션 이미지를 `store-assets/`에 만듭니다. `release:package`는 타입·단위·정적 검증, 실제 Chrome 기본 M2M100 `auto`와 명시적 WASM, 전체 TTS 재생·페이지 중지, SMaLL-100 호환 경로, npm production audit를 통과한 뒤 manifest가 루트에 있는 제출 ZIP과 SHA-256 파일을 `release/`에 생성합니다.

Dashboard 입력 문안과 권한 설명은 [Chrome Web Store 제출 문안](docs/STORE_LISTING.md), 수동 확인 항목은 [릴리즈 체크리스트](docs/RELEASE_CHECKLIST.md)에 있습니다. 개인정보처리방침 공개 URL과 TTS의 비상업 라이선스 조건은 제출 전에 반드시 확인해야 합니다.

## 구조

- `src/background`: 권한, 선택 텍스트, 언어 감지, 오프스크린 엔진 중계
- `src/offscreen`: Transformers.js 번역/TTS 모델 생명주기, 번역 큐와 음성 재생
- `src/content`: 페이지 본문 인라인 번역, 선택 텍스트 카드와 YouTube 자막 감지/오버레이
- `src/popup`: 페이지 번역 제어, 텍스트 번역 및 확장 프로그램 설정 UI
