# Karpenter 노드 자동 프로비저닝

Karpenter는 스케줄되지 못한 대기 파드를 보고, 그 파드가 들어갈 새 노드를 직접 만든다.
노드 그룹을 미리 정해 두지 않아도 되고, 파드가 없어지면 빈 노드를 정리한다.

## NodePool
`NodePool`은 어떤 인스턴스 타입을 쓸 수 있는지, 용량 유형(온디맨드·스팟)과 최대 CPU 한도를 정한다.
`disruption.consolidationPolicy`를 `WhenEmptyOrUnderutilized`로 두면 덜 쓰는 노드를 합친다.

## 장점과 주의
- 파드 요구에 맞는 크기의 노드를 고르므로 빈 자원이 줄어든다.
- 스팟 중단 알림을 받으면 노드를 미리 비운다.
- NodePool 한도에 닿으면 새 노드를 만들지 않으므로 파드가 Pending으로 남는다.
