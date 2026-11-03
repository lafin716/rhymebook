# 모바일 로컬 알림 검증

2026-11-03. Android/iOS 로컬 custom Capacitor plugin으로 구현, 새 의존성 없음. 권한을 완료 응답에서 자동 요청하지 않는다. 네이티브 알림의 생성·권한·탭은 MobileApi를 통해 기존 서비스에 연결된다.

## 확인한 결과

- PASS: 독립 설계 및 실제 소스 리뷰. API33 최초 prompt/global disable 구분, scope와 cold-start 처리 반영, 최종 소스에서 차단 버그 지적 없음.
- PASS: 알림 전용17 tests (service9 + mobile adapter/navigation8). 권한 default/grant/deny, mobile 우선 전달과 browser fallback 차단, 끄기, native 실패, cold/live 단일 소비, listener 정리, 다른 프로필/PC 거절, snapshot 대기/30초 만료/호스트 전환 취소.
- PASS: core682, UI104 전체 테스트. /tmp/mobile-notifications-core-tests.log, /tmp/mobile-notifications-ui-tests.log.
- PASS: 전체 typecheck/lint. /tmp/mobile-notifications-typecheck-verified.log, /tmp/mobile-notifications-lint-verified.log.
- PASS: mobile web build 및 cap sync. /tmp/mobile-notifications-web-build.log, /tmp/mobile-notifications-sync-final.log.
- PASS: iOS simulator native source build arm64/x86_64. /tmp/mobile-notifications-ios-build.log, 결과 /tmp/octobooks-mobile-notifications-ios/Build/Products/Debug-iphonesimulator/App.app. 이후 empty takePendingClick 결과를 {}로 맞춘 최종 Swift 소스도 sandbox 안 swiftc -typecheck PASS: /tmp/mobile-notifications-swift-typecheck.log.
- PASS: Android 최종 Java 소스(LocalNotificationsPlugin/MainActivity)를 Android36 SDK, 실제 Capacitor/AndroidX 캐시 클래스로 sandbox 안 javac compile. /tmp/octobooks-mobile-java-check/result.log. 새 resource 이름은 XML과 대조하고 Java 검사에서는 임시 R 상수를 사용했다. 이것은 AAPT/APK 빌드 증거가 아니다.
- PASS: plist/project 문법 및 git diff --check.

## 최초 검증 당시 미완료 항목 (후속 릴리즈 검증으로 해소 중)

최신 웹 리소스를 포함한 Android assembleDebug/iOS 통합 최종 빌드, emulator/simulator 설치, 실제 OS 권한 창/배너 및 warm/cold tap smoke. Android emulator-5554와 iOS17 iPhone15Pro 시뮬레이터가 있는 것은 확인했으나 설치/알림 테스트를 실행하지 못했다.

자동 승인 검토가 사용량 한도로 require_escalated 명령을 거절했다. 메시지: “Automatic approval review failed: You’ve hit your usage limit … The action was not executed because automatic approval review could not be completed. This is a review failure, not a determination that the action is unsafe.” 거절된 명령은 ./gradlew assembleDebug, 최종 xcodebuild, 전체 pnpm test(로컬 포트가 필요한 bridge/relay 포함). 승인 검토를 우회하지 않았으며, 제한된 sandbox 안에서 가능한 읽기/소스 컴파일/테스트를 수행했다.

## 재개 명령

검토 한도/실행 환경 복구 뒤:

1. `pnpm --filter @branch/mobile sync`
2. `pnpm --filter @branch/mobile build:android`
3. `pnpm --filter @branch/mobile build:ios-sim`
4. 격리 테스트 프로필로 설치하고 최초 default→권한 허용/거부, 테스트 알림/완료 알림 배너, warm/cold tap, 다른 PC 알림, 알림 끄기를 검증한다.

특히 앱이 OS에 의해 중지된 동안 새로운 응답을 수신하는 push/background service를 구현한 것으로 해석하지 않는다. 기존 데스크톱/웹 예약과 알림 검증 기록은 VALIDATION.md에 별도로 보존했다.

## 주요 파일

- apps/mobile/android/app/src/main/java/dev/branchlearn/app/LocalNotificationsPlugin.java
- apps/mobile/ios/App/App/LocalNotifications.swift
- apps/mobile/src/notifications.ts 및 platform.ts
- packages/core/src/bridge/desktop.ts의 MobileNotifications
- packages/ui/src/notifications/{service,navigation,NotificationSettings}
- packages/ui/test/{notifications,mobileNotifications}.test.ts

공식 API 근거: [Capacitor local plugin](https://capacitorjs.com/docs/ios/custom-code), [Android notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission), [Apple notification permission](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications).

## v0.48.0 릴리즈 전 추가 검증

이전 자동 승인 검토 제한은 해소됐다. 최종 소스로 Android assembleDebug와 iOS simulator 통합 빌드가 PASS했고, Android 에뮬레이터에 설치해 native status default → 실제 OS 권한 창 → granted → show=true → 알림 카드 표시를 확인했다. 알림 클릭이 sessionId/scope를 한 번 전달하고 pending이 비는 것도 확인했다. 앱 프로세스를 종료한 뒤 알림으로 새 PID가 실행되고 native pending이 소비되는 cold-start 경로도 확인했다.

증거: /tmp/release-android-final-build.log, /tmp/release-ios-final-build.log, /tmp/release-android-notification-shade.png, /tmp/release-android-cold-start.png. Android 버전 0.48.0/code55, iOS0.48.0/build25. iOS는 simulator 빌드·설치·실행까지 확인했으며 OS 권한 창·실제 배너·탭은 직접 확인하지 않았다. Android cold-start 후 다른 scope 안내 토스트 자체는 캡처 시점에 보이지 않아 이를 성공 증거로 주장하지 않는다. scope별 이동/대기/만료는 unit tests에서 별도로 검증됐다.
