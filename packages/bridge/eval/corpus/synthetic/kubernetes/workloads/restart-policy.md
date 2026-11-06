# 파드 재시작 정책과 CrashLoopBackOff

파드의 `restartPolicy`는 컨테이너가 끝났을 때 kubelet이 다시 실행할지 정한다. 기본값은 `Always`다.
`Always`, `OnFailure`, `Never` 세 가지 값이 있다.

## CrashLoopBackOff
컨테이너가 계속 비정상 종료하면 상태가 `CrashLoopBackOff`가 된다. kubelet은 재시작 간격을 10초, 20초, 40초처럼 늘려 기다린다(최대 5분).

## 확인 방법
`kubectl describe pod <이름>`의 Events와 `kubectl logs --previous`로 직전 실행의 로그를 본다.
종료 코드 137은 보통 메모리 한도 초과로 강제 종료된 경우다.

## 일회성 작업
배치 작업은 `restartPolicy: OnFailure` 또는 `Never`와 Job 리소스를 함께 쓴다.
