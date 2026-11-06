# systemd 유닛 파일 작성

systemd는 서비스를 유닛 파일(.service)로 정의한다. `/etc/systemd/system/` 아래에 두고 `systemctl daemon-reload` 뒤에 시작한다.

## 서비스 예시
```
[Unit]
Description=사내 알림 워커
After=network-online.target

[Service]
ExecStart=/usr/local/bin/notifier --config /etc/notifier.toml
Restart=on-failure
RestartSec=5
User=notifier

[Install]
WantedBy=multi-user.target
```

## 재시작 옵션
`Restart=on-failure`는 비정상 종료일 때만 다시 띄운다. `Restart=always`는 정상 종료에도 다시 띄운다.
`StartLimitBurst`와 `StartLimitIntervalSec`으로 무한 재시작 루프를 막는다.

## 로그
`journalctl -u notifier -f`로 실시간 로그를 본다.
