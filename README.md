# 온글 번역

웹 페이지 본문, 선택한 텍스트와 YouTube 자막을 한국어로 번역하고 읽어주는 Manifest V3 Chrome 확장 프로그램입니다. 기본 번역은 `@huggingface/transformers`와 `TranslateGemma 4B`를 이용해 브라우저 WebGPU에서 실행되며, WebGPU 미지원 시 `M2M100` WASM으로 자동 전환합니다. 번역할 텍스트·페이지 내용·자막과 번역 결과는 개발자나 모델 호스팅 서버로 전송되지 않습니다.

## 기능

- 작은 팝업에서 지속형 사이드 패널 작업공간을 열고, 패널을 닫아도 진행 중인 수동 번역을 다시 확인·취소
- 사이드 패널에 텍스트를 붙여넣어 한국어로 번역하고 브라우저 세션의 최근 작업 기록을 직접 삭제
- **페이지 안에 한국어 표시**를 누르면 현재 보이는 본문부터 번역하고, 스크롤에 맞춰 다음 문단을 계속 처리
- 원문+한국어·한국어만·올리면 원문 표시의 세 가지 페이지 보기 방식
- 페이지 위 진행 패널에서 번역을 중지하거나 모든 번역을 지우고 원문으로 복원
- 페이지에서 텍스트를 선택한 뒤 우클릭 또는 `Alt+Shift+K`로 바로 번역
- YouTube의 현재 표시 자막을 감지해 한국어 자막 오버레이 표시하고, 속도 우선 또는 최근 자막 문맥 우선 모드 선택
- 사용자가 원문·한국어 쌍을 등록하는 기기 로컬 용어집
- WebGPU·저장 공간 상태 확인, 번역 모델 미리 준비와 번역·음성 모델 캐시 개별 삭제
- 자동 언어 감지, TranslateGemma 4B WebGPU 기본 실행과 M2M100/SMaLL-100 호환 모델 선택
- 번역 결과의 **듣기** 버튼으로 브라우저 내 한국어 TTS 모델 음성 재생 및 정지
- 모델 파일은 Chrome Cache Storage에 저장해 재사용하고, ONNX Runtime 실행 코드는 확장 패키지에서 로컬로 로드
- 대용량 모델 캐시가 일반 웹 저장소 할당량으로 삭제되지 않도록 `unlimitedStorage`를 사용하며, 수동 번역 작업은 브라우저 세션에만 보관하고 용어집은 이 기기에만 저장
- 최초 사용 전 로컬 처리 범위, 모델 다운로드와 Chrome 설정 동기화를 명확히 안내하고 확인

## 개발 및 설치

```bash
npm ci
npm run verify
```

릴리즈 검증 환경은 `.nvmrc`의 Node 26.5.0과 `package.json`의 npm 12.0.1을
기준으로 합니다.

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 이 프로젝트의 `dist` 폴더를 선택합니다.
4. 팝업에서 **번역 작업공간 열기**를 눌러 사이드 패널을 열고 데이터 처리 안내를 확인합니다.
5. 첫 번역 때 기본 TranslateGemma 4B q4 모델 약 3.1GB를 내려받습니다. WebGPU를 사용할 수 없거나 초기화·추론이 실패하면 M2M100 WASM 약 650MB를 추가로 내려받습니다. 하드웨어 호환성 실패만으로 정상 가중치를 지우지 않으며 Chrome Cache Storage에서 다음 실행에 재사용합니다. 첫 듣기 때는 Supertonic 3 모델과 기본 음성 스타일 약 400MB를 별도로 내려받습니다.

코드를 다시 빌드한 뒤에는 `chrome://extensions`에서 **온글 번역** 카드의 새로고침 버튼을 눌러야 새 서비스 워커와 팝업 코드가 함께 적용됩니다.

## 사용 시 알아둘 점

