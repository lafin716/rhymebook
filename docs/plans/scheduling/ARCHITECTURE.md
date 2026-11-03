# 예약 계약

core `schedules.ts` exports:
- `ScheduleRepeat = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly'`.
- `ScheduleInput { title: string; prompt: string; runAt: string; repeat: ScheduleRepeat }`. runAt은 명시적 offset/Z를 가진 ISO timestamp, 미래 시간.
- `Schedule { id: string; sessionId: string; title: string; prompt: string; nextRunAt: number; repeat: ScheduleRepeat; enabled: boolean; createdAt: number; updatedAt: number; sourceMessageId?: string; lastRunAt?: number; lastError?: string }`.
- `parseScheduleBlock(text: string, now?: number): ScheduleInput | null`: 단 하나의 ```schedule JSON 블록, 경계/문자열 크기/미래/반복 검증.
- `nextScheduleRun(at: number, repeat: ScheduleRepeat, now: number): number | null`: once null, 다음 실행은 now보다 미래. 로컬 달력 시간 유지, monthly 일자 clamp, 누락 회차는 건너뜀.
- `hasScheduleIntent(text: string): boolean`: 예약/알림의 명시 요청 또는 반복 날짜+작업 요청, 설명/예제/취소/부정 요청은 제외.
- `scheduleSystemHint(now?: number): string`: 현재 시간과 timezone, 위 JSON 규약, 모호한 시간/작업은 질문, 예약 성공을 주장하지 않도록 지시.

기본 `/schedule` 스킬과 자동 의도 매칭. 일반 chat request는 현재 턴 의도가 있거나 /schedule일 때만 system hint 추가. 완료 hook은 원래 사용자 메시지가 명시한 의도/스킬을 검증하고 성공한 생성 결과만 저장한다. 예약 실행 prompt에는 스케줄 생성 지시를 붙이지 않는다. 예약 작업은 기존 세션에 질문으로 보내고 AI 응답을 받음. 과거 저장 메시지나 원격 mirror의 응답 재생으로 예약을 생성하지 않는다.

core createAppStore opts에 `onResponseComplete?({ sessionId, messageId, userMessageId, content }): void` hook 추가, custom 제외, 성공 done+finish 뒤 호출, 예외는 응답 상태를 바꾸지 않음. 알림 담당 agent는 이 hook을 수정하지 않는다. UI `notifications/service.ts`의 `notifyResponseComplete(sessionId: string): void`를 리더가 호출.

예약은 기기 로컬 전용: BranchDB v7 schedules table `'id, sessionId, nextRunAt, &sourceMessageId'`와 scheduleSources table `'id'`. source message unique id를 이용한 생성 중복 방지. sourceMessageId 없는 수동 예약 허용. 삭제한 예약도 같은 원본 질문의 재시도로 되살리지 않도록 scheduleSources 영수증을 남긴다. DB transaction으로 pendingRunAt을 기록하고 완료 후 nextRunAt을 이동하거나 once를 disabled로 전환. 중복 엔진은 Web Lock으로 방지한다. 앱/웹이 열려 있을 때 실행하며 desktop hidden engine도 계속 실행(backgroundThrottling false 확인). 앱 종료/절전 동안 실행 불가, resume 시 누락 회차는 한 번 실행. 실패 시 lastError 표시, 자동 재시도 무한루프 없음. 삭제된 세션은 disabled+error. 세션 busy는 선점하지 않고 다음 tick에 대기.

원격/세션 별도 창은 scheduler engine을 시작하지 않고 예약 페이지는 이 기기 로컬 제한 안내. desktop owner의 완료 hook만 native 알림 → 세션별 창/동기화로 중복 알림 없음. 웹 remote mirrored 완료는 기존 streaming→done 전환을 구독해 기기 로컬 알림을 보낸다.

알림은 기기 로컬 preference(기본 켬), Electron main sender validation, text 길이 제한, OS notification click으로 세션 focus. 웹 권한 요청은 명시적 UI 동작에서만, 자동 permission prompt 없음. native mobile 알림 SDK 미설치이면 지원 여부를 분명히 표시하고 웹 지원 사용. 새 의존성 금지.

## 독립 검토 반영

- Schedule에 anchorDay:number(첫 실행 local day), originAt:number 추가. nextScheduleRun 4번째 optional anchorDay 인자. 반복은 실행 기기의 현재 로컬 달력 기준(기기 시간대 변경 시 새 시간대); 월말은 anchorDay로 복원.
- send extra `scheduleRun?: boolean`을 메시지에 저장, 완료 hook에도 전달; 예약 실행은 항상 true, 신규 예약 파싱/힌트 제외.
- scheduler는 Web Locks의 기기/프로필 DB별 독점 락을 보유한 탭 하나만 실행. 미지원이면 자동실행 비활성 안내. Electron은 main engine 한 개. IDB claim은 추가 방어.
- claim은 pendingRunAt:number를 기록하고 nextRunAt 이동 안 함. 결정적 user message ID `scheduled-<scheduleId>-<pendingRunAt>`로 전송. 저장된 해당 메시지가 있으면 재전송 없이 회차 advance. 부팅 시 pending 복구. send 직후 repo.flush로 영속화 확인 후 advance. crash gap의 복구는 기존 messageId 중복 방지. 편집/삭제 시 pending 변경 충돌 검증.
- 원격 완료 알림은 미러의 기존 streaming message→done 전환 구독. hydrate 신규 done는 제외, 창 초기화/재연결 재생은 제외. 동일 기기 session 창은 엔진 알림만 사용.

UI service contract `ui/schedules/store.ts`: `useSchedules` Zustand state { items: Schedule[]; loaded:boolean; error:string|null; refresh():Promise<void>; save(input:ScheduleInput,sessionId:string,id?:string):Promise<void>; remove(id:string):Promise<void>; toggle(id:string):Promise<void> }. `scheduleAvailable = !remoteMode && !sessionWindowId && !presentWindowId`. save/remove/toggle reject with user-facing Error on failure. startScheduleService():Promise<()=>void>. `handleScheduleResponse(event)` leader callback. UI page consumes only this API; leader owns store/service, page agent owns SchedulesPage.tsx and scheduleText.ts locale helper. Leader owns App/Sidebar integration and core Overlay union. Page component exports SchedulesPage, renders only overlay schedules. Page API may import getLocale for bilingual strings or new scheduleText helper.

실제 구현 리뷰 반영: 실행 전 대상 세션과 메시지를 DB 정본에서 읽어 오래된 탭의 상태를 갱신한다. 저장된 dispatch receipt가 있으면 재전송하지 않으며 중단된 streaming은 stopped로 표시한다. 일반 사용자 대화의 여러 탭 동시 전송은 이 기능의 배타 실행 범위가 아니다. 제목/작업만 바꾸는 편집은 기존 originAt/anchorDay를 보존한다.
