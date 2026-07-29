# Chrome Web Store 이미지

`npm run store:assets`가 현재 빌드된 확장 UI 레이아웃에서 다음 PNG를 다시 생성합니다.

- `screenshot-privacy-1280x800.png` — 최초 데이터 처리 안내
- `screenshot-translator-1280x800.png` — 실제 팝업 번역 UI
- `promo-small-440x280.png` — 필수 소형 프로모션 이미지

제출 전 현재 버전 UI와 문안이 일치하는지 육안으로 확인합니다.
번역 화면은 스크린샷을 재현 가능하게 만드는 로컬 데모 상태이며 실모델
추론 결과 증거가 아닙니다. 실제 TranslateGemma WebGPU와 fallback 결과는
`npm run release:check`의 Chrome 스모크 로그로 별도 검증합니다.
생성된 `asset-manifest.json`은 확장 버전, UI 빌드 hash, 이미지 크기와
SHA-256을 기록하며 `npm run release:check`가 제출 이미지의 최신 상태를
자동으로 확인합니다.
