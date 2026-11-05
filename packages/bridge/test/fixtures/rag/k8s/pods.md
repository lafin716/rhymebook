# 파드 기본

파드는 쿠버네티스에서 배포 가능한 가장 작은 단위다. 하나 이상의 컨테이너가 같은 네트워크 네임스페이스와 볼륨을 공유한다.

## 재시작 정책

restartPolicy 는 Always, OnFailure, Never 중 하나다. 기본값은 Always이며 컨테이너가 종료되면 kubelet이 같은 노드에서 다시 띄운다.

## 리소스 요청과 제한

requests 는 스케줄러가 노드를 고를 때 쓰는 최소 자원이고, limits 는 컨테이너가 쓸 수 있는 최대 자원이다. 메모리 limit을 넘으면 컨테이너가 OOMKilled 상태로 종료된다.

## 프로브

livenessProbe 가 실패하면 컨테이너를 재시작하고, readinessProbe 가 실패하면 서비스 엔드포인트에서 파드를 뺀다.
