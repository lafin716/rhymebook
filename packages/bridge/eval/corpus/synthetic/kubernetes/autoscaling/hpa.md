# HorizontalPodAutoscaler (HPA)

HPA는 측정한 메트릭이 목표값을 넘으면 디플로이먼트의 복제본 수를 늘리고, 낮으면 줄인다.

## 목표값 정하기
`target.averageUtilization`에 평균 CPU 사용률 목표(예: 70)를 적는다. 요청(request) 대비 비율로 계산하므로
컨테이너의 `resources.requests.cpu`가 반드시 있어야 한다.

## 복제본 범위
`minReplicas`와 `maxReplicas` 사이에서만 움직인다. 급격한 증감을 막으려고 `behavior.scaleDown.stabilizationWindowSeconds`
기본값은 300초다.

## 한계
메트릭 서버가 없으면 HPA는 아무 값도 얻지 못해 확장하지 않는다. 사용자 정의 메트릭은 메트릭 어댑터가 필요하다.
