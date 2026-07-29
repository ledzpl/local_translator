# 릴리즈 체크리스트

> **Fail-closed 규칙:** 아래 항목 중 하나라도 미완료이거나 증거를 보관하지
> 못했으면 스토어에 제출·승인·공개하지 않습니다. 특히 모델 provenance와
> 배포 권한, 공개 개인정보처리방침, clean worktree 산출물, 개발자 계정
> 검증은 자동 테스트 통과로 대체할 수 없습니다.

## 코드와 패키지

- [ ] `.nvmrc`의 Node 26.5.0과 `package.json`의 npm 12.0.1 사용
- [ ] `npm ci`
- [ ] `npm run release:check` — 타입, 단위 테스트, 정적 패키지, 현재 UI와 스토어 이미지 hash 일치, 실제 Chrome 기본 TranslateGemma `WebGPU`, M2M100 명시적 WASM, TTS 전체 재생·중지, SMaLL-100 호환 경로
- [ ] `npm run release:package` — `release/ongeul-local-translator-v<version>.zip` 생성
- [ ] ZIP 루트에 `manifest.json`이 있는지 확인
- [ ] `(cd release && shasum -a 256 -c ongeul-local-translator-v0.1.0.zip.sha256)` 통과
- [ ] `npm run release:verify` — ZIP·checksum·metadata·현재 `dist` entry hash와 스토어 자산 hash 일치
- [ ] `.metadata.json`의 commit, dirty 상태, Node/npm, lockfile hash와 ZIP entry hash를 릴리즈 기록에 보관
- [ ] 최종 소스를 커밋한 뒤 clean worktree에서 같은 버전 ZIP을 다시 만들고 SHA-256 기록
- [ ] `dist` 실행 번들에 jsDelivr/unpkg/원격 JS·WASM 경로와 source map이 없는지 확인
- [ ] 기본 TranslateGemma WebGPU 실패 시 q4 캐시 보존과 M2M100 WASM 전환 안내가 일치하는지 확인
- [ ] M2M100 WebGPU 비정상 출력에서 q8 WASM 1회 재시도, 세션 fallback 재사용·reset, WebGPU 캐시 보존과 TTS 중단 안내를 확인

## 법적·개인정보

- [ ] 고정 ONNX TranslateGemma 변환본의 Google 원본 provenance와 배포 권한을 권리자 또는 법률 검토로 확인
- [ ] 현재 Gemma 이용약관·금지 용도 정책과 패키지의 약관 사본·NOTICE가 일치하는지 확인
- [ ] `Supertone/supertonic-3` OpenRAIL-M의 사용 제한과 배포 고지 조건을 현재 제품 용도에 맞게 검토
- [ ] 최종 `PRIVACY_POLICY.md`를 커밋·푸시한 뒤 공개 HTTPS URL의 내용/hash가 릴리즈와 같은지 확인
- [ ] Dashboard 개인정보 탭을 `docs/STORE_LISTING.md`와 동일하게 입력
- [ ] `Website content`와 `Personal communications`를 선언하고 로컬 처리 설명 입력
- [ ] Website content 처리와 Limited Use 인증
- [ ] Remote code를 `No`로 선언

## 스토어 자산과 제출

- [ ] `npm run store:assets`로 1280×800 실제 UI 스크린샷과 440×280 프로모션 이미지를 갱신
- [ ] 스크린샷이 현재 버전 UI와 일치하는지 육안 확인
- [ ] 제목·요약·상세 설명·권한 설명·리뷰어 안내를 입력
- [ ] 기본 언어 `ko`, 성인용 콘텐츠 `No`, 128px 아이콘, 스크린샷 2장과 440×280 타일을 등록
- [ ] Publisher name·연락처 이메일 인증·Google 2단계 인증 완료
- [ ] 실제 운영 주체에 맞는 Trader/Non-Trader 선언과 필요한 검증 완료
- [ ] 배포 국가와 공개 범위를 확인
- [ ] 최초 제출은 deferred publishing으로 검토 완료 후 수동 공개

## 승인 후 공개 직전

- [ ] 스토어에 승인·업로드된 ZIP의 버전과 SHA-256이 릴리즈 기록과 일치
- [ ] 공개 개인정보처리방침의 내용/hash가 승인된 릴리즈 기록과 일치
- [ ] TranslateGemma 변환본 provenance·배포 권한 검토 결과와 적용 약관을 다시 확인
- [ ] Publisher 연락처·2단계 인증·Trader 상태가 여전히 유효
- [ ] 승인된 스토어 문안·스크린샷·프로모션 이미지가 기록한 asset hash와 일치
- [ ] 위 항목을 모두 확인한 담당자가 deferred publishing을 수동 공개
