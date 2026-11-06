# StatefulSet 상태 유지 워크로드

StatefulSet은 데이터베이스나 메시지 브로커처럼 파드마다 고유한 정체성이 필요한 앱에 쓴다.
파드 이름이 `db-0`, `db-1`처럼 순서대로 정해지고, 다시 만들어져도 같은 이름과 같은 볼륨을 받는다.

## Deployment와의 차이
Deployment의 파드는 서로 바꿔 쓸 수 있고 이름이 임의로 붙는다. StatefulSet은 `volumeClaimTemplates`로 파드마다 PVC를 따로 만든다.

## 시작과 종료 순서
기본 `podManagementPolicy: OrderedReady`에서는 `db-0`이 준비된 뒤에 `db-1`이 시작된다. 종료는 역순이다.

## 헤드리스 서비스
`clusterIP: None`인 헤드리스 서비스를 함께 만들어야 `db-0.db-headless` 같은 주소로 개별 파드를 찾을 수 있다.
