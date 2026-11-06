# 리눅스 DNS 설정과 /etc/resolv.conf

이름 풀이(DNS 조회)는 `/etc/resolv.conf`의 `nameserver` 줄을 순서대로 시도한다. `search` 줄에 적은 도메인은 짧은 이름 뒤에 자동으로 붙는다.

## 예시
```
nameserver 10.0.0.2
search svc.cluster.local
options ndots:5
```
`ndots:5`는 점이 5개 미만인 이름을 먼저 search 도메인으로 붙여 본다는 뜻이다. 외부 주소 조회가 느린 원인이 되기도 한다.

## systemd-resolved
최신 배포판은 `/etc/resolv.conf`가 `systemd-resolved`의 심볼릭 링크인 경우가 많다. 직접 고친 내용은 재부팅 때 덮어써진다.
`resolvectl status`로 실제 사용 중인 DNS 서버를 확인한다.
