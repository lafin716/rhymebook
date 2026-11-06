# 파일 권한과 setuid 비트

파일 권한은 소유자·그룹·기타 세 묶음에 읽기(r), 쓰기(w), 실행(x)을 준다. `chmod 755 run.sh`처럼 8진수로 적는다.

## setuid와 setgid
실행 파일에 setuid 비트(`chmod u+s`)가 있으면 실행하는 동안 파일 소유자의 권한을 얻는다. `ls -l`에서 소유자 실행 자리가 `s`로 보인다.
`passwd` 명령이 root 소유 setuid 파일인 이유가 이것이다. 일반 사용자가 `/etc/shadow`를 고칠 수 있게 한다.

## 위험
setuid 스크립트는 환경 변수와 경로 조작에 취약하다. 꼭 필요한 바이너리에만 쓰고, `find / -perm -4000`으로 목록을 주기적으로 점검한다.

## 디렉터리의 sticky bit
`/tmp`처럼 누구나 쓸 수 있는 디렉터리는 sticky bit(`chmod +t`)로 자기 파일만 지우게 한다.
