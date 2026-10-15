# 음성 입력 (IMP-16, ADR-045) 계획

## 목표
채팅 입력창에서 말로 질문한다. 전사는 **PC의 로컬 whisper.cpp**(무료·오프라인)가 하고, 웹·모바일은 페어링된 PC의 설정을 그대로 따른다.

완료 기준
- 데스크톱 설정 › 음성: 사용 토글, 모델(기본/가벼운) 선택, [모델 받기](진행률·취소·검증), 삭제.
- 켜져 있고 모델·엔진이 준비되면 입력창에 마이크 버튼이 보인다(데스크톱·웹·모바일 공통). 끄면 사라진다.
- 녹음 → 16kHz mono WAV → bridge `stt.transcribe` → 결과가 입력창에 들어가 수정 후 보낸다.
- 원격 기기는 `stt.status.get`/`stt.transcribe`만 할 수 있다(관리 불가).

## 범위 밖
- Windows/Linux whisper-cli 번들(BLOCKERS), 헤드리스 server의 STT(‘지원 안 함’ 응답), 실시간 스트리밍 전사.

## 계약
- core `bridge/protocol.ts`: `stt.status.get`, `stt.transcribe{audio(base64 WAV)}` → `stt.status{stt}`, `stt.result{text}`, `stt.error{error}`.
- core `stt.ts`(순수): 모델 카탈로그(크기·sha256), `SttStatus`/`SttState`, WAV 인코딩·리샘플, base64 검사, 전사 결과 정리.
- core `BridgeClient.sttStatus()` / `transcribe(audio)`.
- bridge `stt/engine.ts`: `createSttEngine({dir, binCandidates})` — 설정 `<dir>/settings.json`, 모델 `<dir>/models/`, 다운로드(.part→sha256→rename), whisper-cli 실행(한 번에 하나). `BridgeServerOptions.stt`.
- desktop: `DesktopApi.stt`(IPC 관리), 내장 bridge·원격 호스트 bridge가 같은 엔진을 공유. `extraResources`로 `whisper/whisper-cli` 동봉, 없으면 PATH(`brew install whisper-cpp`).
- 무음 차단: 보내기 전 30ms 구간 RMS가 모두 `STT_SILENCE_RMS`(0.003) 미만이면 보내지 않음(whisper 무음 환각 방지). 0.3초 미만도 보내지 않음.
- 권한: macOS `NSMicrophoneUsageDescription`, iOS 동일 키, Android `RECORD_AUDIO`·`MODIFY_AUDIO_SETTINGS`.

## 작업 (순서·소유: 리더 단독, 순차)
| ID | 내용 | 의존 | 난이도 | 상태 |
|---|---|---|---|---|
| V1 | core 프로토콜·stt.ts·client + 테스트 | - | MEDIUM | DONE |
| V2 | bridge SttEngine + server 처리 + 원격 검증 + 테스트 | V1 | HIGH | DONE |
| V3 | whisper-cli 빌드 스크립트 + electron-builder extraResources | - | MEDIUM | DONE |
| V4 | desktop IPC/preload/main/host 연결, 마이크 권한 | V2 | MEDIUM | DONE |
| V5 | UI: 설정 음성 탭, 원격 설정 상태, Composer 마이크·녹음 | V1,V4 | MEDIUM | DONE |
| V6 | 모바일 권한(iOS/Android) | - | LOW | DONE |
| V7 | 검증(typecheck/lint/test/e2e) + 앱 빌드 + 실제 모델 받기·전사 | 전부 | - | DONE |
| V8 | 독립 리뷰 → 수정 → 문서(ADR-045, PROGRESS, BLOCKERS) → 커밋 | V7 | - | DONE |

모델: 현재 세션 모델(Claude Opus 5.5)을 상속, 리뷰는 별도 에이전트.
