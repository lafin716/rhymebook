# iptables 방화벽 규칙

iptables는 리눅스 커널의 netfilter에 패킷 처리 규칙을 넣는 명령이다. 규칙은 체인(INPUT, FORWARD, OUTPUT, PREROUTING, POSTROUTING)에 순서대로 걸린다.

## 기본 사용
```
iptables -A INPUT -p tcp --dport 22 -s 10.0.0.0/8 -j ACCEPT
iptables -P INPUT DROP
```
첫 줄은 사내망에서 SSH 접속만 허용하고, 둘째 줄은 나머지 입력을 기본 거부한다.

## 저장과 복원
규칙은 재부팅하면 사라진다. `iptables-save > /etc/iptables/rules.v4`로 저장하고 부팅 때 `iptables-restore`로 다시 읽는다.

## 주의
규칙 순서가 중요하다. 앞에 있는 ACCEPT가 뒤의 DROP을 가린다. 원격 서버에서는 SSH 허용 규칙을 먼저 넣고 정책을 바꾼다.
