# OOM 킬러 (Out Of Memory killer)

리눅스 커널은 메모리가 바닥나고 회수할 수 있는 것도 없으면 OOM 킬러를 실행해 프로세스 하나를 강제로 끝낸다.
어느 프로세스를 죽일지는 `oom_score`로 정하며, 메모리를 많이 쓰는 프로세스일수록 점수가 높다.

## 흔적 찾기
`dmesg | grep -i "killed process"` 또는 `journalctl -k`에 `Out of memory: Killed process <pid>` 줄이 남는다.

## 조정
- `oom_score_adj`를 낮추면 해당 프로세스가 뒤로 밀린다(-1000이면 죽지 않는다).
- 컨테이너에서는 메모리 한도(cgroup)를 넘으면 그 컨테이너만 같은 방식으로 종료된다.
- 근본 해결은 메모리 누수 수정이나 한도 상향이다.
