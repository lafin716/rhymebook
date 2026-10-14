@echo off
rem rhymebook 헤드리스 호스트 실행 (Windows)
rem   rhymebook.cmd                 -> serve (이미 페어링한 기기만 접속)
rem   rhymebook.cmd --pair          -> serve --pair (QR·링크·코드 표시)
rem   rhymebook.cmd devices ^| unpair ^<id^|all^> ^| pair ^| --help
rem 처음이면 의존성을 설치하고, 실행할 때마다 서버를 다시 빌드한다(1~2초).
rem 빌드를 건너뛰려면 set RHYMEBOOK_NO_BUILD=1
rem 탐색기에서 더블클릭하면 serve로 실행되고, 오류가 나면 창을 닫기 전에 멈춘다.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 필요합니다 ^(20 이상^). https://nodejs.org
  goto :fail
)
set "PNPM=pnpm"
where pnpm >nul 2>nul
if errorlevel 1 (
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo pnpm이 필요합니다: npm i -g pnpm
    goto :fail
  )
  set "PNPM=corepack pnpm"
)

if not exist node_modules (
  echo 의존성 설치 중...
  call %PNPM% install
  if errorlevel 1 goto :fail
)
set "DO_BUILD=1"
if "%RHYMEBOOK_NO_BUILD%"=="1" if exist packages\server\dist\rhymebook.cjs set "DO_BUILD="
if defined DO_BUILD (
  call %PNPM% --silent --filter @branch/server build >"%TEMP%\rhymebook-build.log" 2>&1
  if errorlevel 1 (
    type "%TEMP%\rhymebook-build.log"
    echo 서버 빌드에 실패했습니다.
    goto :fail
  )
)

rem 인자가 없거나 옵션으로 시작하면 serve
set "FIRST=%~1"
if "%FIRST%"=="" (
  node packages\server\dist\rhymebook.cjs serve
) else if "%FIRST%"=="-h" (
  node packages\server\dist\rhymebook.cjs %*
) else if "%FIRST%"=="--help" (
  node packages\server\dist\rhymebook.cjs %*
) else if "%FIRST:~0,1%"=="-" (
  node packages\server\dist\rhymebook.cjs serve %*
) else (
  node packages\server\dist\rhymebook.cjs %*
)
if errorlevel 1 goto :fail
endlocal
exit /b 0

:fail
echo.
echo 실행에 실패했습니다. 위 메시지를 확인하세요.
pause
endlocal
exit /b 1
