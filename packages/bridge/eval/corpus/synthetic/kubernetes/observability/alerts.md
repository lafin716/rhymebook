# 프로메테우스 알림 규칙

프로메테우스는 PromQL 식이 참인 상태가 `for` 기간 동안 이어지면 알림을 보낸다. 알림은 Alertmanager가 받아 그룹화하고 Slack이나 메일로 보낸다.

## 규칙 예시
```yaml
- alert: HighErrorRate
  expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
  for: 10m
  labels:
    severity: page
```

## 실무 팁
- `for`를 너무 짧게 잡으면 잠깐의 튐에도 알림이 울린다.
- 알림마다 runbook 링크를 annotations에 넣는다.
- 중복 알림은 Alertmanager의 `group_wait`와 `repeat_interval`로 줄인다.
