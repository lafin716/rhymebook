# 퍼시스턴트 볼륨 클레임 (PVC)

PersistentVolumeClaim은 "이만큼의 저장 공간이 필요하다"는 요청이다. 실제 디스크는 `StorageClass`가 동적으로 만들거나 관리자가 미리 만든 PV가 맡는다.

## 바인딩
PVC는 조건에 맞는 PV와 1:1로 묶인다(Bound). `storageClassName`이 같고 용량과 접근 모드가 맞아야 한다.
`volumeBindingMode: WaitForFirstConsumer`이면 파드가 스케줄된 노드에 맞춰 볼륨을 만든다.

## 접근 모드
- `ReadWriteOnce`: 한 노드에서만 읽기·쓰기.
- `ReadWriteMany`: 여러 노드에서 함께 쓰기 (NFS 등 공유 스토리지 필요).

## 삭제 정책
`reclaimPolicy: Retain`이면 PVC를 지워도 디스크 데이터는 남는다.
