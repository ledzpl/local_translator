# 릴리즈 체크리스트

## 코드와 패키지

- [ ] `npm ci`
- [ ] `npm run release:check` — 타입, 단위 테스트, 정적 패키지, 실제 Chrome 기본 M2M100 `auto`·명시적 WASM, TTS 전체 재생·중지, SMaLL-100 호환 경로
- [ ] `npm run release:package` — `release/ongeul-local-translator-v<version>.zip` 생성
- [ ] ZIP 루트에 `manifest.json`이 있는지 확인
- [ ] 출력된 SHA-256을 릴리즈 기록에 보관
- [ ] `dist` 실행 번들에 jsDelivr/unpkg/원격 JS·WASM 경로와 source map이 없는지 확인
- [ ] 자동 WebGPU 폴백에서 q4f16 캐시 정리·WASM 재시도와 최대 약 1.4GB 최초 전송 안내가 일치하는지 확인

## 법적·개인정보

- [ ] `Supertone/supertonic-3` OpenRAIL-M의 사용 제한과 배포 고지 조건을 현재 제품 용도에 맞게 검토
- [ ] `PRIVACY_POLICY.md`가 공개 HTTPS URL에서 열리는지 확인
- [ ] Dashboard 개인정보 탭을 `docs/STORE_LISTING.md`와 동일하게 입력
- [ ] Website content 처리와 Limited Use 인증
- [ ] Remote code를 `No`로 선언

## 스토어 자산과 제출

- [ ] `npm run store:assets`로 1280×800 실제 UI 스크린샷과 440×280 프로모션 이미지를 갱신
- [ ] 스크린샷이 현재 버전 UI와 일치하는지 육안 확인
- [ ] 제목·요약·상세 설명·권한 설명·리뷰어 안내를 입력
- [ ] 배포 국가와 공개 범위를 확인
- [ ] 최초 제출은 deferred publishing으로 검토 완료 후 수동 공개