- YouTube 번역과 자막 자동 켜기는 기본적으로 꺼져 있습니다. 사용자가 직접 켠 동안 플레이어에 실제로 표시되는 자막만 읽으며, 영상에 자막 트랙이 없으면 번역할 수 없습니다.
- 페이지 번역은 화면에 보이는 본문부터 한 번에 최대 40개·12,000자씩 처리하며, 연속 번역을 켜면 스크롤과 새로 추가된 본문을 감지해 다음 묶음을 이어서 번역합니다. `chrome://` 페이지나 Chrome 웹 스토어처럼 확장 프로그램 스크립트를 넣을 수 없는 페이지에서는 사용할 수 없습니다.
- YouTube 번역을 직접 켜면 한국어를 원문 자막과 함께 표시하는 설정이 기본이며, 원문 자막 자동 켜기는 별도로 활성화해야 합니다.
- 기본 TranslateGemma 4B는 Google이 55개 언어용으로 설명한 품질 우선 모델이며 WebGPU에서만 실행합니다. 팝업의 18개 원문 언어를 품질 검증 범위로 삼고, 고정 chat template이 허용하는 추가 자동 감지 언어도 처리합니다. template에 없는 네 언어 코드는 M2M100 WASM으로 보냅니다. WebGPU 초기화·첫 추론이 실패하거나 사용할 수 없으면 깨끗한 오프스크린 런타임을 만든 뒤 M2M100 WASM으로 전환합니다.
- M2M100 WebGPU가 빈 값·특수 토큰·문자나 숫자가 없는 비정상 결과를 만들면 그 결과를 저장하지 않고 M2M100 WASM q8로 한 번 재시도합니다. 이때 약 650MB를 추가로 내려받을 수 있고, 같은 Chrome 세션의 다음 번역도 WASM을 사용합니다. 엔진 초기화나 설정 변경 후에는 WebGPU를 다시 평가합니다. 오프스크린 엔진을 교체하는 순간 재생 중인 음성은 명시적 오류와 함께 중단될 수 있습니다.
- TranslateGemma에는 [Gemma 이용약관](https://ai.google.dev/gemma/terms)과 금지 용도 정책이 적용됩니다.
- 엔진 설정에서 실험적 SMaLL-100을 선택하면 int8 WASM 경로로 실행되며, 이 모델을 불러오지 못하면 M2M100으로 전환합니다. 일부 전문 용어는 원문 영문으로 남을 수 있습니다.
- M2M100과 SMaLL-100은 약 100개 언어를 다룹니다. 자동 감지가 불안정하면 사이드 패널에서 원문 언어를 직접 선택하세요.
- 한국어 음성은 `Supertone/supertonic-3` 모델이 브라우저의 WebGPU에서 직접 생성하고, WebGPU를 사용할 수 없거나 추론에 실패하면 WASM으로 전환합니다. 한글 원문을 직접 합성하며 긴 번역은 여러 구간으로 나누어 차례로 읽고 팝업을 닫아도 재생이 이어집니다.
- Supertonic 3 모델은 **OpenRAIL-M** 라이선스입니다. Gemma 이용약관·NOTICE와 Supertonic 모델 라이선스 전문은 배포 패키지의 `LICENSES/`에 포함됩니다.

## 데이터와 네트워크 경계

- 팝업 입력, 선택 텍스트, 사용자가 요청한 페이지 본문과 켠 동안 보이는 YouTube 자막만 기능 제공에 필요한 순간 처리합니다.
- 번역과 TTS 추론은 브라우저 안에서 실행됩니다. 원격 JavaScript 또는 WASM을 내려받아 실행하지 않습니다.
- Hugging Face에는 전체 commit SHA로 고정한 모델 설정·토크나이저·가중치 파일만 HTTPS로 요청합니다. 요청 URL에 사용자 텍스트를 넣지 않습니다.
- 가장 최근 수동 번역 작업의 원문·결과·상태는 패널 복구를 위해 `chrome.storage.session`에 Chrome 종료 또는 사용자의 기록 삭제 전까지만 보관합니다. 용어집은 `chrome.storage.local`에 이 기기에서만 보관합니다.
- 안내 확인 버전과 모델·언어·페이지 표시·자막 설정은 `chrome.storage.sync`에 보관될 수 있지만 페이지 본문·선택 텍스트·YouTube 자막은 저장하지 않습니다.
- 자세한 내용은 [개인정보처리방침](PRIVACY_POLICY.md), 모델 버전은 [모델 매니페스트](docs/MODEL_MANIFEST.md)를 확인하세요.

## 실제 Chrome 런타임 검증

Playwright용 Chromium이 설치된 개발 환경에서는 사용자 Chrome 프로필을 건드리지 않고 임시 프로필로 확장을 검증할 수 있습니다.

```bash
npx playwright install chromium
npm run test:extension
npm run test:extension:model
npm run test:extension:model:translategemma
npm run test:extension:model:m2m100
npm run test:extension:model:m2m100:wasm
npm run test:extension:model:small100
npm run test:extension:tts
npm run test:extension:page-tts
```

`test:extension`은 MV3 서비스 워커, 팝업, 오프스크린 문서와 YouTube 자막 오버레이를 확인합니다. `test:extension:model`은 기본 모델의 자동 폴백을 허용해 의미 품질을 확인하고, `test:extension:model:translategemma`는 TranslateGemma가 폴백 없이 WebGPU에서 실행된 상태로 Supertonic 음성까지 함께 로드·재생되는 기본 통합 경로를 강제합니다. `test:extension:model:m2m100` 및 `:wasm`은 경량 호환 경로를 확인합니다. `test:extension:model:small100`은 실험적 WASM 호환 모델을 검증합니다. `test:extension:tts`는 번역 모델을 미리 로드하지 않은 상태에서 두 구간 한국어를 실제로 끝까지 생성·재생하고, `test:extension:page-tts`는 M2M100 WebGPU 결과 검증과 필요한 경우 WASM 재시도, 웹 페이지 번역 결과의 콜드 로드 취소·재생·정지를 함께 검증합니다. 각 스모크 테스트는 임시 Chrome 프로필을 사용하고 완료 후 제거합니다.

각 `test:extension:*` 명령은 최신 소스를 먼저 빌드하므로 이전 `dist`를 잘못 검사하지 않습니다. 페이지 스모크는 산문형 `pre`, 커스텀 본문 태그와 현재 화면 우선순위도 검증합니다.

## 릴리즈

```bash
npm run store:assets
npm run release:package
```

`store:assets`는 실제 확장 UI 레이아웃의 개인정보 안내·번역·작업공간 1280×800 스크린샷과 440×280 프로모션 이미지를 `store-assets/`에 만들고 UI hash 매니페스트를 기록합니다. 번역 스크린샷은 재현 가능한 로컬 데모 상태이며 실모델 결과 증거는 별도 Chrome 스모크가 담당합니다. `release:package`는 타입·단위·정적 검증, 실제 Chrome 기본 TranslateGemma `WebGPU`, M2M100 명시적 WASM, 전체 TTS 재생·페이지 중지, SMaLL-100 호환 경로, npm production audit를 통과한 뒤 manifest가 루트에 있는 재현 가능한 제출 ZIP, SHA-256과 빌드 메타데이터를 `release/`에 생성하고 다시 검증합니다.

Dashboard 입력 문안과 권한 설명은 [Chrome Web Store 제출 문안](docs/STORE_LISTING.md), 수동 확인 항목은 [릴리즈 체크리스트](docs/RELEASE_CHECKLIST.md)에 있습니다. 개인정보처리방침 공개 URL과 모델별 이용 제한·재배포 조건은 제출 전에 반드시 확인해야 합니다.

## 구조

- `src/background`: 권한, 선택 텍스트, 언어 감지, 오프스크린 엔진 중계
- `src/offscreen`: Transformers.js 번역/TTS 모델 생명주기, 번역 큐와 음성 재생
- `src/content`: 페이지 본문 인라인 번역, 선택 텍스트 카드와 YouTube 자막 감지/오버레이
- `src/launcher`: 사이드 패널 열기와 현재 페이지 빠른 번역을 제공하는 작은 팝업
- `src/popup`: 지속형 사이드 패널의 페이지·텍스트 번역, 모델·용어집 및 설정 UI
