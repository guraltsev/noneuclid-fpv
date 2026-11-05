@echo off
setlocal
if defined KNOWLEDGE_DISABLE if not "%KNOWLEDGE_DISABLE%"=="0" if /i not "%KNOWLEDGE_DISABLE%"=="false" (echo know: disabled by KNOWLEDGE_DISABLE 1>&2& exit /b 1)
set "root=%~dp0.."
set "common=none"
if exist "%root%\.git" if not exist "%root%\.git\" for /f "delims=" %%i in ('git -C "%root%" rev-parse --path-format^=absolute --git-common-dir 2^>nul') do set "common=%%i"
if "%common:~-5%"=="/.git" set "root=%common:~0,-5%"
set "root=%root:/=\%"
set "python=%root%\.agents\.state\knowledge\venv\Scripts\python.exe"
set "script=%root%\.agents\knowledge\knowledge.py"
set "ready=1"
if not exist "%python%" set "ready="
if not exist "%script%" set "ready="
if not defined ready echo know: not installed in "%root%"; run: python "%root%\.agents\knowledge\install.py", then _scripts/know_init (see .agents/knowledge/README.md) 1>&2
if not defined ready exit /b 1
"%python%" "%script%" write %*
