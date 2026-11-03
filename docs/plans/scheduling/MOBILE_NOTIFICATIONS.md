# 모바일 로컬 알림 확장

범위: 기존 응답 완료 알림을 iOS/Android 네이티브 로컬 알림으로 연결한다. 기본 켬, 명시적 권한 요청, 테스트 알림, 탭 시 해당 세션 열기. 앱 종료/OS 중지 중 서버 응답을 수신하는 push/background service는 범위 밖. 추가 의존성 없이 기존 Capacitor custom plugin 패턴을 사용한다.

Scoped feature, HIGH/ADVANCED/high 목표. 리더 inherited 모델, iOS executor와 별도 리뷰 역할도 상속(legacy 고정 모델 미지원과 이전 Sol 사용량 제한 때문에 override 없음). 기존 국제화와 예약 변경 보존.

## 계약

core MobileApi.notifications?: { status():Promise<LocalNotificationPermission>; requestPermission():Promise<LocalNotificationPermission>; show({sessionId,title,body,scope?}):Promise<boolean>; onClick(listener:(sessionId:string,scope?:string)=>void):()=>void }. permission='default'|'denied'|'granted'. UI는 desktop→mobile→browser 순으로 선택. 모바일에서는 웹 Notification으로 fallback하지 않는다.

모바일 로컬 Capacitor plugin jsName=OctoNotifications. status/requestPermission은 {permission}, show는 {shown}, takePendingClick은 {sessionId?,scope?}, notificationClick event는 알림 탭 wakeup. JS는 listener 등록 후 takePendingClick을 호출하고 event도 takePendingClick으로 전달해 중복 소비를 방지한다. 유효 세션 id(1..64 word/hyphen), title1..120, body<=240만 허용. 세션이 원격 mirror에서 아직 로드되지 않았으면 클릭 대상을 보관하고 데이터 도착 시 연다.

Android: POST_NOTIFICATIONS runtime permission(API33+), 고정 channel response-complete high importance, channel/app 차단 확인, immutable explicit PendingIntent(MainActivity/singleTask)로 클릭 전달. cold launch intent와 handleOnNewIntent 모두 처리. iOS: UNUserNotificationCenter, Capacitor notificationRouter의 local handler, foreground banner/sound, 권한만 명시요청, cold-start 클릭 보관.

알림 설정 권한 버튼은 처음에 default에서만 활성화; 거부 상태는 OS설정에서 변경 안내. 모바일 복귀 시 권한 표시 새로 확인. 완료 알림은 권한을 묻지 않으며 허용된 경우에만 전송한다. 기존 알림 기본 켬/끄기와 remote streaming→done 감지는 유지.

## 소유권/의존/검증

리더: core bridge contract, Android plugin/manifest/activity, mobile TS adapter, UI service/settings/tests, 문서/통합. iOS agent: 새 Swift plugin + 등록/프로젝트 소스목록 + 필요한 launch callback. reviewer: 읽기 전용 실제 diff 검토.

1. 계약과 기존 코드 확인 → 2. iOS/Android 독립 구현 + 공통 adapter → 3. UI 통합 → 4. 독립 리뷰 → 5. unit/typecheck/lint + mobile build/sync + Android assembleDebug/iOS simulator build + 가능한 emulator smoke → 6. 문서 갱신.

네이티브 빌드는 외부 배포가 아닌 로컬 검증. 실기기/시뮬레이터가 없거나 권한 부족이면 가능한 빌드·API 검증과 실제 배너 검증 한계를 구분한다.

공식 근거: https://capacitorjs.com/docs/ios/custom-code , https://developer.android.com/develop/ui/views/notifications/notification-permission , https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications . Capacitor API 세부는 설치된8.5.3 native source 확인.

독립 설계/소스 리뷰 반영: API33 최초 prompt를 global disabled보다 먼저 판정. 알림 생성 시 local 또는 remote:<bridgeId> scope를 저장하고 클릭 시 검증. snapshot 대기는30초로 제한하고 호스트 전환 시 취소/안내. iOS 라우터 local handler를 유지하고 SceneDelegate cold-start response를 보관. 최종 소스 리뷰에서 차단 지적 없음.
