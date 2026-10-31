@echo off
setlocal
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py "%~dp0..\.gittools\pages-publish\pages_publish.py" %*
) else (
  python "%~dp0..\.gittools\pages-publish\pages_publish.py" %*
)
exit /b %ERRORLEVEL%
