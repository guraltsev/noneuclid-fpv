@echo off
setlocal
set "script=%~dp0..\.agents\agents-md\agents-md.py"
if not exist "%script%" set "AGENTS_MD_ROOT=%~dp0.."
if not exist "%script%" for /f "delims=" %%i in ('git -C "%~dp0.." rev-parse --path-format^=absolute --git-common-dir 2^>nul') do set "script=%%i\..\.agents\agents-md\agents-md.py"
if not exist "%script%" echo agents-md: the drop-in is not installed; copy its folder into .agents/ and run: python .agents/agents-md/install.py 1>&2
if not exist "%script%" exit /b 1
where python >nul 2>nul
if errorlevel 1 echo agents-md: Python was not found on the PATH; install Python 3.11 or later and run this again 1>&2
if errorlevel 1 exit /b 1
python "%script%" %*
