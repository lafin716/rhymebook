# 모바일(원격)에서 예약·프롬프트·지식베이스 전체 관리 — 계획 (ADR-116)

## 목표
PC에 연결된 모바일·웹(원격 모드)과 PC 세션 창에서 예약 관리, 프롬프트 관리, 지식베이스 관리를 PC 메인 창과 같은 기능으로 쓴다. 휴대폰 파일 업로드도 포함한다.

## 완료 기준 (관찰 가능)
- 원격에서 예약 목록이 PC 목록과 같고, 만들기·수정·일시정지/재개·삭제·대화 열기가 PC에 반영된다. PC 시간대가 표시된다.
- 원격 프롬프트 페이지에 PC 저장본이 보이고, 저장·기본값 되돌리기·AI 도우미가 동작한다. 결과는 PC 설정에 저장된다.
- 원격 지식베이스 대화상자: 목록·만들기·이름 변경·삭제·세션 연결/해제·링크/Git 추가·항목 삭제·미리보기·설명·색인 설정·자동 색인·다시 색인·진행률·문서/출처 목록이 동작한다. 휴대폰 파일을 골라 올리면 PC 지식베이스에 들어간다.
- 옛 PC(기능 미지원)에는 "PC 앱 업데이트 필요" 안내가 나온다.
- typecheck·lint·unit·e2e 통과, 데스크톱 앱 재빌드.

## 계약 (core `bridge/syncRpc.ts`, `bridge/sync.ts`)
- 클라이언트 → 호스트: `{ type: 'sync.rpc', reqId, method, args: unknown[] }`
- 호스트 → 클라이언트: `{ type: 'sync.rpc', reqId, ok: true, data? } | { type: 'sync.rpc', reqId, ok: false, error: SyncRpcError, message? }`
- 호스트 → 전체: `{ type: 'sync.event', topic: SyncEventTopic, data? }` (`schedules`·`prompts`·`knowledge`·`knowledge.progress`·`knowledge.index`)
- 기능 플래그 `manage` (snapshot.features). 호스트에 rpc 처리기가 있을 때만 광고한다.
- 메서드 허용 목록 `SYNC_RPC_METHODS`와 인자 형태 검증 `validateRpcArgs` (main IPC가 내용 검증을 다시 한다).
- 업로드: `knowledge.upload(kbId, uploadId, name, index, total, size, dataBase64, dest?)`를 순서대로 보내고, 마지막 조각을 받으면 호스트가 `addFiles`를 부른다. 조각 512KB, 파일당 20MB, 피어당 동시 업로드 3개, 2분 동안 조각이 안 오면 버린다. 조립은 core `createUploadAssembler`(순수, Vitest).
- 호출 허용량: 피어당 10초에 120회 (act 30회와 별도).
- 삭제(지식베이스·항목)는 PC의 "원격 삭제 허용" 설정을 따른다 (세션 창은 항상 허용).

## Task Graph
| ID | 내용 | 의존 | 소유 |
|---|---|---|---|
| T1 | core 계약·검증·업로드 조립기·테스트, host/client rpc·event, 서버 검증(bridge server) | – | 리더 |
| T2 | PC 처리기 `ui/app/syncRpc.ts`(예약 repo·설정·desktop.knowledge 디스패치, 이벤트 방송) + `app/sync.ts` 연결 | T1 | 리더 |
| T3 | 원격 예약·프롬프트 UI (store 분기, 페이지 게이트 제거, PC 시간대, i18n) | T1 | agent A |
| T4 | 원격 지식베이스 API(`remoteKnowledgeApi`, 파일 선택·조각 업로드), 대화상자 게이트 제거, i18n | T1 | agent B |
| T5 | 통합·e2e·독립 리뷰·검증·문서·재빌드 | T2–T4 | 리더 |
