---
name: serve-host
description: 이 저장소의 헤드리스 호스트(`./rhymebook.sh` = `rhymebook serve`, :7777)를 실행한다. 이미 떠 있으면 저장하며 끄고 최신 코드로 다시 빌드해 재실행한다. "헤드리스 서버 실행/재시작", "serve 다시 띄워", "페어링 코드 다시" 같은 요청에 쓴다.
---

# serve-host — 헤드리스 호스트 (재)실행

인자: `` (비어 있으면 기본 옵션 `--pair` + 번들 whisper-cli. `--stop`이면 끄기만. 그 밖은 `rhymebook serve` 옵션으로 그대로 전달 — README "헤드리스 호스트" 표 참고)

## 실행
```bash
.claude/skills/serve-host/scripts/restart.sh [인자]
```
스크립트가 하는 일:
1. 이 저장소에서 띄운 `packages/server/dist/rhymebook.cjs serve` 프로세스를 찾아 **SIGINT**(Ctrl+C와 같음 — 진행 중 답변을 저장하고 종료)로 끈다. 15초 안에 안 꺼지면 SIGTERM.
2. 포트(기본 7777, `RHYMEBOOK_PORT`)를 다른 프로세스가 쓰면 멈추고 알린다 — 그 프로세스는 죽이지 말고 사용자에게 보고.
3. `nohup ./rhymebook.sh <옵션>`으로 백그라운드 실행(실행마다 서버를 다시 빌드). 로그는 `/tmp/rhymebook-serve.log`(`RHYMEBOOK_SERVE_LOG`).
4. "실행 중 (포트 …)"가 뜰 때까지 기다린 뒤 QR 블록을 뺀 시작 화면을 출력한다.

시작 중 종료되면 로그 끝부분이 나온다 — 빌드 실패면 `pnpm --filter @branch/server build`로 원인을 보고 보고한다.

## 보고
사용자에게 짧게(한국어):
- 이름·포트·학습 개수·bridge 지문, CLI 준비 상태(claude-cli/codex-cli), 새 학습 에이전트, 음성 입력 상태
- 접속 주소(Tailscale `ws://100.x:7777` · LAN)
- `--pair`면 새 1회용 코드(5분 유효)와 "QR·링크는 `/tmp/rhymebook-serve.log`". 이미 페어링된 기기는 그대로 다시 연결된다.
- 끄기: `.claude/skills/serve-host/scripts/restart.sh --stop`

## 주의
- 페어링 링크의 `b=`/`t=` 값과 코드는 로그·대화에만 두고 커밋·외부 전송하지 않는다.
- 데스크톱 앱(OctoBooks.app)과는 별개 호스트이고 데이터도 따로다(`~/.config/rhymebook`). 앱은 건드리지 않는다.
